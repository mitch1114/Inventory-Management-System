import { useMemo, useState } from "react";
import { orderMargin, marginColor, MARGIN_TARGET } from "../lib/orderMargin";
import { fmt } from "../lib/utils";

const pctStr = (v) => (v == null ? "--" : `${(v * 100).toFixed(1)}%`);

// Gross margin breakdown for one order (see lib/orderMargin for the math)
export default function OrderMarginPanel({ order, products }) {
  const [showLines, setShowLines] = useState(false);
  const prodMap = useMemo(() => Object.fromEntries((products || []).map((p) => [p.id, p])), [products]);
  const m = useMemo(() => orderMargin(order, prodMap), [order, prodMap]);
  if (order.fulfillmentStage === "cancelled") return null;
  const shipped = order.fulfillmentStage === "shipped";
  const col = marginColor(m.complete ? m.marginPct : null);

  const row = (label, value, opts = {}) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12, color: opts.muted ? "#94A3B8" : "#334155", fontWeight: opts.bold ? 800 : 400, borderTop: opts.rule ? "1px solid #E2E8F0" : "none", marginTop: opts.rule ? 4 : 0, paddingTop: opts.rule ? 6 : 3 }}>
      <span>{label}</span>
      <span style={{ fontFamily: "monospace", color: opts.color }}>{value}</span>
    </div>
  );

  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 14px", marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Margin {shipped ? "" : "(expected)"}
        </span>
        <span style={{ fontSize: 18, fontWeight: 800, color: col }}>
          {m.complete ? pctStr(m.marginPct) : "--"}
          <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 8 }}>{m.complete ? fmt(m.profit) : ""}</span>
        </span>
      </div>
      {row(`Merchandise${shipped ? " (shipped units)" : ""}`, fmt(m.merch))}
      {m.freightBilled > 0 && row("Freight billed to customer", fmt(m.freightBilled))}
      {row("Landed cost of goods", `-${fmt(m.cogs)}`)}
      {row("FET (excise tax)", `-${fmt(m.fet)}`)}
      {m.freightKnown
        ? row("Shipping cost", `-${fmt(m.shippingCost)}`)
        : row("Shipping cost", "not yet known", { muted: true })}
      {row("Gross profit", m.complete ? fmt(m.profit) : "--", { bold: true, rule: true, color: col })}

      <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 6, lineHeight: 1.5 }}>
        Target {pctStr(MARGIN_TARGET)}. Before commissions, co-op/allowances and other selling costs.
        {shipped && !m.estimatedCost && " Costs locked at shipment."}
        {m.estimatedCost && (shipped ? " Uses current product costs (shipped before costs were locked)." : " Uses current product costs; locked when the order ships.")}
      </div>
      {m.missingCost.length > 0 && (
        <div style={{ fontSize: 11, color: "#B91C1C", marginTop: 6 }}>
          No cost on file for {m.missingCost.join(", ")} -- set Cost / Landed on the Inventory tab.
        </div>
      )}
      {m.missingFet.length > 0 && (
        <div style={{ fontSize: 11, color: "#B45309", marginTop: 4 }}>
          No FET rate on file for {m.missingFet.join(", ")} (counted as $0).
        </div>
      )}

      <button
        onClick={() => setShowLines((v) => !v)}
        style={{ background: "none", border: "none", padding: 0, marginTop: 8, fontSize: 11, fontWeight: 700, color: "#6D28D9", cursor: "pointer", fontFamily: "inherit" }}
      >
        {showLines ? "▾ Hide" : "▸ Show"} margin by line
      </button>
      {showLines && (
        <div style={{ overflowX: "auto", marginTop: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                {["SKU", "Qty", "Price", "Landed", "FET", "Margin"].map((h) => (
                  <th key={h} style={{ textAlign: h === "SKU" ? "left" : "right", padding: "4px 6px", color: "#64748B", fontWeight: 700, borderBottom: "1px solid #E2E8F0" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.lines.map((l, i) => {
                const lp = l.revenue > 0 && l.unitCost > 0 ? l.profit / l.revenue : null;
                return (
                  <tr key={i}>
                    <td style={{ padding: "4px 6px", fontFamily: "monospace", color: "#6D28D9" }}>{l.sku}</td>
                    <td style={{ padding: "4px 6px", textAlign: "right" }}>{l.qty}</td>
                    <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmt(l.price)}</td>
                    <td style={{ padding: "4px 6px", textAlign: "right", color: l.costSource === "missing" ? "#B91C1C" : undefined }}>
                      {l.unitCost > 0 ? fmt(l.unitCost) : "missing"}
                    </td>
                    <td style={{ padding: "4px 6px", textAlign: "right" }}>{fmt(l.unitFet)}</td>
                    <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 700, color: marginColor(lp) }}>{pctStr(lp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4 }}>Line margins exclude shipping.</div>
        </div>
      )}
    </div>
  );
}
