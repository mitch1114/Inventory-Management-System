import { useState, useMemo } from "react";
import { STAGES, STAGE_LABEL, STAGE_NEXT, STAGE_BTN, LOCKING, CHANNELS } from "../lib/constants";
import { computeInventory, advanceStage, resolveBackorders } from "../lib/inventory";
import BackorderPolicyPicker from "./BackorderPolicyPicker";
import { uid, fmt, fmtNum, fmtDate, nowIso, todayIso, toCSV, dlCSV } from "../lib/utils";
import { isQboConnected, fetchInvoices, createInvoiceForOrder } from "../lib/qbo";
import { pushOrder } from "../lib/shipstation";
import { sendShippedEmail, sendStageNotifications } from "../lib/notify";
import { Badge, Modal, Field, Table, TR, TD, IS, SS, BP, BS, BD, BAq, BG } from "./ui";
import DealerPOImport from "./DealerPOImport";

// Display label for a sales channel value (falls back to the raw value)
const channelLabel = (v) => {
  const c = CHANNELS.find((ch) => ch.value === v);
  return c ? c.label : v;
};

// Build a QuickBooks Online invoice-import CSV for the given orders: one row
// per line item, grouped into invoices by InvoiceNo, using the column names
// QBO's import mapper recognizes. Dates are M/D/YYYY; DueDate is invoice date
// + 30 days (Net 30). Returns null when there is nothing to export.
function buildQboInvoiceCSV(orders, prodMap) {
  const mdY = (iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return `${m}/${d}/${y}`;
  };
  const plusDays = (iso, days) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    const dt = new Date(y, m - 1, d + days);
    return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()}`;
  };
  const esc = (v) => {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "InvoiceNo",
    "Customer",
    "InvoiceDate",
    "DueDate",
    "Terms",
    "Item(Product/Service)",
    "ItemDescription",
    "ItemQuantity",
    "ItemRate",
    "ItemAmount",
  ];
  const rows = [];
  orders.forEach((o) => {
    if (o.fulfillmentStage === "cancelled") return;
    const invDate = (o.shipment && o.shipment.shipDate) || o.date;
    o.lines.forEach((l) => {
      const qty = l.qtyFilled != null ? l.qtyFilled : l.qty;
      if (qty <= 0) return;
      const prod = prodMap[l.productId];
      rows.push([
        o.orderNum,
        o.customer,
        mdY(invDate),
        plusDays(invDate, 30),
        "Net 30",
        prod ? prod.sku : "",
        prod ? prod.name : "",
        qty,
        (l.price || 0).toFixed(2),
        (qty * (l.price || 0)).toFixed(2),
      ]);
    });
  });
  if (rows.length === 0) return null;
  return [header.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

// --- OrderDrawer (detail panel) ------------------------------------------------
function OrderDrawer({ order, data, setData, onClose, onEdit }) {
  const [shipModal, setShipModal] = useState(false);
  const [boPolicy, setBoPolicy] = useState("kill"); // what to do with backorders at ship time
  const [autoStatus, setAutoStatus] = useState(""); // ShipStation / QBO automation status message
  const [shipForm, setShipForm] = useState({
    carrier: "",
    trackingNum: "",
    shipDate: todayIso(),
  });

  const prodMap = useMemo(
    () => Object.fromEntries(data.products.map((p) => [p.id, p])),
    [data.products],
  );

  const computedProds = useMemo(
    () => computeInventory(data.products, data.salesOrders),
    [data.products, data.salesOrders],
  );

  const computedMap = useMemo(
    () => Object.fromEntries(computedProds.map((p) => [p.id, p])),
    [computedProds],
  );

  if (!order) return null;

  const nextStage = STAGE_NEXT[order.fulfillmentStage];
  const isCancelled = order.fulfillmentStage === "cancelled";
  const isShipped = order.fulfillmentStage === "shipped";

  const totalUnits = order.lines.reduce(
    (s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty),
    0,
  );
  const totalValue = order.lines.reduce(
    (s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty) * l.price,
    0,
  );
  const totalBO = order.lines.reduce(
    (s, l) => s + (l.qtyBackordered != null ? l.qtyBackordered : 0),
    0,
  );

  // --- Stage advance ---
  const showAutoStatus = (msg) => {
    setAutoStatus(msg);
    setTimeout(() => setAutoStatus(""), 6000);
  };

  // Same stage automation as PipelineView: push to ShipStation when the
  // order reaches "picked" (fallback at "booked" for orders not yet pushed) and
  // auto-create a QBO invoice. Fire-and-forget -- never blocks the advance.
  const runStageAutomation = (stage) => {
    const advancedOrder = { ...order, fulfillmentStage: stage };

    // Fire-and-forget teammate stage notification -- never blocks the advance.
    // The shipped path goes through confirmShip (which never calls this), so
    // each transition notifies exactly once.
    try {
      sendStageNotifications(advancedOrder, stage, data.notificationRules);
    } catch (_e) {
      /* ignore */
    }

    if ((stage === "picked" || stage === "booked") && !order.shipstationOrderId) {
      pushOrder(advancedOrder, data.products, data.customers)
        .then((result) => {
          if (result.success) {
            showAutoStatus(`Pushed ${order.orderNum} to ShipStation`);
            setData((d) => ({
              ...d,
              salesOrders: d.salesOrders.map((so) =>
                so.id === order.id
                  ? { ...so, shipstationOrderId: result.shipstationOrderId, ssOrderNumber: result.orderNumber }
                  : so,
              ),
              auditLog: [
                ...(d.auditLog || []),
                {
                  id: uid(),
                  ts: nowIso(),
                  type: "shipstation-push",
                  entity: order.orderNum,
                  description: `Pushed ${order.orderNum} to ShipStation (ID: ${result.shipstationOrderId})`,
                },
              ],
            }));
          } else {
            showAutoStatus(`ShipStation push failed: ${result.error || "Unknown error"}`);
          }
        })
        .catch((err) => showAutoStatus(`ShipStation push failed: ${err.message}`));
    }

    if (stage === "booked" && isQboConnected() && !order.qboInvoice) {
      createInvoiceForOrder(advancedOrder, prodMap).then((result) => {
        if (result && result.success) {
          const skippedNote =
            result.skippedSkus && result.skippedSkus.length > 0
              ? ` -- skipped SKUs with no QBO item: ${result.skippedSkus.join(", ")}`
              : "";
          setData((d) => ({
            ...d,
            salesOrders: d.salesOrders.map((so) =>
              so.id === order.id
                ? { ...so, qboInvoice: { ...result.invoice, status: "open" } }
                : so,
            ),
            auditLog: [
              ...(d.auditLog || []),
              {
                id: uid(),
                ts: nowIso(),
                type: "qbo-invoice",
                entity: order.orderNum,
                description: `Created QBO invoice #${result.invoice.docNumber} for ${order.orderNum} (unsent draft)${skippedNote}`,
              },
            ],
          }));
        } else if (result && !result.skipped) {
          showAutoStatus("QBO invoice creation failed -- create manually");
        }
      });
    }
  };

  const doAdvance = (info) => {
    if (!nextStage) return;
    setData((d) => advanceStage(d, order.id, nextStage, info || null));
    runStageAutomation(nextStage);
  };

  const handleStageClick = () => {
    if (nextStage === "shipped") {
      setShipForm({
        carrier: (order.shipment && order.shipment.carrier) || "",
        trackingNum: (order.shipment && order.shipment.trackingNum) || "",
        shipDate: todayIso(),
      });
      setBoPolicy("kill");
      setShipModal(true);
    } else {
      doAdvance();
    }
  };

  const confirmShip = () => {
    // Resolve any outstanding backorders (fill & kill or split) before shipping
    setData((d) => advanceStage(resolveBackorders(d, order.id, boPolicy), order.id, "shipped", shipForm));
    setShipModal(false);
    // Fire-and-forget shipped notifications -- never block or fail the ship
    // flow. confirmShip bypasses runStageAutomation, so the teammate "shipped"
    // notification is sent here (exactly once per transition).
    try {
      sendShippedEmail({ ...order, shipment: shipForm }, data.customers);
    } catch (_e) {
      /* ignore */
    }
    try {
      sendStageNotifications(
        { ...order, fulfillmentStage: "shipped", shipment: shipForm },
        "shipped",
        data.notificationRules,
      );
    } catch (_e) {
      /* ignore */
    }
  };

  // --- Cancel order ---
  const cancelOrder = () => {
    if (!confirm(`Cancel ${order.orderNum}? This will release locked inventory.`)) return;
    setData((d) => ({
      ...d,
      salesOrders: d.salesOrders.map((o) =>
        o.id === order.id ? { ...o, fulfillmentStage: "cancelled" } : o,
      ),
      auditLog: [
        ...(d.auditLog || []),
        {
          id: uid(),
          ts: nowIso(),
          type: "cancelled",
          entity: order.orderNum,
          description: `Cancelled ${order.orderNum} (${order.customer})`,
        },
      ],
    }));
  };

  // --- Permanent delete: removes the order from ALL sales data (lists, counts,
  // revenue, fill rate). Unlike Cancel, no record remains except an audit entry.
  const deleteOrder = () => {
    const shippedWarning =
      order.fulfillmentStage === "shipped"
        ? "\n\nThis order was SHIPPED -- deleting removes its revenue and history from every report (on-hand stock is NOT restored)."
        : order.fulfillmentStage !== "cancelled"
          ? "\n\nAny inventory locked by this order will be released."
          : "";
    if (
      !confirm(
        `PERMANENTLY DELETE ${order.orderNum} (${order.customer})?${shippedWarning}\n\nThis cannot be undone.`,
      )
    )
      return;
    setData((d) => ({
      ...d,
      salesOrders: d.salesOrders.filter((o) => o.id !== order.id),
      auditLog: [
        ...(d.auditLog || []),
        {
          id: uid(),
          ts: nowIso(),
          type: "adjustment",
          entity: order.orderNum,
          description: `Deleted ${order.orderNum} (${order.customer}) -- ${order.lines.length} lines, stage was ${order.fulfillmentStage}`,
        },
      ],
    }));
    onClose();
  };

  // --- CSV export ---
  const exportCSV = () => {
    const rows = order.lines.map((l) => {
      const p = prodMap[l.productId];
      return {
        SKU: p ? p.sku : l.productId,
        Product: p ? p.name : "--",
        Qty: l.qty,
        Filled: l.qtyFilled != null ? l.qtyFilled : l.qty,
        Backordered: l.qtyBackordered != null ? l.qtyBackordered : 0,
        Price: l.price,
        ExtPrice: (l.qtyFilled != null ? l.qtyFilled : l.qty) * l.price,
      };
    });
    const csv = toCSV(rows, ["SKU", "Product", "Qty", "Filled", "Backordered", "Price", "ExtPrice"]);
    dlCSV(csv, `${order.orderNum}-lines.csv`);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: 620,
        height: "100vh",
        background: "#FFFFFF",
        borderLeft: "1px solid #E2E8F0",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.08)",
        zIndex: 900,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "18px 22px",
          borderBottom: "1px solid #E2E8F0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "#F8FAFC",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontFamily: "monospace",
              fontWeight: 800,
              fontSize: 16,
              color: "#6D28D9",
            }}
          >
            {order.orderNum}
          </span>
          <Badge
            status={order.fulfillmentStage}
            label={STAGE_LABEL[order.fulfillmentStage] || order.fulfillmentStage}
          />
          {order.type === "preorder" && <Badge status="preorder" label="Pre-order" />}
          {order.type === "distributor" && <Badge status="distributor" label="Distributor" />}
          {order.showOrder && <Badge status="show-order" label="Show" />}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!isCancelled && !isShipped && (
            <button style={{ ...BS, padding: "6px 12px", fontSize: 12 }} onClick={onEdit}>
              Edit
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: "#F1F5F9",
              border: "1px solid #E2E8F0",
              color: "#64748B",
              cursor: "pointer",
              fontSize: 16,
              borderRadius: 8,
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            &times;
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto", padding: "18px 22px" }}>
        {/* ShipStation / QBO automation status */}
        {autoStatus && (
          <div
            style={{
              background: autoStatus.includes("failed") ? "#FEF2F2" : "#F0FDF4",
              border: `1px solid ${autoStatus.includes("failed") ? "#FECACA" : "#BBF7D0"}`,
              borderRadius: 10,
              padding: "8px 14px",
              marginBottom: 14,
              fontSize: 12,
              fontWeight: 600,
              color: autoStatus.includes("failed") ? "#DC2626" : "#15803D",
            }}
          >
            {autoStatus}
          </div>
        )}

        {/* Order info grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "10px 20px",
            marginBottom: 18,
          }}
        >
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
              Customer
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A" }}>
              {order.customer}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
              Order Date
            </div>
            <div style={{ fontSize: 14, color: "#334155" }}>{fmtDate(order.date)}</div>
          </div>
          {order.requestedShipDate && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                Requested Ship
              </div>
              <div style={{ fontSize: 14, color: "#334155" }}>
                {fmtDate(order.requestedShipDate)}
              </div>
            </div>
          )}
          {order.dealerPORef && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                Dealer PO Ref
              </div>
              <div style={{ fontSize: 14, fontFamily: "monospace", color: "#334155" }}>
                {order.dealerPORef}
              </div>
            </div>
          )}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
              Type
            </div>
            <div style={{ fontSize: 14, color: "#334155" }}>
              {order.type || "standard"}
            </div>
          </div>
        </div>

        {/* Summary strip */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 10,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              background: "#F8FAFC",
              border: "1px solid #E2E8F0",
              borderRadius: 10,
              padding: "10px 14px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0F172A" }}>
              {fmtNum(totalUnits)}
            </div>
            <div style={{ fontSize: 10, color: "#64748B", fontWeight: 600, textTransform: "uppercase" }}>
              Units Filled
            </div>
          </div>
          <div
            style={{
              background: "#F8FAFC",
              border: "1px solid #E2E8F0",
              borderRadius: 10,
              padding: "10px 14px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0F172A" }}>
              {fmt(totalValue)}
            </div>
            <div style={{ fontSize: 10, color: "#64748B", fontWeight: 600, textTransform: "uppercase" }}>
              Order Value
            </div>
          </div>
          <div
            style={{
              background: totalBO > 0 ? "#FFF7ED" : "#F8FAFC",
              border: `1px solid ${totalBO > 0 ? "#FED7AA" : "#E2E8F0"}`,
              borderRadius: 10,
              padding: "10px 14px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: totalBO > 0 ? "#EA580C" : "#0F172A",
              }}
            >
              {fmtNum(totalBO)}
            </div>
            <div style={{ fontSize: 10, color: "#64748B", fontWeight: 600, textTransform: "uppercase" }}>
              Backordered
            </div>
          </div>
        </div>

        {/* Shipment info */}
        {order.shipment && order.shipment.carrier && (
          <div
            style={{
              background: "#F0FDF4",
              border: "1px solid #BBF7D0",
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 18,
              fontSize: 13,
              color: "#15803D",
            }}
          >
            <strong>Shipment:</strong> {order.shipment.carrier}
            {order.shipment.trackingNum ? ` -- ${order.shipment.trackingNum}` : ""}
            {order.shipment.shipDate ? ` -- ${fmtDate(order.shipment.shipDate)}` : ""}
          </div>
        )}

        {/* Linked QBO Invoice */}
        {order.qboInvoice && (
          <div
            style={{
              background: "#F0FDF4",
              border: "1px solid #BBF7D0",
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 18,
              fontSize: 13,
              color: "#15803D",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <strong>QB Invoice:</strong> #{order.qboInvoice.docNumber || order.qboInvoice.qboId}
              {" -- "}{fmt(order.qboInvoice.totalAmount)}
              {order.qboInvoice.status === "paid" && (
                <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, background: "#DCFCE7", padding: "2px 8px", borderRadius: 8 }}>
                  PAID
                </span>
              )}
              {order.qboInvoice.balance > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, color: "#EA580C" }}>
                  ({fmt(order.qboInvoice.balance)} due)
                </span>
              )}
            </div>
          </div>
        )}

        {/* Notes */}
        {order.notes && (
          <div
            style={{
              background: "#FEFCE8",
              border: "1px solid #FDE68A",
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 18,
              fontSize: 13,
              color: "#854D0E",
            }}
          >
            <strong>Notes:</strong> {order.notes}
          </div>
        )}

        {/* Special instructions */}
        {order.specialInstructions && (
          <div
            style={{
              background: "#FFFBEB",
              border: "1px solid #FDE68A",
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 18,
              fontSize: 13,
              color: "#92400E",
            }}
          >
            <strong>Special Instructions:</strong> {order.specialInstructions}
          </div>
        )}

        {/* Stage progression */}
        {!isCancelled && !isShipped && nextStage && (
          <div style={{ marginBottom: 18, display: "flex", gap: 8 }}>
            <button style={BP} onClick={handleStageClick}>
              {STAGE_BTN[order.fulfillmentStage]} &rarr;
            </button>
            <button style={BD} onClick={deleteOrder}>
              Delete Order
            </button>
            <button style={BD} onClick={cancelOrder}>
              Cancel Order
            </button>
          </div>
        )}
        {isCancelled && (
          <div
            style={{
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 18,
              fontSize: 13,
              color: "#B91C1C",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span style={{ flex: 1 }}>This order has been cancelled.</span>
            <button style={{ ...BD, whiteSpace: "nowrap" }} onClick={deleteOrder}>
              Delete Order
            </button>
          </div>
        )}
        {isShipped && (
          <div style={{ marginBottom: 18, display: "flex", justifyContent: "flex-end" }}>
            <button style={BD} onClick={deleteOrder}>
              Delete Order
            </button>
          </div>
        )}

        {/* Line items table */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: 13,
              color: "#334155",
            }}
          >
            Line Items ({order.lines.length})
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              style={{ ...BS, padding: "5px 12px", fontSize: 11 }}
              onClick={exportCSV}
            >
              Export CSV
            </button>
            <button
              style={{ ...BS, padding: "5px 12px", fontSize: 11 }}
              onClick={() => {
                const csv = buildQboInvoiceCSV([order], prodMap);
                if (csv) dlCSV(csv, `${order.orderNum}-qbo-invoice.csv`);
              }}
            >
              Export for QBO
            </button>
          </div>
        </div>

        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E2E8F0",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                {["SKU", "Product", "Qty", "Filled", "BO", "Price", "Ext"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "9px 10px",
                      textAlign: "left",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#94A3B8",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l, i) => {
                const p = prodMap[l.productId];
                const filled = l.qtyFilled != null ? l.qtyFilled : l.qty;
                const bo = l.qtyBackordered != null ? l.qtyBackordered : 0;
                const cp = computedMap[l.productId];
                return (
                  <tr
                    key={i}
                    style={{
                      borderBottom: "1px solid #F1F5F9",
                      background: i % 2 === 0 ? "transparent" : "#FAFAFA",
                    }}
                  >
                    <td
                      style={{
                        padding: "9px 10px",
                        fontSize: 11,
                        fontFamily: "monospace",
                        fontWeight: 600,
                        color: "#6D28D9",
                      }}
                    >
                      {p ? p.sku : l.productId}
                    </td>
                    <td style={{ padding: "9px 10px", fontSize: 12, color: "#334155" }}>
                      {p ? p.name : "--"}
                      {cp && LOCKING.has(order.fulfillmentStage) && (
                        <div style={{ fontSize: 10, color: "#94A3B8" }}>
                          {fmtNum(cp.available)} avail
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "9px 10px", fontSize: 13, color: "#0F172A", fontWeight: 600 }}>
                      {l.qty}
                    </td>
                    <td style={{ padding: "9px 10px", fontSize: 13, color: "#15803D", fontWeight: 600 }}>
                      {filled}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        fontSize: 13,
                        fontWeight: 600,
                        color: bo > 0 ? "#EA580C" : "#94A3B8",
                      }}
                    >
                      {bo > 0 ? bo : "--"}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        fontSize: 12,
                        fontFamily: "monospace",
                        color: "#374151",
                      }}
                    >
                      {fmt(l.price)}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        fontSize: 12,
                        fontFamily: "monospace",
                        fontWeight: 600,
                        color: "#0F172A",
                      }}
                    >
                      {fmt(filled * l.price)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Total row */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              padding: "10px 14px",
              borderTop: "1px solid #E2E8F0",
              background: "#F8FAFC",
              fontWeight: 700,
              fontSize: 14,
              color: "#0F172A",
            }}
          >
            Total: {fmt(totalValue)}
          </div>
        </div>
      </div>

      {/* Ship confirmation modal */}
      {shipModal && (
        <Modal
          title={`Ship ${order.orderNum}`}
          onClose={() => setShipModal(false)}
          width={480}
        >
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
            <strong>{fmtNum(totalUnits)}</strong> units from on-hand inventory.
          </div>
          {totalBO > 0 && (
            <BackorderPolicyPicker count={totalBO} value={boPolicy} onChange={setBoPolicy} />
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="Carrier">
              <input
                style={IS}
                value={shipForm.carrier}
                onChange={(e) =>
                  setShipForm((f) => ({ ...f, carrier: e.target.value }))
                }
                placeholder="UPS, FedEx, USPS..."
              />
            </Field>
            <Field label="Ship Date">
              <input
                style={IS}
                type="date"
                value={shipForm.shipDate}
                onChange={(e) =>
                  setShipForm((f) => ({ ...f, shipDate: e.target.value }))
                }
              />
            </Field>
          </div>
          <Field label="Tracking Number">
            <input
              style={IS}
              value={shipForm.trackingNum}
              onChange={(e) =>
                setShipForm((f) => ({ ...f, trackingNum: e.target.value }))
              }
              placeholder="Optional"
            />
          </Field>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button style={BS} onClick={() => setShipModal(false)}>
              Cancel
            </button>
            <button style={BP} onClick={confirmShip}>
              Confirm Shipment
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- Blank order helpers -------------------------------------------------------
const blankOrder = () => ({
  customer: "",
  date: todayIso(),
  type: "standard",
  dealerPORef: "",
  lines: [],
  shipment: {},
  notes: "",
});

const blankLine = () => ({ productId: "", qty: 1, price: 0, qtyFilled: 0, qtyBackordered: 0 });

// --- SalesOrders (main component) ----------------------------------------------
export default function SalesOrders({ data, setData }) {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [selected, setSelected] = useState(null); // order object for drawer
  const [editing, setEditing] = useState(null); // null | "new" | "preorder" | order object
  const [form, setForm] = useState(blankOrder());
  const [showImport, setShowImport] = useState(false);

  // Invoice linking
  const [invoiceModal, setInvoiceModal] = useState(null); // order to view invoice for
  const [invoicePicker, setInvoicePicker] = useState(null); // order to pick invoice for
  const [invoiceCandidates, setInvoiceCandidates] = useState(null);
  const [invoiceFetching, setInvoiceFetching] = useState(false);
  const [invoiceError, setInvoiceError] = useState(null);

  const prodMap = useMemo(
    () => Object.fromEntries(data.products.map((p) => [p.id, p])),
    [data.products],
  );

  const computedProds = useMemo(
    () => computeInventory(data.products, data.salesOrders),
    [data.products, data.salesOrders],
  );

  const computedMap = useMemo(
    () => Object.fromEntries(computedProds.map((p) => [p.id, p])),
    [computedProds],
  );

  // --- Invoice linking helpers --------------------------------------------------
  const doFetchInvoiceForOrder = async (order) => {
    setInvoicePicker(order);
    setInvoiceFetching(true);
    setInvoiceError(null);
    setInvoiceCandidates(null);
    try {
      // Search QBO invoices around the order date range
      const result = await fetchInvoices({
        startDate: order.date,
        maxResults: 50,
      });
      setInvoiceCandidates(result.salesOrders || []);
    } catch (err) {
      setInvoiceError(err.message);
    }
    setInvoiceFetching(false);
  };

  const linkInvoice = (order, invoice) => {
    setData((d) => ({
      ...d,
      salesOrders: d.salesOrders.map((o) =>
        o.id === order.id
          ? {
              ...o,
              qboInvoice: {
                qboId: invoice.qboId,
                docNumber: invoice.qboDocNumber,
                customer: invoice.customer,
                date: invoice.date,
                totalAmount: invoice.totalAmount,
                balance: invoice.balance,
                status: invoice.status,
                lines: invoice.lines,
              },
            }
          : o,
      ),
    }));
    setInvoicePicker(null);
    setInvoiceCandidates(null);
  };

  // Filtered + sorted orders
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.salesOrders
      .filter((o) => {
        if (stageFilter !== "all" && o.fulfillmentStage !== stageFilter) return false;
        if (!q) return true;
        return (
          o.orderNum.toLowerCase().includes(q) ||
          o.customer.toLowerCase().includes(q) ||
          (o.dealerPORef || "").toLowerCase().includes(q) ||
          (o.notes || "").toLowerCase().includes(q) ||
          o.fulfillmentStage.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [data.salesOrders, search, stageFilter]);

  // Stage counts for filter tabs
  const stageCounts = useMemo(() => {
    const c = { all: data.salesOrders.length };
    STAGES.forEach((s) => {
      c[s] = data.salesOrders.filter((o) => o.fulfillmentStage === s).length;
    });
    c.cancelled = data.salesOrders.filter((o) => o.fulfillmentStage === "cancelled").length;
    return c;
  }, [data.salesOrders]);

  // --- Open edit -----------------------------------------------------------------
  // New orders are created exclusively through the dealer/distributor PO import
  // (which offers regular vs pre-order); this modal remains for editing.
  const openEdit = (order) => {
    setForm({
      customer: order.customer,
      date: order.date,
      type: order.type || "standard",
      dealerPORef: order.dealerPORef || "",
      lines: order.lines.map((l) => ({ ...l })),
      shipment: order.shipment || {},
      notes: order.notes || "",
    });
    setEditing(order);
  };

  // --- Save order ---------------------------------------------------------------
  const save = () => {
    if (editing === "new" || editing === "preorder") {
      const num = (data.counters.so || 0) + 1;
      const isPreorder = editing === "preorder";
      const lines = form.lines
        .filter((l) => l.productId)
        .map((l) => {
          if (isPreorder) {
            // Pre-orders: everything goes to backorder
            return {
              ...l,
              qtyFilled: 0,
              qtyBackordered: l.qty,
            };
          }
          // Standard: allocate from available
          const cp = computedMap[l.productId];
          const avail = cp ? cp.available : 0;
          const filled = Math.min(l.qty, avail);
          return {
            ...l,
            qtyFilled: filled,
            qtyBackordered: l.qty - filled,
          };
        });
      const so = {
        id: uid(),
        orderNum: `SO-${String(num).padStart(4, "0")}`,
        customer: form.customer,
        date: form.date,
        fulfillmentStage: "confirmed",
        type: isPreorder ? "preorder" : form.type,
        dealerPORef: form.dealerPORef,
        lines,
        shipment: form.shipment || {},
        notes: form.notes,
      };
      const lineTotal = lines.reduce(
        (s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty) * l.price,
        0,
      );
      setData((d) => ({
        ...d,
        salesOrders: [...d.salesOrders, so],
        counters: { ...d.counters, so: num },
        auditLog: [
          ...(d.auditLog || []),
          {
            id: uid(),
            ts: nowIso(),
            type: isPreorder ? "preorder" : "confirmed",
            entity: so.orderNum,
            description: `Created ${so.orderNum}${isPreorder ? " (pre-order)" : ""} -- ${form.customer} -- ${fmt(lineTotal)}`,
          },
        ],
      }));
    } else {
      // Editing existing
      setData((d) => ({
        ...d,
        salesOrders: d.salesOrders.map((o) =>
          o.id === editing.id
            ? {
                ...o,
                customer: form.customer,
                date: form.date,
                type: form.type,
                dealerPORef: form.dealerPORef,
                lines: form.lines.filter((l) => l.productId),
                notes: form.notes,
              }
            : o,
        ),
        auditLog: [
          ...(d.auditLog || []),
          {
            id: uid(),
            ts: nowIso(),
            type: "adjustment",
            entity: editing.orderNum,
            description: `Updated ${editing.orderNum}`,
          },
        ],
      }));
      // Refresh drawer if viewing same order
      if (selected && selected.id === editing.id) {
        const updated = data.salesOrders.find((o) => o.id === editing.id);
        if (updated) setSelected({ ...updated, ...form, lines: form.lines.filter((l) => l.productId) });
      }
    }
    setEditing(null);
  };

  // --- Line helpers --------------------------------------------------------------
  const setLine = (idx, patch) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));
  const addLine = () =>
    setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }));
  const removeLine = (idx) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));

  // --- CSV export all orders -----------------------------------------------------
  const exportQboCSV = () => {
    const csv = buildQboInvoiceCSV(filtered, prodMap);
    if (csv) dlCSV(csv, "qbo-invoice-import.csv");
  };

  const exportAllCSV = () => {
    const rows = filtered.map((o) => {
      const units = o.lines.reduce(
        (s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty),
        0,
      );
      const value = o.lines.reduce(
        (s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty) * l.price,
        0,
      );
      return {
        OrderNum: o.orderNum,
        Customer: o.customer,
        Date: o.date,
        Stage: o.fulfillmentStage,
        Type: o.type || "standard",
        DealerPO: o.dealerPORef || "",
        Lines: o.lines.length,
        Units: units,
        Value: value,
        Notes: o.notes || "",
      };
    });
    const csv = toCSV(rows, [
      "OrderNum", "Customer", "Date", "Stage", "Type", "DealerPO", "Lines", "Units", "Value", "Notes",
    ]);
    dlCSV(csv, "sales-orders.csv");
  };

  // --- Render -------------------------------------------------------------------
  const formTotal = form.lines.reduce(
    (s, l) => s + l.qty * l.price,
    0,
  );

  const filterTabs = [
    { key: "all", label: "All" },
    ...STAGES.map((s) => ({ key: s, label: STAGE_LABEL[s] })),
    { key: "cancelled", label: "Cancelled" },
  ];

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 18,
        }}
      >
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>
            Sales Orders
          </h2>
          <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 13 }}>
            {data.salesOrders.length} order{data.salesOrders.length !== 1 ? "s" : ""}{" "}
            &middot; {filtered.length} shown
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            style={{ ...IS, width: 220 }}
            placeholder="Search orders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button style={{ ...BS, fontSize: 12 }} onClick={exportAllCSV}>
            Export CSV
          </button>
          <button style={{ ...BS, fontSize: 12 }} onClick={exportQboCSV}>
            Export for QBO
          </button>
          <button style={BAq} onClick={() => setShowImport(true)}>
            Import New Dealer / Distributor PO
          </button>
        </div>
      </div>

      {/* Stage filter tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStageFilter(tab.key)}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "1px solid",
              borderColor: stageFilter === tab.key ? "#6D28D9" : "#E2E8F0",
              background: stageFilter === tab.key ? "#F5F3FF" : "#FFFFFF",
              color: stageFilter === tab.key ? "#6D28D9" : "#64748B",
              fontWeight: 600,
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {tab.label} ({stageCounts[tab.key] || 0})
          </button>
        ))}
      </div>

      {/* Orders table */}
      <Table
        headers={["Order #", "PO #", "Customer", "Date", "Stage", "Invoice", "Type", "Lines", "Value", "Notes"]}
        empty={filtered.length === 0 ? "No sales orders match your filters." : null}
      >
        {filtered.map((o, i) => {
          // Show ordered totals here (not filled) so fully-backordered orders
          // like pre-orders don't read as "0 units / $0.00" in the list.
          const units = o.lines.reduce((s, l) => s + l.qty, 0);
          const value = o.lines.reduce((s, l) => s + l.qty * l.price, 0);
          const boUnits = o.lines.reduce(
            (s, l) => s + (l.qtyBackordered != null ? l.qtyBackordered : 0),
            0,
          );
          const hasBO = boUnits > 0;
          const killedUnits = o.lines.reduce((s, l) => s + (l.qtyKilled || 0), 0);
          return (
            <TR
              key={o.id}
              i={i}
              hl={selected && selected.id === o.id}
            >
              <TD mono accent="#6D28D9">
                <span
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                  onClick={() => setSelected(o)}
                >
                  {o.orderNum}
                </span>
              </TD>
              <TD mono>{o.dealerPORef || "--"}</TD>
              <TD>
                <span
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelected(o)}
                >
                  {o.customer}
                </span>
              </TD>
              <TD>{fmtDate(o.date)}</TD>
              <TD>
                <Badge
                  status={o.fulfillmentStage}
                  label={STAGE_LABEL[o.fulfillmentStage] || o.fulfillmentStage}
                />
              </TD>
              <TD>
                {o.qboInvoice ? (
                  <span
                    onClick={() => setInvoiceModal(o)}
                    style={{
                      cursor: "pointer",
                      color: "#15803D",
                      fontWeight: 700,
                      fontSize: 12,
                      fontFamily: "monospace",
                      textDecoration: "underline",
                      textUnderlineOffset: 2,
                    }}
                  >
                    #{o.qboInvoice.docNumber || o.qboInvoice.qboId}
                  </span>
                ) : o.fulfillmentStage === "shipped" && isQboConnected() ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      doFetchInvoiceForOrder(o);
                    }}
                    style={{
                      background: "#F0FDF4",
                      border: "1px solid #BBF7D0",
                      borderRadius: 6,
                      padding: "3px 10px",
                      color: "#15803D",
                      fontWeight: 600,
                      fontSize: 11,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Link Invoice
                  </button>
                ) : (
                  <span style={{ color: "#CBD5E1", fontSize: 12 }}>--</span>
                )}
              </TD>
              <TD>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {o.type && o.type !== "standard" && (
                    <Badge status={o.type} label={o.type} />
                  )}
                  {o.channel && (
                    <Badge status={o.channel} label={channelLabel(o.channel)} />
                  )}
                  {o.showOrder && <Badge status="show-order" label="Show" />}
                  {hasBO && <Badge status="backordered" label="BO" />}
                  {o.backorderOf && (
                    <Badge status="backordered" label={`BO of ${o.backorderOf}`} />
                  )}
                </div>
              </TD>
              <TD>
                {o.lines.length} item{o.lines.length !== 1 ? "s" : ""} &middot;{" "}
                {fmtNum(units)} units
                {hasBO && (
                  <span style={{ color: "#F97316", fontWeight: 600 }}>
                    {" "}({fmtNum(boUnits)} BO)
                  </span>
                )}
                {killedUnits > 0 && (
                  <span style={{ color: "#94A3B8", fontWeight: 600 }}>
                    {" "}({fmtNum(killedUnits)} killed)
                  </span>
                )}
              </TD>
              <TD mono>{fmt(value)}</TD>
              <TD>
                <span
                  style={{
                    fontSize: 12,
                    color: "#94A3B8",
                    maxWidth: 140,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    display: "inline-block",
                  }}
                >
                  {o.notes || "--"}
                </span>
              </TD>
            </TR>
          );
        })}
      </Table>

      {/* Order drawer */}
      {selected && (
        <>
          {/* Backdrop */}
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15,23,42,0.18)",
              zIndex: 899,
            }}
            onClick={() => setSelected(null)}
          />
          <OrderDrawer
            order={
              // Always get the latest version from data
              data.salesOrders.find((o) => o.id === selected.id) || selected
            }
            data={data}
            setData={setData}
            onClose={() => setSelected(null)}
            onEdit={() => {
              const latest = data.salesOrders.find((o) => o.id === selected.id) || selected;
              openEdit(latest);
            }}
          />
        </>
      )}

      {/* Create / Edit Modal */}
      {editing && (
        <Modal
          title={
            editing === "new"
              ? "New Sales Order"
              : editing === "preorder"
                ? "New Pre-Order"
                : `Edit ${editing.orderNum}`
          }
          onClose={() => setEditing(null)}
          width={780}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
            <Field label="Customer">
              <input
                style={IS}
                value={form.customer}
                onChange={(e) => setForm((f) => ({ ...f, customer: e.target.value }))}
                placeholder="Customer name"
                list="customer-list"
              />
              <datalist id="customer-list">
                {(data.customers || []).map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </Field>
            <Field label="Order Date">
              <input
                style={IS}
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </Field>
            <Field label="Type">
              <select
                style={SS}
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              >
                <option value="standard">Standard</option>
                <option value="distributor">Distributor</option>
                <option value="dealer">Dealer</option>
                <option value="retailer">Retailer</option>
                <option value="preorder">Pre-Order</option>
              </select>
            </Field>
            <Field label="Dealer PO Ref">
              <input
                style={IS}
                value={form.dealerPORef}
                onChange={(e) => setForm((f) => ({ ...f, dealerPORef: e.target.value }))}
                placeholder="Optional"
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              style={{ ...IS, minHeight: 50, resize: "vertical" }}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>

          {/* Line Items */}
          <div
            style={{
              fontWeight: 700,
              fontSize: 12,
              color: "#64748B",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginBottom: 8,
              marginTop: 4,
            }}
          >
            Line Items
          </div>

          {form.lines.map((line, idx) => {
            const prod = prodMap[line.productId];
            const cp = computedMap[line.productId];
            return (
              <div
                key={idx}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 70px 90px auto",
                  gap: 8,
                  marginBottom: 6,
                  alignItems: "center",
                }}
              >
                <div>
                  <select
                    style={{ ...SS, fontSize: 12 }}
                    value={line.productId}
                    onChange={(e) => {
                      const p = prodMap[e.target.value];
                      setLine(idx, {
                        productId: e.target.value,
                        price: p ? p.sellPrice : 0,
                      });
                    }}
                  >
                    <option value="">-- product --</option>
                    {data.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} -- {p.name}
                      </option>
                    ))}
                  </select>
                  {cp && (
                    <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 2, paddingLeft: 2 }}>
                      {fmtNum(cp.available)} available
                    </div>
                  )}
                </div>
                <input
                  style={{ ...IS, fontSize: 12 }}
                  type="number"
                  min="1"
                  placeholder="Qty"
                  value={line.qty}
                  onChange={(e) => setLine(idx, { qty: Math.max(1, +e.target.value || 1) })}
                />
                <input
                  style={{ ...IS, fontSize: 12 }}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Price"
                  value={line.price}
                  onChange={(e) => setLine(idx, { price: +e.target.value || 0 })}
                />
                <button
                  style={{ ...BD, padding: "6px 10px", fontSize: 11 }}
                  onClick={() => removeLine(idx)}
                >
                  &times;
                </button>
              </div>
            );
          })}

          <button style={{ ...BS, fontSize: 12, marginTop: 4 }} onClick={addLine}>
            + Add Line
          </button>

          <div
            style={{
              textAlign: "right",
              fontSize: 14,
              fontWeight: 700,
              color: "#0F172A",
              marginTop: 12,
            }}
          >
            Total: {fmt(formTotal)}
          </div>

          {/* Footer */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
            <button style={BS} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button style={BP} onClick={save} disabled={!form.customer}>
              {editing === "new" || editing === "preorder"
                ? editing === "preorder"
                  ? "Create Pre-Order"
                  : "Create Order"
                : "Save Changes"}
            </button>
          </div>
        </Modal>
      )}

      {/* Dealer PO Import */}
      {showImport && (
        <DealerPOImport
          data={data}
          setData={setData}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* Invoice Detail Modal */}
      {invoiceModal && invoiceModal.qboInvoice && (
        <Modal
          title={`Invoice #${invoiceModal.qboInvoice.docNumber || invoiceModal.qboInvoice.qboId}`}
          onClose={() => setInvoiceModal(null)}
          width={640}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px 20px",
              marginBottom: 18,
            }}
          >
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                Customer
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A" }}>
                {invoiceModal.qboInvoice.customer}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                Invoice Date
              </div>
              <div style={{ fontSize: 14, color: "#334155" }}>
                {fmtDate(invoiceModal.qboInvoice.date)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                Linked Order
              </div>
              <div style={{ fontSize: 14, fontFamily: "monospace", fontWeight: 600, color: "#6D28D9" }}>
                {invoiceModal.orderNum}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                Status
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 10px",
                  borderRadius: 10,
                  background: invoiceModal.qboInvoice.status === "paid" ? "#F0FDF4" : invoiceModal.qboInvoice.status === "overdue" ? "#FEF2F2" : "#EFF6FF",
                  color: invoiceModal.qboInvoice.status === "paid" ? "#15803D" : invoiceModal.qboInvoice.status === "overdue" ? "#DC2626" : "#2563EB",
                  textTransform: "uppercase",
                }}
              >
                {invoiceModal.qboInvoice.status}
              </span>
            </div>
          </div>

          {/* Summary strip */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
            <div
              style={{
                background: "#F0FDF4",
                border: "1px solid #BBF7D0",
                borderRadius: 10,
                padding: "10px 14px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 800, color: "#15803D" }}>
                {fmt(invoiceModal.qboInvoice.totalAmount)}
              </div>
              <div style={{ fontSize: 10, color: "#64748B", fontWeight: 600, textTransform: "uppercase" }}>
                Total Amount
              </div>
            </div>
            <div
              style={{
                background: invoiceModal.qboInvoice.balance > 0 ? "#FFF7ED" : "#F8FAFC",
                border: `1px solid ${invoiceModal.qboInvoice.balance > 0 ? "#FED7AA" : "#E2E8F0"}`,
                borderRadius: 10,
                padding: "10px 14px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 800, color: invoiceModal.qboInvoice.balance > 0 ? "#EA580C" : "#15803D" }}>
                {fmt(invoiceModal.qboInvoice.balance)}
              </div>
              <div style={{ fontSize: 10, color: "#64748B", fontWeight: 600, textTransform: "uppercase" }}>
                Balance Due
              </div>
            </div>
          </div>

          {/* Invoice line items */}
          <div style={{ fontWeight: 700, fontSize: 13, color: "#334155", marginBottom: 10 }}>
            Invoiced Items ({invoiceModal.qboInvoice.lines.length})
          </div>
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E8F0",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                  {["Item", "Qty", "Price", "Amount"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "9px 12px",
                        textAlign: h === "Amount" || h === "Price" ? "right" : "left",
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#94A3B8",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoiceModal.qboInvoice.lines.map((l, i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom: "1px solid #F1F5F9",
                      background: i % 2 === 0 ? "transparent" : "#FAFAFA",
                    }}
                  >
                    <td style={{ padding: "9px 12px", fontSize: 13, color: "#334155" }}>
                      {l.qboItemName || "Unknown Item"}
                    </td>
                    <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 600, color: "#0F172A" }}>
                      {l.qty}
                    </td>
                    <td style={{ padding: "9px 12px", fontSize: 12, fontFamily: "monospace", color: "#374151", textAlign: "right" }}>
                      {fmt(l.price)}
                    </td>
                    <td style={{ padding: "9px 12px", fontSize: 12, fontFamily: "monospace", fontWeight: 600, color: "#0F172A", textAlign: "right" }}>
                      {fmt(l.amount || l.qty * l.price)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                padding: "10px 14px",
                borderTop: "1px solid #E2E8F0",
                background: "#F8FAFC",
                fontWeight: 700,
                fontSize: 14,
                color: "#15803D",
              }}
            >
              Total: {fmt(invoiceModal.qboInvoice.totalAmount)}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
            <button
              style={BD}
              onClick={() => {
                if (!window.confirm("Unlink this invoice from the order?")) return;
                setData((d) => ({
                  ...d,
                  salesOrders: d.salesOrders.map((o) =>
                    o.id === invoiceModal.id ? { ...o, qboInvoice: undefined } : o,
                  ),
                }));
                setInvoiceModal(null);
              }}
            >
              Unlink Invoice
            </button>
            <button style={BS} onClick={() => setInvoiceModal(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {/* Invoice Picker Modal */}
      {invoicePicker && (
        <Modal
          title={`Link Invoice to ${invoicePicker.orderNum}`}
          onClose={() => {
            setInvoicePicker(null);
            setInvoiceCandidates(null);
            setInvoiceError(null);
          }}
          width={700}
        >
          <div
            style={{
              background: "#F8FAFC",
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 16,
              fontSize: 12,
              color: "#475569",
            }}
          >
            Select the QuickBooks invoice that matches <strong>{invoicePicker.orderNum}</strong> ({invoicePicker.customer}, {fmtDate(invoicePicker.date)})
          </div>

          {invoiceError && (
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
              {invoiceError}
            </div>
          )}

          {invoiceFetching && (
            <div style={{ textAlign: "center", padding: 30, color: "#64748B", fontSize: 13 }}>
              Fetching invoices from QuickBooks...
            </div>
          )}

          {invoiceCandidates && invoiceCandidates.length === 0 && (
            <div style={{ textAlign: "center", padding: 30, color: "#94A3B8", fontSize: 13 }}>
              No invoices found. Make sure the invoice exists in QuickBooks Online.
            </div>
          )}

          {invoiceCandidates && invoiceCandidates.length > 0 && (
            <div style={{ maxHeight: 400, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Invoice #</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Customer</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Date</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "#64748B", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Amount</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#64748B", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Status</th>
                    <th style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700, color: "#64748B", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceCandidates.map((inv, i) => {
                    const customerMatch =
                      inv.customer.toLowerCase() === invoicePicker.customer.toLowerCase();
                    return (
                      <tr
                        key={inv.qboId}
                        style={{
                          borderBottom: "1px solid #F1F5F9",
                          background: customerMatch ? "#F0FDF4" : i % 2 === 0 ? "transparent" : "#FAFAFA",
                        }}
                      >
                        <td style={{ padding: "8px 10px", fontWeight: 600, fontFamily: "monospace" }}>
                          {inv.qboDocNumber || inv.qboId}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {inv.customer}
                          {customerMatch && (
                            <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: "#15803D", background: "#DCFCE7", padding: "1px 6px", borderRadius: 6 }}>
                              MATCH
                            </span>
                          )}
                        </td>
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
                            {inv.status}
                          </span>
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "center" }}>
                          <button
                            onClick={() => linkInvoice(invoicePicker, inv)}
                            style={{
                              ...BG,
                              padding: "4px 12px",
                              fontSize: 11,
                            }}
                          >
                            Link
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button
              style={BS}
              onClick={() => {
                setInvoicePicker(null);
                setInvoiceCandidates(null);
                setInvoiceError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
