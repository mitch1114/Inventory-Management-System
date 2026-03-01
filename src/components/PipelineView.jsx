import { useState, useMemo } from "react";
import { STAGES, STAGE_LABEL, STAGE_NEXT, STAGE_BTN, LOCKING } from "../lib/constants";
import { computeInventory, advanceStage } from "../lib/inventory";
import { fmt, fmtNum, fmtDate, todayIso } from "../lib/utils";
import { Badge, Modal, Field, IS, BP, BS } from "./ui";

export default function PipelineView({ data, setData }) {
  const [advModal, setAdvModal] = useState(null);
  const [shipForm, setShipForm] = useState({ carrier: "", trackingNum: "", shipDate: todayIso() });
  const computedProds = useMemo(
    () => computeInventory(data.products, data.salesOrders),
    [data.products, data.salesOrders],
  );
  const stageOrders = useMemo(() => {
    const m = {};
    STAGES.forEach((s) => {
      m[s] = [];
    });
    data.salesOrders.forEach((o) => {
      if (m[o.fulfillmentStage]) m[o.fulfillmentStage].push(o);
    });
    return m;
  }, [data.salesOrders]);
  const SCOL = { confirmed: "#3B82F6", picked: "#EAB308", booked: "#06B6D4", shipped: "#10B981" };

  const doAdvance = () => {
    const o = advModal;
    const next = STAGE_NEXT[o.fulfillmentStage];
    if (!next) return;
    setData((d) => advanceStage(d, o.id, next, next === "shipped" ? shipForm : null));
    setAdvModal(null);
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>
          Fulfillment Pipeline
        </h2>
        <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 13 }}>
          Inventory is locked at <strong style={{ color: "#93C5FD" }}>Confirmed</strong> and stays
          locked until <strong style={{ color: "#15803D" }}>Shipped</strong>. OnHand only decrements
          at shipment.
        </p>
      </div>

      {/* Live inventory strip */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          padding: "14px 18px",
          marginBottom: 20,
          overflowX: "auto",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#64748B",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 12,
          }}
        >
          Live Inventory &mdash; Available to Promise
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
          <thead>
            <tr>
              {["SKU", "Product", "On Hand", "Locked", "Backordered", "Available"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "6px 12px",
                    textAlign: "left",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#64748B",
                    textTransform: "uppercase",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {computedProds.map((p) => (
              <tr key={p.id} style={{ borderTop: "1px solid #F1F5F9" }}>
                <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 11, color: "#64748B" }}>
                  {p.sku}
                </td>
                <td style={{ padding: "8px 12px", fontSize: 13, color: "#334155", fontWeight: 500 }}>
                  {p.name}
                </td>
                <td style={{ padding: "8px 12px", fontSize: 14, color: "#0F172A", fontWeight: 700 }}>
                  {fmtNum(p.onHand)}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    fontSize: 13,
                    color: p.locked > 0 ? "#EAB308" : "#64748B",
                    fontWeight: p.locked > 0 ? 700 : 400,
                  }}
                >
                  {p.locked > 0 ? `-${fmtNum(p.locked)}` : "--"}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    fontSize: 13,
                    color: p.backordered > 0 ? "#F97316" : "#64748B",
                    fontWeight: p.backordered > 0 ? 700 : 400,
                  }}
                >
                  {p.backordered > 0 ? fmtNum(p.backordered) : "--"}
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <span
                    style={{
                      background: p.available === 0 ? "#FEF2F2" : p.available <= p.reorderPoint ? "#FEFCE8" : "#F0FDF4",
                      color: p.available === 0 ? "#B91C1C" : p.available <= p.reorderPoint ? "#854D0E" : "#15803D",
                      border: `1px solid ${p.available === 0 ? "#FECACA" : p.available <= p.reorderPoint ? "#FDE68A" : "#BBF7D0"}`,
                      borderRadius: 20,
                      padding: "3px 14px",
                      fontSize: 14,
                      fontWeight: 800,
                      display: "inline-block",
                    }}
                  >
                    {fmtNum(p.available)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Kanban columns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {STAGES.map((stage) => {
          const col = SCOL[stage];
          const orders = stageOrders[stage] || [];
          const units = orders.reduce(
            (s, o) => s + o.lines.reduce((ls, l) => ls + (l.qtyFilled != null ? l.qtyFilled : l.qty), 0),
            0,
          );
          const value = orders.reduce(
            (s, o) =>
              s + o.lines.reduce((ls, l) => ls + (l.qtyFilled != null ? l.qtyFilled : l.qty) * l.price, 0),
            0,
          );
          return (
            <div
              key={stage}
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: "#F8FAFC",
                  borderBottom: "1px solid #E2E8F0",
                  padding: "12px 14px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: col, flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, color: "#0F172A", fontSize: 13 }}>
                    {STAGE_LABEL[stage]}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      background: col + "22",
                      color: col,
                      border: `1px solid ${col}44`,
                      borderRadius: 10,
                      padding: "1px 8px",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {orders.length}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#64748B" }}>
                  {fmtNum(units)} units &middot; {fmt(value)}
                  {LOCKING.has(stage) ? " (locked)" : ""}
                </div>
              </div>
              <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 100 }}>
                {orders.length === 0 && (
                  <div style={{ color: "#94A3B8", fontSize: 12, textAlign: "center", paddingTop: 20 }}>
                    Empty
                  </div>
                )}
                {orders.map((o) => {
                  const total = o.lines.reduce(
                    (s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty) * l.price,
                    0,
                  );
                  const hasBO = o.lines.some(
                    (l) => (l.qtyBackordered != null ? l.qtyBackordered : 0) > 0,
                  );
                  const next = STAGE_NEXT[stage];
                  return (
                    <div
                      key={o.id}
                      style={{
                        background: "#FFFFFF",
                        border: "1px solid #E2E8F0",
                        borderRadius: 10,
                        padding: "10px 12px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: "#6D28D9", fontFamily: "monospace" }}>
                          {o.orderNum}
                        </span>
                        {hasBO && <Badge status="backordered" label="Has BO" />}
                        {o.type === "preorder" && !hasBO && <Badge status="preorder" label="Pre-order" />}
                      </div>
                      <div style={{ fontSize: 13, color: "#0F172A", fontWeight: 600, marginBottom: 2 }}>
                        {o.customer}
                      </div>
                      {o.dealerPORef && (
                        <div style={{ fontSize: 11, fontFamily: "monospace", color: "#64748B", marginBottom: 3 }}>
                          {o.dealerPORef}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: "#64748B", marginBottom: 6 }}>
                        {fmtDate(o.date)} &middot;{" "}
                        {o.lines.reduce((s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty), 0)}{" "}
                        units &middot; {fmt(total)}
                      </div>
                      {LOCKING.has(stage) && (
                        <div
                          style={{
                            background: "#F1F5F9",
                            borderRadius: 6,
                            padding: "3px 8px",
                            marginBottom: 6,
                            fontSize: 11,
                            color: "#854D0E",
                          }}
                        >
                          {o.lines.reduce((s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty), 0)}{" "}
                          units locked
                        </div>
                      )}
                      {o.shipment && o.shipment.carrier && (
                        <div style={{ fontSize: 11, color: "#64748B", marginBottom: 5 }}>
                          {o.shipment.carrier} {o.shipment.trackingNum}
                        </div>
                      )}
                      {next && (
                        <button
                          onClick={() => {
                            setAdvModal(o);
                            setShipForm({
                              carrier: (o.shipment && o.shipment.carrier) || "",
                              trackingNum: (o.shipment && o.shipment.trackingNum) || "",
                              shipDate: todayIso(),
                            });
                          }}
                          style={{
                            width: "100%",
                            padding: "6px",
                            borderRadius: 7,
                            border: `1px solid ${col}55`,
                            background: col + "18",
                            color: col,
                            fontWeight: 700,
                            fontSize: 11,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          {STAGE_BTN[stage]} &rarr;
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {advModal && (
        <Modal title={`Advance ${advModal.orderNum}`} onClose={() => setAdvModal(null)} width={480}>
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E8F0",
              borderRadius: 10,
              padding: "12px 16px",
              marginBottom: 18,
            }}
          >
            <div style={{ fontSize: 13, color: "#64748B" }}>
              Moving <strong style={{ color: "#0F172A" }}>{advModal.orderNum}</strong> &middot;{" "}
              <strong style={{ color: "#0F172A" }}>{advModal.customer}</strong>
            </div>
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 4 }}>
              {STAGE_LABEL[advModal.fulfillmentStage]} &rarr;{" "}
              <span
                style={{
                  color: { confirmed: "#EAB308", picked: "#06B6D4", booked: "#10B981" }[advModal.fulfillmentStage],
                }}
              >
                {STAGE_LABEL[STAGE_NEXT[advModal.fulfillmentStage]]}
              </span>
            </div>
          </div>
          {STAGE_NEXT[advModal.fulfillmentStage] === "shipped" && (
            <div>
              <div
                style={{
                  background: "#F0FDF4",
                  border: "1px solid #BBF7D0",
                  borderRadius: 10,
                  padding: "10px 14px",
                  marginBottom: 16,
                  fontSize: 13,
                  color: "#15803D",
                }}
              >
                Marking <strong>Shipped</strong> will permanently deduct{" "}
                {advModal.lines.reduce((s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty), 0)}{" "}
                units from on-hand inventory.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                <Field label="Carrier">
                  <input
                    style={IS}
                    value={shipForm.carrier}
                    onChange={(e) => setShipForm((f) => ({ ...f, carrier: e.target.value }))}
                    placeholder="UPS, FedEx, USPS..."
                  />
                </Field>
                <Field label="Ship Date">
                  <input
                    style={IS}
                    type="date"
                    value={shipForm.shipDate}
                    onChange={(e) => setShipForm((f) => ({ ...f, shipDate: e.target.value }))}
                  />
                </Field>
              </div>
              <Field label="Tracking Number">
                <input
                  style={IS}
                  value={shipForm.trackingNum}
                  onChange={(e) => setShipForm((f) => ({ ...f, trackingNum: e.target.value }))}
                  placeholder="Optional"
                />
              </Field>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button style={BS} onClick={() => setAdvModal(null)}>
              Cancel
            </button>
            <button style={BP} onClick={doAdvance}>
              {STAGE_BTN[advModal.fulfillmentStage]}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
