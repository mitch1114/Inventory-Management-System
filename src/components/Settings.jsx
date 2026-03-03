import { useState, useCallback } from "react";
import { testConnection, testConnectionV2, getWarehouses, pullInventory, pushInventory } from "../lib/shipstation";
import { BP, BS } from "./ui";

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

      {/* Data & Sync Info */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          padding: "20px 24px",
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
      </div>
    </div>
  );
}
