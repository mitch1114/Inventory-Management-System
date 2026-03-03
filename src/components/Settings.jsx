import { useState } from "react";
import { testConnection } from "../lib/shipstation";
import { BP, BS } from "./ui";

export default function Settings() {
  const [ssTesting, setSsTesting] = useState(false);
  const [ssResult, setSsResult] = useState(null);

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

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>Settings</h2>
        <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 13 }}>
          Manage integrations and application configuration.
        </p>
      </div>

      {/* ShipStation Integration */}
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
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>ShipStation</div>
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
              to your Vercel environment variables. Find both at ShipStation &rarr; Account &rarr; Settings &rarr; API Settings.
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
          <div style={{ fontSize: 12, color: "#64748B", marginBottom: 10 }}>
            Go to your Vercel project &rarr; Settings &rarr; Environment Variables and add:
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              <tr style={{ borderBottom: "1px solid #F1F5F9" }}>
                <td style={{ padding: "8px 0", fontFamily: "monospace", fontWeight: 600, color: "#6D28D9" }}>
                  SHIPSTATION_API_KEY
                </td>
                <td style={{ padding: "8px 0", color: "#64748B" }}>
                  <strong>Required.</strong> Your ShipStation API Key
                </td>
              </tr>
              <tr>
                <td style={{ padding: "8px 0", fontFamily: "monospace", fontWeight: 600, color: "#6D28D9" }}>
                  SHIPSTATION_API_SECRET
                </td>
                <td style={{ padding: "8px 0", color: "#64748B" }}>
                  <strong>Required.</strong> Your ShipStation API Secret (shown below the API Key on the same page)
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
