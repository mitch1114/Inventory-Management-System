// GET /api/cron/shipstation-pull
// Scheduled ShipStation inventory pull, invoked by Vercel Cron (see vercel.json).
// Server-side equivalent of Settings' "Pull from ShipStation" button: fetches
// V2 inventory levels, updates matching products' onHand in the shared Supabase
// app state, and appends an audit log entry.
//
// Required env: SHIPSTATION_V2_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional env: CRON_SECRET (when set, requests must send "Authorization: Bearer <secret>")
import { createClient } from "@supabase/supabase-js";

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

  const missing = ["SHIPSTATION_V2_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter(
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

    const data = row.data;
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

    const { error: saveError } = await supabase
      .from("app_state")
      .upsert(
        { id: "main", data, updated_at: new Date().toISOString() },
        { onConflict: "id" },
      );
    if (saveError) throw saveError;

    return res.status(200).json({ ok: true, matched, unmatched, changed: changed.length });
  } catch (err) {
    console.error("Scheduled ShipStation pull failed:", err);
    return res.status(200).json({ ok: false, reason: "error" });
  }
}
