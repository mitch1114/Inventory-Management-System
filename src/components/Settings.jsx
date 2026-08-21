import { useState, useCallback, useEffect } from "react";
import { testConnection, testConnectionV2, getWarehouses, pullInventory, pushInventory } from "../lib/shipstation";
import { defaultData, makeDemoData } from "../lib/defaultData";
import { STAGES, STAGE_LABEL, MIDSTATES_BILL_TO } from "../lib/constants";
import { uid, nowIso, fmtDate } from "../lib/utils";
import { connectQbo, fetchInvoices, isQboConnected, getQboTokens, clearQboTokens } from "../lib/qbo";
import { sendTestStageEmail } from "../lib/notify";
import HistoryImport from "./HistoryImport";
import { BP, BS, BD, BG } from "./ui";

export default function Settings({ data, setData }) {
  // V1 Shipping
  const [ssTesting, setSsTesting] = useState(false);
  const [ssResult, setSsResult] = useState(null);

  // V2 Inventory
  const [v2Testing, setV2Testing] = useState(false);
  const [v2Result, setV2Result] = useState(null);
  const [warehouses, setWarehouses] = useState(null);
  const [whLoading, setWhLoading] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [syncDirection, setSyncDirection] = useState(null); // "pull" | "push"
  const [syncResult, setSyncResult] = useState(null);
  const [syncing, setSyncing] = useState(false);

  // QBO state
  const [qboConnected, setQboConnected] = useState(isQboConnected());
  const [qboConnecting, setQboConnecting] = useState(false);
  const [qboError, setQboError] = useState(null);
  const [qboInvoices, setQboInvoices] = useState(null);
  const [qboFetching, setQboFetching] = useState(false);
  const [qboImportResult, setQboImportResult] = useState(null);
  const [qboStartDate, setQboStartDate] = useState("");

  // Customer data cleanup
  const [cleanupMsg, setCleanupMsg] = useState(null);

  // Team notification rules
  const [ruleForm, setRuleForm] = useState({ name: "", email: "", stage: "confirmed" });
  const [ruleError, setRuleError] = useState("");
  const [ruleTesting, setRuleTesting] = useState(null); // rule id with a test send in flight
  const [ruleTestResult, setRuleTestResult] = useState(null); // { rule, result } of last test

  // Re-check connection status on mount (tokens may have been cleared)
  useEffect(() => {
    setQboConnected(isQboConnected());
  }, []);

  const notificationRules = data.notificationRules || [];

  const addRule = () => {
    const name = ruleForm.name.trim();
    const email = ruleForm.email.trim();
    if (!email.includes("@")) {
      setRuleError("Enter a valid email address.");
      return;
    }
    const rule = { id: uid(), name, email, stage: ruleForm.stage };
    setData((d) => ({
      ...d,
      notificationRules: [...(d.notificationRules || []), rule],
      auditLog: [
        ...(d.auditLog || []),
        {
          id: uid(),
          ts: nowIso(),
          type: "adjustment",
          entity: "Notifications",
          description: `Added notification rule: ${name || email} <${email}> on ${STAGE_LABEL[rule.stage] || rule.stage}`,
        },
      ],
    }));
    setRuleForm({ name: "", email: "", stage: "confirmed" });
    setRuleError("");
  };

  // Send a real test email through /api/notify/stage and show the exact
  // outcome -- the order flows swallow failures, so this is the way to see
  // WHY a teammate isn't getting notifications (bad env vars, unverified
  // Resend domain, typo'd address...).
  const doTestRule = async (rule) => {
    setRuleTesting(rule.id);
    setRuleTestResult(null);
    const result = await sendTestStageEmail(rule);
    setRuleTesting(null);
    setRuleTestResult({ rule, result });
  };

  // One-click normalization of customer classifications:
  //   - bare "distributor" type -> Tier 1 Distributor (imports used to write
  //     the raw value, so some records show an unlabeled type)
  //   - every distributor gets Net 60 payment terms
  //   - Farm & Home / Farm & Garden stores -> Buying Group
  const runCustomerCleanup = () => {
    const isBuyingGroupName = (n) => /farm\s*&\s*(home|garden)|^runnings/i.test(n || "");
    let tiers = 0;
    let terms = 0;
    let groups = 0;
    let billTos = 0;
    (data.customers || []).forEach((c) => {
      if (c.type === "distributor") tiers++;
      const willBeGroup = c.type === "buying-group" || isBuyingGroupName(c.name);
      if (isBuyingGroupName(c.name) && c.type !== "buying-group") groups++;
      if (willBeGroup && !c.billToAddress) billTos++;
      const effType = c.type === "distributor" ? "distributor-t1" : c.type;
      if (
        (effType === "distributor-t1" || effType === "distributor-t2") &&
        c.paymentTerms !== "Net 60"
      )
        terms++;
    });
    if (tiers + terms + groups + billTos === 0) {
      setCleanupMsg({ ok: true, text: "Nothing to clean up -- all customers already consistent." });
      return;
    }
    if (
      !confirm(
        `Customer cleanup will:\n- Normalize ${tiers} "distributor" record(s) to Tier 1 Distributor\n- Set Net 60 terms on ${terms} distributor(s)\n- Mark ${groups} Farm & Home / Farm & Garden / Runnings store(s) as Buying Group\n- Set the Mid-States remit-to as Bill-To on ${billTos} buying-group customer(s) missing one\n\nProceed?`,
      )
    )
      return;
    setData((d) => ({
      ...d,
      customers: (d.customers || []).map((c) => {
        let next = { ...c };
        if (next.type === "distributor") next.type = "distributor-t1";
        if (isBuyingGroupName(next.name) && next.type !== "buying-group") next.type = "buying-group";
        if (
          (next.type === "distributor-t1" || next.type === "distributor-t2") &&
          next.paymentTerms !== "Net 60"
        )
          next.paymentTerms = "Net 60";
        // Buying-group members bill through the group's remit-to (blank only)
        if (next.type === "buying-group" && !next.billToAddress)
          next.billToAddress = MIDSTATES_BILL_TO;
        return next;
      }),
      auditLog: [
        ...(d.auditLog || []),
        {
          id: uid(),
          ts: nowIso(),
          type: "adjustment",
          entity: "Customers",
          description: `Customer cleanup: ${tiers} normalized to Tier 1 Distributor, ${terms} distributor(s) set to Net 60 terms, ${groups} marked Buying Group, ${billTos} given the Mid-States bill-to`,
        },
      ],
    }));
    setCleanupMsg({
      ok: true,
      text: `Cleaned up: ${tiers} normalized to Tier 1 Distributor, ${terms} set to Net 60 terms, ${groups} marked Buying Group, ${billTos} given the Mid-States bill-to.`,
    });
  };

  const removeRule = (rule) => {
    setData((d) => ({
      ...d,
      notificationRules: (d.notificationRules || []).filter((r) => r.id !== rule.id),
      auditLog: [
        ...(d.auditLog || []),
        {
          id: uid(),
          ts: nowIso(),
          type: "adjustment",
          entity: "Notifications",
          description: `Removed notification rule: ${rule.name || rule.email} <${rule.email}> on ${STAGE_LABEL[rule.stage] || rule.stage}`,
        },
      ],
    }));
  };

  const doConnectQbo = async () => {
    setQboConnecting(true);
    setQboError(null);
    try {
      await connectQbo();
      setQboConnected(true);
    } catch (err) {
      setQboError(err.message);
    }
    setQboConnecting(false);
  };

  const doDisconnectQbo = () => {
    if (!window.confirm("Disconnect from QuickBooks Online? You can reconnect anytime.")) return;
    clearQboTokens();
    setQboConnected(false);
    setQboInvoices(null);
    setQboImportResult(null);
  };

  const doFetchInvoices = async () => {
    setQboFetching(true);
    setQboError(null);
    setQboImportResult(null);
    try {
      const result = await fetchInvoices({
        startDate: qboStartDate || undefined,
        maxResults: 100,
      });
      setQboInvoices(result.salesOrders || []);
    } catch (err) {
      setQboError(err.message);
      // If auth expired, update connection status
      if (!isQboConnected()) setQboConnected(false);
    }
    setQboFetching(false);
  };

  const doImportInvoices = () => {
    if (!qboInvoices || qboInvoices.length === 0) return;

    const existingQboIds = new Set(
      data.salesOrders.filter((o) => o.qboId).map((o) => o.qboId),
    );

    let added = 0;
    let skipped = 0;
    const newOrders = [];

    for (const inv of qboInvoices) {
      if (existingQboIds.has(inv.qboId)) {
        skipped++;
        continue;
      }

      // Match invoice line items to our products by name
      const mappedLines = inv.lines.map((l) => {
        const match = data.products.find(
          (p) =>
            p.name === l.qboItemName ||
            p.sku === l.qboItemName ||
            p.name.toLowerCase() === (l.qboItemName || "").toLowerCase(),
        );
        return {
          productId: match ? match.id : null,
          qty: l.qty,
          price: l.price,
          qtyFilled: 0,
          qtyBackordered: 0,
          qboItemName: l.qboItemName,
        };
      });

      // Also try to match customer
      const customerMatch = data.customers.find(
        (c) => c.name.toLowerCase() === (inv.customer || "").toLowerCase(),
      );

      newOrders.push({
        id: uid(),
        orderNum: `QBO-${inv.qboDocNumber || inv.qboId}`,
        qboId: inv.qboId,
        qboDocNumber: inv.qboDocNumber,
        customer: inv.customer || "Unknown",
        date: inv.date,
        fulfillmentStage: "confirmed",
        type: "standard",
        dealerPORef: inv.qboDocNumber ? `INV-${inv.qboDocNumber}` : "",
        lines: mappedLines,
        shipment: {},
        notes: `Imported from QBO invoice #${inv.qboDocNumber || inv.qboId}`,
      });
      added++;
    }

    if (added > 0) {
      setData((d) => ({
        ...d,
        salesOrders: [...d.salesOrders, ...newOrders],
        counters: { ...d.counters, so: (d.counters?.so || 0) + added },
        auditLog: [
          ...(d.auditLog || []),
          {
            id: uid(),
            ts: nowIso(),
            type: "adjustment",
            entity: "QBO Import",
            description: `Imported ${added} invoice(s) from QuickBooks Online as sales orders${skipped > 0 ? ` (${skipped} already imported)` : ""}`,
          },
        ],
      }));
    }

    setQboImportResult({
      success: true,
      message: `${added} invoice(s) imported as sales orders${skipped > 0 ? `, ${skipped} skipped (already imported)` : ""}`,
    });
    setQboInvoices(null);
  };

  const doTestConnection = async () => {
    setSsTesting(true);
    setSsResult(null);
    try {
      const result = await testConnection();
      setSsResult(result);
    } catch (err) {
      setSsResult({ connected: false, error: err.message });
    }
    setSsTesting(false);
  };

  const doTestV2 = async () => {
    setV2Testing(true);
    setV2Result(null);
    try {
      const result = await testConnectionV2();
      setV2Result(result);
      // If connected, auto-load warehouses
      if (result.connected) loadWarehouses();
    } catch (err) {
      setV2Result({ connected: false, error: err.message });
    }
    setV2Testing(false);
  };

  const loadWarehouses = async () => {
    setWhLoading(true);
    try {
      const result = await getWarehouses();
      if (result.success) {
        setWarehouses(result.warehouses);
        // Auto-select first location if available
        if (result.warehouses.length > 0 && result.warehouses[0].locations.length > 0) {
          setSelectedLocation(result.warehouses[0].locations[0].id);
        }
      }
    } catch (err) {
      // silently fail
    }
    setWhLoading(false);
  };

  const doPullInventory = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncDirection("pull");
    try {
      const result = await pullInventory();
      if (!result.success) {
        setSyncResult({ success: false, error: result.error || "Failed to pull inventory" });
        setSyncing(false);
        return;
      }

      const ssInventory = result.inventory || [];
      if (ssInventory.length === 0) {
        setSyncResult({ success: true, message: "No inventory found in ShipStation" });
        setSyncing(false);
        return;
      }

      // Match ShipStation SKUs to our products and update onHand
      let matched = 0;
      let unmatched = 0;
      const unmatchedSkus = [];

      setData((prev) => {
        const skuMap = {};
        ssInventory.forEach((item) => {
          // Sum quantities if same SKU appears in multiple warehouses
          if (skuMap[item.sku]) {
            skuMap[item.sku] += item.onHand;
          } else {
            skuMap[item.sku] = item.onHand;
          }
        });

        const updatedProducts = prev.products.map((p) => {
          if (skuMap[p.sku] != null) {
            matched++;
            return { ...p, onHand: skuMap[p.sku] };
          }
          return p;
        });

        // Find ShipStation SKUs that don't match any product
        Object.keys(skuMap).forEach((sku) => {
          if (!prev.products.find((p) => p.sku === sku)) {
            unmatched++;
            unmatchedSkus.push(sku);
          }
        });

        return { ...prev, products: updatedProducts };
      });

      setSyncResult({
        success: true,
        message: `Pulled ${ssInventory.length} SKU(s) from ShipStation. Updated ${matched} product(s).${unmatched > 0 ? ` ${unmatched} SKU(s) not matched: ${unmatchedSkus.slice(0, 5).join(", ")}${unmatchedSkus.length > 5 ? "..." : ""}` : ""}`,
      });
    } catch (err) {
      setSyncResult({ success: false, error: err.message });
    }
    setSyncing(false);
  }, [setData]);

  const doPushInventory = useCallback(async () => {
    if (!selectedLocation) {
      setSyncResult({ success: false, error: "Select a warehouse location first" });
      return;
    }
    setSyncing(true);
    setSyncResult(null);
    setSyncDirection("push");
    try {
      const products = data?.products || [];
      const items = products.map((p) => ({ sku: p.sku, onHand: p.onHand }));

      const result = await pushInventory(items, selectedLocation);
      if (result.success) {
        setSyncResult({
          success: true,
          message: `Pushed ${result.updated} SKU(s) to ShipStation.${result.failed > 0 ? ` ${result.failed} failed.` : ""}`,
        });
      } else {
        setSyncResult({
          success: result.updated > 0,
          message: `${result.updated || 0} updated, ${result.failed || 0} failed.`,
          error: result.error,
        });
      }
    } catch (err) {
      setSyncResult({ success: false, error: err.message });
    }
    setSyncing(false);
  }, [data, selectedLocation]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>Settings</h2>
        <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 13 }}>
          Manage integrations and application configuration.
        </p>
      </div>

      {/* ShipStation V1 -- Shipping Integration */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          padding: "20px 24px",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "#ECFEFF",
              border: "1px solid #A5F3FC",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              fontWeight: 800,
              color: "#0891B2",
            }}
          >
            SS
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>
              ShipStation Shipping <span style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8" }}>(V1 API)</span>
            </div>
            <div style={{ fontSize: 11, color: "#64748B" }}>Shipping label creation and tracking</div>
          </div>
        </div>

        {/* How it works */}
        <div
          style={{
            background: "#F8FAFC",
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 18,
            fontSize: 12,
            color: "#475569",
            lineHeight: 1.7,
          }}
        >
          <div style={{ fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>How it works:</div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              Add both <code style={{ background: "#E2E8F0", padding: "1px 6px", borderRadius: 4 }}>SHIPSTATION_API_KEY</code>{" "}
              and <code style={{ background: "#E2E8F0", padding: "1px 6px", borderRadius: 4 }}>SHIPSTATION_API_SECRET</code>{" "}
              to your Vercel environment variables. Find both at ShipStation &rarr; Account &rarr; Settings &rarr; API Settings (V1 section).
            </li>
            <li>
              When an order advances to <strong>Booked</strong> in the pipeline, it auto-pushes to ShipStation.
            </li>
            <li>
              Click <strong>Sync Shipments</strong> in the pipeline to pull tracking info back. Orders shipped
              in ShipStation auto-advance to <strong>Shipped</strong> with carrier + tracking.
            </li>
          </ol>
        </div>

        {/* Environment variables guide */}
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E2E8F0",
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 18,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>
            Vercel Environment Variables
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              <tr style={{ borderBottom: "1px solid #F1F5F9" }}>
                <td style={{ padding: "8px 0", fontFamily: "monospace", fontWeight: 600, color: "#6D28D9" }}>
                  SHIPSTATION_API_KEY
                </td>
                <td style={{ padding: "8px 0", color: "#64748B" }}>
                  <strong>Required.</strong> Your ShipStation V1 API Key
                </td>
              </tr>
              <tr>
                <td style={{ padding: "8px 0", fontFamily: "monospace", fontWeight: 600, color: "#6D28D9" }}>
                  SHIPSTATION_API_SECRET
                </td>
                <td style={{ padding: "8px 0", color: "#64748B" }}>
                  <strong>Required.</strong> Your ShipStation V1 API Secret
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Test connection */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            style={{ ...BP, opacity: ssTesting ? 0.6 : 1 }}
            onClick={doTestConnection}
            disabled={ssTesting}
          >
            {ssTesting ? "Testing..." : "Test Connection"}
          </button>

          {ssResult && (
            <div
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                background: ssResult.connected ? "#F0FDF4" : "#FEF2F2",
                color: ssResult.connected ? "#15803D" : "#B91C1C",
                border: `1px solid ${ssResult.connected ? "#BBF7D0" : "#FECACA"}`,
              }}
            >
              {ssResult.connected
                ? `Connected${ssResult.stores && ssResult.stores.length > 0 ? ` -- ${ssResult.stores.map((s) => s.name).join(", ")}` : ""}`
                : ssResult.error || "Connection failed"}
            </div>
          )}
        </div>
      </div>

      {/* ShipStation V2 -- Inventory Sync */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          padding: "20px 24px",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "#EDE9FE",
              border: "1px solid #C4B5FD",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 800,
              color: "#7C3AED",
            }}
          >
            INV
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>
              ShipStation Inventory <span style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8" }}>(V2 API)</span>
            </div>
            <div style={{ fontSize: 11, color: "#64748B" }}>Bi-directional inventory stock level sync</div>
          </div>
        </div>

        {/* How it works */}
        <div
          style={{
            background: "#F8FAFC",
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 18,
            fontSize: 12,
            color: "#475569",
            lineHeight: 1.7,
          }}
        >
          <div style={{ fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>How it works:</div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              Enable the <strong>Inventory API add-on</strong> in your ShipStation account, then generate a V2 API key.
            </li>
            <li>
              Add <code style={{ background: "#E2E8F0", padding: "1px 6px", borderRadius: 4 }}>SHIPSTATION_V2_API_KEY</code>{" "}
              to your Vercel environment variables (your production API key from the V2 section).
            </li>
            <li>
              <strong>Pull from ShipStation:</strong> Imports stock levels for matching SKUs and updates your on-hand quantities.
            </li>
            <li>
              <strong>Push to ShipStation:</strong> Sends your current on-hand quantities to a selected warehouse location in ShipStation.
            </li>
          </ol>
        </div>

        {/* V2 Environment variable */}
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E2E8F0",
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 18,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>
            Vercel Environment Variable
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              <tr>
                <td style={{ padding: "8px 0", fontFamily: "monospace", fontWeight: 600, color: "#7C3AED" }}>
                  SHIPSTATION_V2_API_KEY
                </td>
                <td style={{ padding: "8px 0", color: "#64748B" }}>
                  <strong>Required.</strong> Your ShipStation V2 production API key (Settings &rarr; API Settings &rarr; V2 section)
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Scheduled sync */}
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E2E8F0",
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 18,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>
            Scheduled Sync
          </div>
          <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.7, marginBottom: 8 }}>
            Inventory is also pulled from ShipStation automatically at <strong>6am and 10pm Central</strong> via
            a Vercel Cron job -- no button click needed. During winter (standard time) the runs shift one hour,
            and on the Vercel Hobby plan cron timing can drift within the hour.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              <tr style={{ borderBottom: "1px solid #F1F5F9" }}>
                <td style={{ padding: "8px 0", fontFamily: "monospace", fontWeight: 600, color: "#7C3AED" }}>
                  SUPABASE_URL
                </td>
                <td style={{ padding: "8px 0", color: "#64748B" }}>
                  <strong>Required.</strong> Your Supabase project URL (Supabase &rarr; Project Settings &rarr; API)
                </td>
              </tr>
              <tr style={{ borderBottom: "1px solid #F1F5F9" }}>
                <td style={{ padding: "8px 0", fontFamily: "monospace", fontWeight: 600, color: "#7C3AED" }}>
                  SUPABASE_SERVICE_ROLE_KEY
                </td>
                <td style={{ padding: "8px 0", color: "#64748B" }}>
                  <strong>Required.</strong> The <code style={{ background: "#E2E8F0", padding: "1px 6px", borderRadius: 4 }}>service_role</code>{" "}
                  secret (Supabase &rarr; Project Settings &rarr; API) -- server-side only, never the anon key
                </td>
              </tr>
              <tr>
                <td style={{ padding: "8px 0", fontFamily: "monospace", fontWeight: 600, color: "#7C3AED" }}>
                  CRON_SECRET
                </td>
                <td style={{ padding: "8px 0", color: "#64748B" }}>
                  <strong>Optional.</strong> When set, cron requests must send it as a Bearer token -- blocks outside callers
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Test V2 connection */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <button
            style={{ ...BP, background: "linear-gradient(135deg,#7C3AED,#6D28D9)", opacity: v2Testing ? 0.6 : 1 }}
            onClick={doTestV2}
            disabled={v2Testing}
          >
            {v2Testing ? "Testing..." : "Test V2 Connection"}
          </button>

          {v2Result && (
            <div
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                background: v2Result.connected ? "#F0FDF4" : "#FEF2F2",
                color: v2Result.connected ? "#15803D" : "#B91C1C",
                border: `1px solid ${v2Result.connected ? "#BBF7D0" : "#FECACA"}`,
              }}
            >
              {v2Result.connected
                ? `Connected${v2Result.warehouses && v2Result.warehouses.length > 0 ? ` -- ${v2Result.warehouses.length} warehouse(s)` : ""}`
                : v2Result.error || "Connection failed"}
            </div>
          )}
        </div>

        {/* Warehouse / Location selection + Sync controls */}
        {v2Result && v2Result.connected && (
          <div
            style={{
              background: "#F8FAFC",
              border: "1px solid #E2E8F0",
              borderRadius: 10,
              padding: "16px 18px",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>
              Inventory Sync
            </div>

            {/* Warehouse/Location picker for push */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                Target Location (for push)
              </div>
              {whLoading ? (
                <div style={{ fontSize: 12, color: "#94A3B8" }}>Loading warehouses...</div>
              ) : warehouses && warehouses.length > 0 ? (
                <select
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  style={{
                    width: "100%",
                    maxWidth: 400,
                    background: "#FFFFFF",
                    border: "1px solid #CBD5E1",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 13,
                    color: "#0F172A",
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <option value="">Select a location...</option>
                  {warehouses.map((wh) =>
                    wh.locations.length > 0 ? (
                      <optgroup key={wh.id} label={wh.name}>
                        {wh.locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name || loc.id}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      <option key={wh.id} disabled>
                        {wh.name} (no locations)
                      </option>
                    ),
                  )}
                </select>
              ) : warehouses ? (
                <div style={{ fontSize: 12, color: "#94A3B8" }}>
                  No warehouses found. Set up warehouses and locations in ShipStation first.
                </div>
              ) : (
                <button style={{ ...BS, fontSize: 12, padding: "6px 14px" }} onClick={loadWarehouses}>
                  Load Warehouses
                </button>
              )}
            </div>

            {/* Sync buttons */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: syncResult ? 12 : 0 }}>
              <button
                style={{
                  ...BS,
                  background: "#EFF6FF",
                  borderColor: "#BFDBFE",
                  color: "#1D4ED8",
                  opacity: syncing ? 0.6 : 1,
                }}
                onClick={doPullInventory}
                disabled={syncing}
              >
                {syncing && syncDirection === "pull" ? "Pulling..." : "Pull from ShipStation"}
              </button>
              <button
                style={{
                  ...BS,
                  background: "#F5F3FF",
                  borderColor: "#C4B5FD",
                  color: "#6D28D9",
                  opacity: syncing || !selectedLocation ? 0.6 : 1,
                }}
                onClick={doPushInventory}
                disabled={syncing || !selectedLocation}
              >
                {syncing && syncDirection === "push" ? "Pushing..." : "Push to ShipStation"}
              </button>
              <div style={{ fontSize: 11, color: "#94A3B8", alignSelf: "center" }}>
                {data?.products ? `${data.products.length} SKUs` : ""}
              </div>
            </div>

            {/* Sync result */}
            {syncResult && (
              <div
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  background: syncResult.success ? "#F0FDF4" : "#FEF2F2",
                  color: syncResult.success ? "#15803D" : "#B91C1C",
                  border: `1px solid ${syncResult.success ? "#BBF7D0" : "#FECACA"}`,
                }}
              >
                {syncResult.message || syncResult.error || "Done"}
              </div>
            )}
          </div>
        )}
      </div>

      {/* QuickBooks Online Integration */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          padding: "20px 24px",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "#F0FDF4",
              border: "1px solid #BBF7D0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 800,
              color: "#15803D",
            }}
          >
            QB
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>
              QuickBooks Online
            </div>
            <div style={{ fontSize: 11, color: "#64748B" }}>Import invoices as sales orders</div>
          </div>
          {qboConnected && (
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 12px",
                borderRadius: 20,
                background: "#F0FDF4",
                border: "1px solid #BBF7D0",
                fontSize: 11,
                fontWeight: 700,
                color: "#15803D",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16A34A" }} />
              Connected
            </div>
          )}
        </div>

        {/* Setup guide */}
        <div
          style={{
            background: "#F8FAFC",
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 18,
            fontSize: 12,
            color: "#475569",
            lineHeight: 1.7,
          }}
        >
          <div style={{ fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>Setup guide:</div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              Go to the{" "}
              <strong>Intuit Developer Portal</strong> and create an app (choose &ldquo;QuickBooks Online and Payments&rdquo;).
            </li>
            <li>
              Under your app&rsquo;s <strong>Keys & credentials</strong> (Production or Sandbox), copy the{" "}
              <strong>Client ID</strong> and <strong>Client Secret</strong>.
            </li>
            <li>
              Add a <strong>Redirect URI</strong> in the Intuit portal:{" "}
              <code style={{ background: "#E2E8F0", padding: "1px 6px", borderRadius: 4 }}>
                https://your-domain.vercel.app/api/qbo/callback
              </code>
            </li>
            <li>
              Add both <code style={{ background: "#E2E8F0", padding: "1px 6px", borderRadius: 4 }}>INTUIT_CLIENT_ID</code>{" "}
              and <code style={{ background: "#E2E8F0", padding: "1px 6px", borderRadius: 4 }}>INTUIT_CLIENT_SECRET</code>{" "}
              to your Vercel environment variables.
            </li>
            <li>
              Click <strong>Connect to QuickBooks</strong> below to authorize.
            </li>
          </ol>
        </div>

        {/* Environment variables */}
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E2E8F0",
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 18,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>
            Vercel Environment Variables
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              <tr style={{ borderBottom: "1px solid #F1F5F9" }}>
                <td style={{ padding: "8px 0", fontFamily: "monospace", fontWeight: 600, color: "#15803D" }}>
                  INTUIT_CLIENT_ID
                </td>
                <td style={{ padding: "8px 0", color: "#64748B" }}>
                  <strong>Required.</strong> Your Intuit app Client ID
                </td>
              </tr>
              <tr>
                <td style={{ padding: "8px 0", fontFamily: "monospace", fontWeight: 600, color: "#15803D" }}>
                  INTUIT_CLIENT_SECRET
                </td>
                <td style={{ padding: "8px 0", color: "#64748B" }}>
                  <strong>Required.</strong> Your Intuit app Client Secret
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Connect / Disconnect buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: qboError || qboImportResult ? 14 : 0 }}>
          {!qboConnected ? (
            <button
              style={{ ...BG, opacity: qboConnecting ? 0.6 : 1 }}
              onClick={doConnectQbo}
              disabled={qboConnecting}
            >
              {qboConnecting ? "Connecting..." : "Connect to QuickBooks"}
            </button>
          ) : (
            <>
              <button
                style={{ ...BG, opacity: qboFetching ? 0.6 : 1 }}
                onClick={doFetchInvoices}
                disabled={qboFetching}
              >
                {qboFetching ? "Fetching..." : "Fetch Invoices"}
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <label style={{ fontSize: 11, color: "#64748B", fontWeight: 600 }}>From:</label>
                <input
                  type="date"
                  value={qboStartDate}
                  onChange={(e) => setQboStartDate(e.target.value)}
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid #CBD5E1",
                    borderRadius: 6,
                    padding: "5px 8px",
                    fontSize: 12,
                    color: "#0F172A",
                    fontFamily: "inherit",
                  }}
                />
              </div>
              <button
                style={{ ...BD, padding: "7px 14px", fontSize: 12 }}
                onClick={doDisconnectQbo}
              >
                Disconnect
              </button>
            </>
          )}
        </div>

        {/* Error display */}
        {qboError && (
          <div
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              background: "#FEF2F2",
              color: "#B91C1C",
              border: "1px solid #FECACA",
              marginBottom: 14,
            }}
          >
            {qboError}
          </div>
        )}

        {/* Import result banner */}
        {qboImportResult && (
          <div
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              background: qboImportResult.success ? "#F0FDF4" : "#FEF2F2",
              color: qboImportResult.success ? "#15803D" : "#B91C1C",
              border: `1px solid ${qboImportResult.success ? "#BBF7D0" : "#FECACA"}`,
              marginBottom: 14,
            }}
          >
            {qboImportResult.message}
          </div>
        )}

        {/* Invoice preview table */}
        {qboInvoices && qboInvoices.length > 0 && (
          <div
            style={{
              background: "#F8FAFC",
              border: "1px solid #E2E8F0",
              borderRadius: 10,
              padding: "16px 18px",
              marginTop: 14,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>
                {qboInvoices.length} Invoice{qboInvoices.length !== 1 ? "s" : ""} Found
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={BS} onClick={() => setQboInvoices(null)}>
                  Cancel
                </button>
                <button style={BG} onClick={doImportInvoices}>
                  Import as Sales Orders
                </button>
              </div>
            </div>

            <div style={{ maxHeight: 300, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#EFF6FF" }}>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Invoice #</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Customer</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Date</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "#64748B", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Amount</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Status</th>
                    <th style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700, color: "#64748B", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Lines</th>
                  </tr>
                </thead>
                <tbody>
                  {qboInvoices.map((inv, i) => {
                    const already = data.salesOrders.some((o) => o.qboId === inv.qboId);
                    return (
                      <tr key={inv.qboId} style={{ borderBottom: "1px solid #F1F5F9", background: already ? "#FEF9C3" : i % 2 === 0 ? "transparent" : "#FAFAFA" }}>
                        <td style={{ padding: "8px 10px", fontWeight: 600 }}>{inv.qboDocNumber || inv.qboId}</td>
                        <td style={{ padding: "8px 10px" }}>{inv.customer}</td>
                        <td style={{ padding: "8px 10px", color: "#64748B" }}>{fmtDate(inv.date)}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: "#15803D" }}>
                          ${inv.totalAmount.toFixed(2)}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "2px 8px",
                              borderRadius: 10,
                              background: inv.status === "paid" ? "#F0FDF4" : inv.status === "overdue" ? "#FEF2F2" : "#EFF6FF",
                              color: inv.status === "paid" ? "#15803D" : inv.status === "overdue" ? "#DC2626" : "#2563EB",
                              textTransform: "uppercase",
                            }}
                          >
                            {already ? "ALREADY IMPORTED" : inv.status}
                          </span>
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "center", color: "#64748B" }}>{inv.lines.length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {qboInvoices && qboInvoices.length === 0 && (
          <div
            style={{
              padding: "14px 18px",
              borderRadius: 10,
              background: "#F8FAFC",
              border: "1px solid #E2E8F0",
              fontSize: 13,
              color: "#64748B",
              textAlign: "center",
              marginTop: 14,
            }}
          >
            No invoices found{qboStartDate ? ` since ${fmtDate(qboStartDate)}` : ""}. Try adjusting the date range.
          </div>
        )}
      </div>

      {/* Customer Emails */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          padding: "20px 24px",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "#F0FDF4",
              border: "1px solid #BBF7D0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 800,
              color: "#15803D",
            }}
          >
            &#9993;
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>
              Customer Shipped Emails
            </div>
            <div style={{ fontSize: 11, color: "#64748B" }}>
              Email the customer their tracking info when an order is marked Shipped.
              Off by default -- flip on when the email content is ready.
            </div>
          </div>
          <button
            onClick={() =>
              setData((d) => ({
                ...d,
                customerShippedEmails: !d.customerShippedEmails,
                auditLog: [
                  ...(d.auditLog || []),
                  {
                    id: uid(),
                    ts: nowIso(),
                    type: "notify",
                    entity: "Settings",
                    description: `Customer shipped emails turned ${!d.customerShippedEmails ? "ON" : "OFF"}`,
                  },
                ],
              }))
            }
            style={{
              padding: "8px 18px",
              borderRadius: 10,
              border: `1px solid ${data.customerShippedEmails ? "#BBF7D0" : "#E2E8F0"}`,
              background: data.customerShippedEmails ? "#F0FDF4" : "#F8FAFC",
              color: data.customerShippedEmails ? "#15803D" : "#64748B",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            {data.customerShippedEmails ? "ON -- customers get emails" : "OFF -- no customer emails"}
          </button>
        </div>
      </div>

      {/* Historical data import (customer list + YOY sales sheet) */}
      <HistoryImport data={data} setData={setData} />

      {/* Customer data cleanup */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          padding: "20px 24px",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "#FEFCE8",
              border: "1px solid #FDE68A",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 800,
              color: "#CA8A04",
            }}
          >
            &#10227;
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>
              Customer Data Cleanup
            </div>
            <div style={{ fontSize: 11, color: "#64748B" }}>
              Normalizes classifications in one pass: bare &quot;distributor&quot; types become
              Tier 1 Distributor, every distributor gets Net 60 payment terms, Farm &amp; Home /
              Farm &amp; Garden / Runnings stores become Buying Group, and buying-group customers
              missing a Bill-To get the Mid-States remit-to. Shows counts before applying.
            </div>
          </div>
          <button style={{ ...BS, fontSize: 12, whiteSpace: "nowrap" }} onClick={runCustomerCleanup}>
            Run Cleanup
          </button>
        </div>
        {cleanupMsg && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              background: "#F0FDF4",
              border: "1px solid #BBF7D0",
              color: "#15803D",
            }}
          >
            {cleanupMsg.text}
          </div>
        )}
      </div>

      {/* Team Notifications */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          padding: "20px 24px",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "#FFF7ED",
              border: "1px solid #FED7AA",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 800,
              color: "#EA580C",
            }}
          >
            @
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>
              Team Notifications
            </div>
            <div style={{ fontSize: 11, color: "#64748B" }}>
              Email teammates when orders reach a fulfillment stage
            </div>
          </div>
        </div>

        <div
          style={{
            background: "#F8FAFC",
            borderRadius: 10,
            padding: "14px 18px",
            marginBottom: 18,
            fontSize: 12,
            color: "#475569",
            lineHeight: 1.7,
          }}
        >
          Email a teammate when any order reaches a stage. Requires{" "}
          <code style={{ background: "#E2E8F0", padding: "1px 6px", borderRadius: 4 }}>RESEND_API_KEY</code>{" "}
          + <code style={{ background: "#E2E8F0", padding: "1px 6px", borderRadius: 4 }}>NOTIFY_FROM_EMAIL</code>{" "}
          (same as customer shipped emails).
        </div>

        {/* Current rules */}
        {notificationRules.length > 0 ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 14 }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Name</th>
                <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Email</th>
                <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Stage</th>
                <th style={{ padding: "8px 10px", width: 60 }}></th>
                <th style={{ padding: "8px 10px", width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {notificationRules.map((r, i) => (
                <tr key={r.id || i} style={{ borderBottom: "1px solid #F1F5F9" }}>
                  <td style={{ padding: "8px 10px", fontWeight: 600, color: "#0F172A" }}>
                    {r.name || "--"}
                  </td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", color: "#475569" }}>
                    {r.email}
                  </td>
                  <td style={{ padding: "8px 10px", color: "#6D28D9", fontWeight: 600 }}>
                    {STAGE_LABEL[r.stage] || r.stage}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "center" }}>
                    <button
                      onClick={() => doTestRule(r)}
                      disabled={ruleTesting != null}
                      title="Send a test email to this address now"
                      style={{
                        background: "#EFF6FF",
                        border: "1px solid #BFDBFE",
                        borderRadius: 6,
                        padding: "3px 10px",
                        color: "#1D4ED8",
                        fontWeight: 700,
                        fontSize: 11,
                        cursor: ruleTesting != null ? "default" : "pointer",
                        fontFamily: "inherit",
                        opacity: ruleTesting != null && ruleTesting !== r.id ? 0.5 : 1,
                      }}
                    >
                      {ruleTesting === r.id ? "Sending..." : "Test"}
                    </button>
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "center" }}>
                    <button
                      onClick={() => removeRule(r)}
                      title="Remove rule"
                      style={{
                        background: "#FEF2F2",
                        border: "1px solid #FECACA",
                        borderRadius: 6,
                        width: 24,
                        height: 24,
                        color: "#DC2626",
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        lineHeight: 1,
                      }}
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 14 }}>
            No notification rules yet. Add one below.
          </div>
        )}

        {/* Test send outcome */}
        {ruleTestResult && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 12,
              marginBottom: 14,
              background: ruleTestResult.result.sent ? "#F0FDF4" : "#FEF2F2",
              border: `1px solid ${ruleTestResult.result.sent ? "#BBF7D0" : "#FECACA"}`,
              color: ruleTestResult.result.sent ? "#15803D" : "#B91C1C",
              lineHeight: 1.6,
            }}
          >
            {ruleTestResult.result.sent ? (
              <>
                <strong>Test email sent</strong> to {ruleTestResult.rule.email}. Have them check
                the inbox <em>and spam folder</em>. If it never arrives, the send was accepted by
                Resend -- check the Resend dashboard logs for delivery status.
              </>
            ) : (
              <>
                <strong>Test email to {ruleTestResult.rule.email} FAILED</strong>
                {ruleTestResult.result.reason ? <> -- {ruleTestResult.result.reason}</> : null}
                {ruleTestResult.result.detail ? <>: {ruleTestResult.result.detail}</> : null}
                <div style={{ marginTop: 4, color: "#7F1D1D" }}>
                  {ruleTestResult.result.reason === "not-configured"
                    ? "RESEND_API_KEY / NOTIFY_FROM_EMAIL are not set in Vercel -- add them under Project Settings -> Environment Variables."
                    : "If the error mentions an unverified domain, the Resend DNS records still need to be added (pending with the dev agency). Until the domain verifies, Resend only delivers to the Resend account owner's own address."}
                </div>
              </>
            )}
          </div>
        )}

        {/* Add rule row */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            style={{
              background: "#FFFFFF",
              border: "1px solid #CBD5E1",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 13,
              color: "#0F172A",
              fontFamily: "inherit",
              width: 140,
            }}
            placeholder="Name"
            value={ruleForm.name}
            onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            style={{
              background: "#FFFFFF",
              border: "1px solid #CBD5E1",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 13,
              color: "#0F172A",
              fontFamily: "inherit",
              width: 220,
            }}
            type="email"
            placeholder="teammate@company.com"
            value={ruleForm.email}
            onChange={(e) => setRuleForm((f) => ({ ...f, email: e.target.value }))}
          />
          <select
            style={{
              background: "#FFFFFF",
              border: "1px solid #CBD5E1",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 13,
              color: "#0F172A",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
            value={ruleForm.stage}
            onChange={(e) => setRuleForm((f) => ({ ...f, stage: e.target.value }))}
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
          <button style={BP} onClick={addRule}>
            Add
          </button>
        </div>

        {ruleError && (
          <div
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              background: "#FEF2F2",
              color: "#B91C1C",
              border: "1px solid #FECACA",
              marginTop: 10,
              display: "inline-block",
            }}
          >
            {ruleError}
          </div>
        )}
      </div>

      {/* Data & Sync Info */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          padding: "20px 24px",
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>
          Data & Sync
        </div>
        <div
          style={{
            background: "#F8FAFC",
            borderRadius: 10,
            padding: "14px 18px",
            fontSize: 12,
            color: "#475569",
            lineHeight: 1.7,
            marginBottom: 16,
          }}
        >
          <div>
            <strong>Primary storage:</strong> Supabase (PostgreSQL + real-time sync)
          </div>
          <div>
            <strong>Fallback:</strong> Browser localStorage (offline cache)
          </div>
          <div>
            <strong>API keys:</strong> Stored server-side in Vercel environment variables only
            -- never exposed to the browser.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            style={BS}
            onClick={() => {
              if (window.confirm("Load demo data? This will overwrite your current inventory, orders, and all other data with sample data for exploring the app.")) {
                setData(makeDemoData());
              }
            }}
          >
            Load Demo Data
          </button>
          <button
            style={BD}
            onClick={() => {
              if (window.confirm("Clear ALL data? This will remove all products, orders, suppliers, and history. This cannot be undone.")) {
                setData(defaultData);
              }
            }}
          >
            Clear All Data
          </button>
        </div>
      </div>
    </div>
  );
}
