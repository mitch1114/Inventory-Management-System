import { useState, useMemo } from "react";
import { STAGES, STAGE_LABEL, STAGE_NEXT, STAGE_BTN, LOCKING } from "../lib/constants";
import { computeInventory, advanceStage } from "../lib/inventory";
import { uid, fmt, fmtNum, fmtDate, nowIso, todayIso, toCSV, dlCSV } from "../lib/utils";
import { Badge, Modal, Field, Table, TR, TD, IS, SS, BP, BS, BD, BAq } from "./ui";
import DealerPOImport from "./DealerPOImport";

// --- OrderDrawer (detail panel) ------------------------------------------------
function OrderDrawer({ order, data, setData, onClose, onEdit }) {
  const [shipModal, setShipModal] = useState(false);
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
  const doAdvance = (info) => {
    if (!nextStage) return;
    setData((d) => advanceStage(d, order.id, nextStage, info || null));
  };

  const handleStageClick = () => {
    if (nextStage === "shipped") {
      setShipForm({
        carrier: (order.shipment && order.shipment.carrier) || "",
        trackingNum: (order.shipment && order.shipment.trackingNum) || "",
        shipDate: todayIso(),
      });
      setShipModal(true);
    } else {
      doAdvance();
    }
  };

  const confirmShip = () => {
    doAdvance(shipForm);
    setShipModal(false);
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

        {/* Stage progression */}
        {!isCancelled && !isShipped && nextStage && (
          <div style={{ marginBottom: 18, display: "flex", gap: 8 }}>
            <button style={BP} onClick={handleStageClick}>
              {STAGE_BTN[order.fulfillmentStage]} &rarr;
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
            }}
          >
            This order has been cancelled.
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
          <button
            style={{ ...BS, padding: "5px 12px", fontSize: 11 }}
            onClick={exportCSV}
          >
            Export CSV
          </button>
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

  // --- Open create / edit -------------------------------------------------------
  const openNew = () => {
    setForm(blankOrder());
    setEditing("new");
  };

  const openPreorder = () => {
    setForm({ ...blankOrder(), type: "preorder" });
    setEditing("preorder");
  };

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
          <button style={BAq} onClick={() => setShowImport(true)}>
            Import Dealer PO
          </button>
          <button style={{ ...BS, fontSize: 12 }} onClick={openPreorder}>
            + Pre-Order
          </button>
          <button style={BP} onClick={openNew}>
            + New Order
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
        headers={["Order #", "Customer", "Date", "Stage", "Type", "Lines", "Value", "Notes"]}
        empty={filtered.length === 0 ? "No sales orders match your filters." : null}
      >
        {filtered.map((o, i) => {
          const units = o.lines.reduce(
            (s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty),
            0,
          );
          const value = o.lines.reduce(
            (s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty) * l.price,
            0,
          );
          const hasBO = o.lines.some(
            (l) => (l.qtyBackordered != null ? l.qtyBackordered : 0) > 0,
          );
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
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {o.type && o.type !== "standard" && (
                    <Badge status={o.type} label={o.type} />
                  )}
                  {hasBO && <Badge status="backordered" label="BO" />}
                </div>
              </TD>
              <TD>
                {o.lines.length} item{o.lines.length !== 1 ? "s" : ""} &middot;{" "}
                {fmtNum(units)} units
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
                  {o.dealerPORef || o.notes || "--"}
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
    </div>
  );
}
