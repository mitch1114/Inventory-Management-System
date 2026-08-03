import { useState, useMemo } from "react";
import { LOCKING } from "../lib/constants";
import { computeInventory } from "../lib/inventory";
import { uid, fmt, fmtNum, nowIso } from "../lib/utils";
import { Modal, Field, IS, SS, BP, BS, BD } from "./ui";

// Shared edit modal for an EXISTING sales order (used by the Sales Orders
// drawer and the Order Board). Quantities can be changed and new line items
// added while the order is still in a locking stage (confirmed/picked/booked);
// on save, only the units ADDED by the edit are allocated from available
// stock -- existing fills and intentional backorders (pre-orders) are
// preserved, and any shortfall goes to backorder like a normal order.
const blankLine = () => ({ productId: "", qty: 1, price: 0 });

export default function OrderEditModal({ order, data, setData, onClose }) {
  const [form, setForm] = useState(() => ({
    customer: order.customer,
    date: order.date,
    type: order.type || "standard",
    dealerPORef: order.dealerPORef || "",
    notes: order.notes || "",
    lines: order.lines.map((l) => ({
      ...l,
      // Snapshot of the pre-edit allocation, so save() can tell how many
      // units each line gained/lost regardless of what the user typed.
      _orig: {
        productId: l.productId,
        qty: l.qty,
        qtyFilled: l.qtyFilled,
        qtyBackordered: l.qtyBackordered,
      },
    })),
  }));

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

  const setLine = (idx, patch) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }));
  const removeLine = (idx) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));

  const save = () => {
    const isLocking = LOCKING.has(order.fulfillmentStage);
    const isPreorder = (form.type || order.type) === "preorder";
    // This order's current fills are already counted as locked, so "available"
    // is the right pool for units added by this edit. Units removed by the
    // edit release automatically when inventory recomputes from the new lines.
    const availMap = Object.fromEntries(computedProds.map((p) => [p.id, p.available]));

    const lines = form.lines
      .filter((l) => l.productId)
      .map((l) => {
        const { _orig, ...line } = l;
        if (!isLocking) return line;

        if (_orig && _orig.productId === line.productId) {
          const oldQty = _orig.qty;
          const oldFilled = _orig.qtyFilled != null ? _orig.qtyFilled : oldQty;
          const oldBO = _orig.qtyBackordered != null ? _orig.qtyBackordered : 0;
          if (line.qty > oldQty) {
            // Quantity increased: fill the added units from available stock
            // (pre-orders keep everything on backorder until allocation).
            const delta = line.qty - oldQty;
            const fill = isPreorder ? 0 : Math.min(delta, availMap[line.productId] || 0);
            if (fill > 0) availMap[line.productId] -= fill;
            return { ...line, qtyFilled: oldFilled + fill, qtyBackordered: oldBO + (delta - fill) };
          }
          if (line.qty < oldQty) {
            // Quantity reduced: give back backordered units first, then filled.
            const cut = oldQty - line.qty;
            const boCut = Math.min(oldBO, cut);
            const newFilled = Math.max(0, oldFilled - (cut - boCut));
            return { ...line, qtyFilled: newFilled, qtyBackordered: Math.max(0, line.qty - newFilled) };
          }
          return line; // unchanged qty keeps its existing allocation
        }

        // Brand-new line (or the product was swapped): allocate from scratch.
        const fill = isPreorder ? 0 : Math.min(line.qty, availMap[line.productId] || 0);
        if (fill > 0) availMap[line.productId] -= fill;
        return {
          productId: line.productId,
          qty: line.qty,
          price: line.price,
          qtyFilled: fill,
          qtyBackordered: line.qty - fill,
        };
      });

    const totalUnits = lines.reduce((s, l) => s + l.qty, 0);
    const totalFilled = lines.reduce((s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty), 0);
    const totalBO = lines.reduce((s, l) => s + (l.qtyBackordered || 0), 0);

    setData((d) => ({
      ...d,
      salesOrders: d.salesOrders.map((o) =>
        o.id === order.id
          ? {
              ...o,
              customer: form.customer,
              date: form.date,
              type: form.type,
              dealerPORef: form.dealerPORef,
              notes: form.notes,
              lines,
            }
          : o,
      ),
      auditLog: [
        ...(d.auditLog || []),
        {
          id: uid(),
          ts: nowIso(),
          type: "adjustment",
          entity: order.orderNum,
          description: `Edited ${order.orderNum} (${form.customer}) -- ${lines.length} line${lines.length !== 1 ? "s" : ""}, ${totalUnits} units (${totalFilled} filled${totalBO > 0 ? `, ${totalBO} backordered` : ""})`,
        },
      ],
    }));
    onClose();
  };

  const formTotal = form.lines.reduce((s, l) => s + l.qty * l.price, 0);

  return (
    <Modal title={`Edit ${order.orderNum}`} onClose={onClose} width={780}>
      {LOCKING.has(order.fulfillmentStage) && (
        <div
          style={{
            background: "#EFF6FF",
            border: "1px solid #BFDBFE",
            borderRadius: 10,
            padding: "8px 14px",
            marginBottom: 14,
            fontSize: 12,
            color: "#1D4ED8",
          }}
        >
          Added quantities and new lines are allocated from available stock when you save;
          anything short goes to backorder.
        </div>
      )}
      {order.shipstationOrderId && (
        <div
          style={{
            background: "#FFF7ED",
            border: "1px solid #FED7AA",
            borderRadius: 10,
            padding: "8px 14px",
            marginBottom: 14,
            fontSize: 12,
            color: "#9A3412",
          }}
        >
          This order was already pushed to ShipStation (#{order.shipstationOrderId}) -- update
          the ShipStation order there too, or the packing list won't match.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
        <Field label="Customer">
          <input
            style={IS}
            value={form.customer}
            onChange={(e) => setForm((f) => ({ ...f, customer: e.target.value }))}
            placeholder="Customer name"
            list="edit-customer-list"
          />
          <datalist id="edit-customer-list">
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
        const cp = computedMap[line.productId];
        const orig = line._orig;
        const isNewLine = !orig || orig.productId !== line.productId;
        const qtyChanged = orig && orig.productId === line.productId && line.qty !== orig.qty;
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
              <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 2, paddingLeft: 2 }}>
                {cp ? `${fmtNum(cp.available)} available` : ""}
                {isNewLine && line.productId && (
                  <span style={{ color: "#6D28D9", fontWeight: 700 }}> · new line</span>
                )}
                {qtyChanged && (
                  <span style={{ color: "#EA580C", fontWeight: 700 }}>
                    {" "}· {line.qty > orig.qty ? `+${line.qty - orig.qty}` : line.qty - orig.qty} vs original
                  </span>
                )}
              </div>
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

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
        <button style={BS} onClick={onClose}>
          Cancel
        </button>
        <button style={BP} onClick={save} disabled={!form.customer}>
          Save Changes
        </button>
      </div>
    </Modal>
  );
}
