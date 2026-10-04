// GET /api/cron/shipstation-pull
// Scheduled job, invoked by Vercel Cron (see vercel.json -- 6am & 10pm Central):
//   1. Snapshot backup of the shared app state
//   2. ShipStation inventory pull (server-side "Pull from ShipStation"):
//      updates matching products' onHand, appends an audit entry
//   3. Fills current orders' backorders from shelf stock, then releases
//      pre-orders whose ship date is within PREORDER_RELEASE_DAYS into the pick
//      queue and emails the "Confirmed" notification rules
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional env: SHIPSTATION_V2_API_KEY (step 2 is skipped without it),
//   RESEND_API_KEY + NOTIFY_FROM_EMAIL (release emails),
//   CRON_SECRET (when set, requests must send "Authorization: Bearer <secret>")
import { createClient } from "@supabase/supabase-js";
import { runOrderAutomation, PREORDER_RELEASE_DAYS } from "../../src/lib/preorderRelease.js";
import { sendStageEmail } from "../../server/notify/stage-email.js";

const SS_V2_BASE = "https://api.shipstation.com";

// Short random hex id, same shape as the app's uid() in src/lib/utils.js
const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Vercel Cron authentication (recommended): reject unless the shared secret matches
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ ok: false, reason: "unauthorized" });
  }

  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter(
    (name) => !process.env[name],
  );
  if (missing.length > 0) {
    return res.status(200).json({ ok: false, reason: "not-configured", missing });
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Load the shared app state
    const { data: row, error: loadError } = await supabase
      .from("app_state")
      .select("data")
      .eq("id", "main")
      .single();

    if (loadError || !row || !row.data) {
      return res.status(200).json({ ok: false, reason: "no-data" });
    }

    let data = row.data;

    // --- Automatic snapshot backup (runs even if the ShipStation pull fails
    // below). Keeps the last 30 snapshots (~15 days at twice daily) in the
    // app_state_backups table -- the restore point against accidental wipes
    // or data corruption, since the Supabase free tier has no backups.
    let backedUp = false;
    try {
      const { error: buError } = await supabase
        .from("app_state_backups")
        .insert({ ts: new Date().toISOString(), data });
      if (!buError) {
        backedUp = true;
        // prune: delete everything older than the newest 30
        const { data: old } = await supabase
          .from("app_state_backups")
          .select("id")
          .order("ts", { ascending: false })
          .range(30, 1000);
        if (old && old.length > 0) {
          await supabase
            .from("app_state_backups")
            .delete()
            .in("id", old.map((r) => r.id));
        }
      } else {
        console.error("Snapshot backup failed (does app_state_backups exist?):", buError.message);
      }
    } catch (buErr) {
      console.error("Snapshot backup failed:", buErr);
    }

    // --- ShipStation inventory pull (optional) ---
    let pull = null;
    if (process.env.SHIPSTATION_V2_API_KEY) {
      const products = data.products || [];
      const skus = products.map((p) => p.sku).filter(Boolean);

      // Fetch ShipStation V2 inventory levels per SKU (same endpoint/auth as
      // server/shipstation/inventory-levels.js; max 50 to avoid rate limits)
      const apiKey = process.env.SHIPSTATION_V2_API_KEY;
      const skuMap = {}; // lowercased sku -> summed onHand across warehouses

      for (const sku of skus.slice(0, 50)) {
        const params = new URLSearchParams({ sku, group_by: "warehouse", page_size: "100" });

        const response = await fetch(`${SS_V2_BASE}/v2/inventory?${params}`, {
          headers: { "api-key": apiKey },
        });

        if (!response.ok) continue;
        const result = await response.json();
        for (const item of result.inventory || []) {
          const key = (item.sku || "").toLowerCase();
          if (!key) continue;
          const onHand = item.on_hand != null ? item.on_hand : 0;
          skuMap[key] = (skuMap[key] || 0) + onHand;
        }
      }

      // Match SKUs case-insensitively and update onHand
      let matched = 0;
      const changed = [];
      const matchedKeys = new Set();

      data.products = products.map((p) => {
        const key = (p.sku || "").toLowerCase();
        if (skuMap[key] == null) return p;
        matched++;
        matchedKeys.add(key);
        if (p.onHand !== skuMap[key]) {
          changed.push({ sku: p.sku, old: p.onHand, new: skuMap[key] });
        }
        return { ...p, onHand: skuMap[key] };
      });

      const unmatched = Object.keys(skuMap).filter((key) => !matchedKeys.has(key)).length;

      data.auditLog = [
        ...(data.auditLog || []),
        {
          id: uid(),
          ts: new Date().toISOString(),
          type: "shipstation-sync",
          entity: "scheduled-pull",
          description: `Scheduled ShipStation pull: ${matched} matched, ${unmatched} unmatched, ${changed.length} quantities changed`,
        },
      ];

      pull = { matched, unmatched, changed: changed.length };
    }

    // --- Order automation (Central time): fill current orders' backorders from
    // shelf stock, then release pre-orders within PREORDER_RELEASE_DAYS of shipping ---
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
    const rel = runOrderAutomation(data, { today, now: new Date().toISOString(), makeId: uid });
    data = rel.data;

    // Skip the write when nothing changed -- a needless updated_at bump makes
    // open browser tabs treat their next save as stale
    if (!pull && rel.filled.length === 0 && rel.released.length === 0) {
      return res.status(200).json({ ok: true, pull, filled: [], released: [], emails: [], backedUp });
    }

    const { error: saveError } = await supabase
      .from("app_state")
      .upsert(
        { id: "main", data, updated_at: new Date().toISOString() },
        { onConflict: "id" },
      );
    if (saveError) throw saveError;

    // Release emails only after the release is saved
    const rules = (data.notificationRules || []).filter(
      (r) => r.stage === "confirmed" && r.email && String(r.email).includes("@"),
    );
    const emails = [];
    if (rules.length > 0) {
      for (const o of rel.released) {
        const filled = (o.lines || []).map((l) => (l.qtyFilled != null ? l.qtyFilled : l.qty));
        const units = filled.reduce((s, q) => s + q, 0);
        const ordered = (o.lines || []).reduce((s, l) => s + l.qty, 0);
        const value = (o.lines || []).reduce((s, l, i) => s + filled[i] * (l.price || 0), 0);
        const result = await sendStageEmail({
          to: rules.map((r) => r.email),
          orderNum: o.orderNum,
          poRef: o.dealerPORef || "",
          customer: o.customer || "",
          stageLabel: "Confirmed (pre-order released)",
          units,
          value,
          note: `Pre-order released to the pick queue ${PREORDER_RELEASE_DAYS} days before its requested ship date (${o.requestedShipDate}). ${units} of ${ordered} units in stock.`,
        });
        emails.push({ orderNum: o.orderNum, ...result });
      }
    }

    return res.status(200).json({
      ok: true,
      pull,
      filled: rel.filled,
      released: rel.released.map((o) => o.orderNum),
      emails,
      backedUp,
    });
  } catch (err) {
    console.error("Scheduled ShipStation pull failed:", err);
    return res.status(200).json({ ok: false, reason: "error" });
  }
}
