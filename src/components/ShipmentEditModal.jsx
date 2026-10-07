import { useState } from "react";
import { fmt, uid, nowIso } from "../lib/utils";
import { Modal, Field, IS, BP, BS } from "./ui";

/**
 * Apply edited shipment details to a shipped order and log what changed.
 * Only shipment fields change -- stage, quantities and inventory are untouched.
 */
export function updateShipment(data, orderId, next) {
  const order = data.salesOrders.find((o) => o.id === orderId);
  if (!order) return data;
  const prev = order.shipment || {};
  const show = (k, v) => (v == null || v === "" ? "(blank)" : k === "shippingCost" ? fmt(v) : String(v));
  const labels = { carrier: "carrier", trackingNum: "tracking/BOL", shipDate: "ship date", shippingCost: "shipping cost" };
  const changes = Object.keys(labels)
    .filter((k) => (prev[k] ?? "") !== (next[k] ?? ""))
    .map((k) => `${labels[k]} ${show(k, prev[k])} -> ${show(k, next[k])}`);
  if (changes.length === 0) return data;
  const shipment = { ...prev, ...next };
  if (next.shippingCost == null) delete shipment.shippingCost;
  return {
    ...data,
    salesOrders: data.salesOrders.map((o) => (o.id === orderId ? { ...o, shipment } : o)),
    auditLog: [
      ...(data.auditLog || []),
      {
        id: uid(),
        ts: nowIso(),
        type: "shipment-edit",
        entity: order.orderNum,
        description: `Edited shipment for ${order.orderNum} (${order.customer}): ${changes.join("; ")}`,
      },
    ],
  };
}

// Edit carrier / tracking (BOL) / ship date / shipping cost on an order that's
// already shipped -- e.g. a missed LTL pickup rebooked on a new BOL.
export default function ShipmentEditModal({ order, setData, onClose }) {
  const s = order.shipment || {};
  const [form, setForm] = useState({
    carrier: s.carrier || "",
    trackingNum: s.trackingNum || "",
    shipDate: s.shipDate || "",
    shippingCost: s.shippingCost != null ? String(s.shippingCost) : "",
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = () => {
    setData((d) =>
      updateShipment(d, order.id, {
        carrier: form.carrier.trim(),
        trackingNum: form.trackingNum.trim(),
        shipDate: form.shipDate,
        shippingCost: form.shippingCost === "" ? null : +form.shippingCost || 0,
      }),
    );
    onClose();
  };

  return (
    <Modal title={`Edit Shipment -- ${order.orderNum}`} onClose={onClose} width={520}>
      <div style={{ fontSize: 13, color: "#64748B", marginBottom: 14 }}>
        {order.customer}
        {order.dealerPORef ? ` · PO ${order.dealerPORef}` : ""}. Updates the shipment details only; the
        order stays Shipped and inventory is unchanged. The change is recorded in the Audit Log.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <Field label="Carrier">
          <input style={IS} value={form.carrier} onChange={set("carrier")} placeholder="UPS, FedEx, LTL carrier..." />
        </Field>
        <Field label="Ship Date">
          <input style={IS} type="date" value={form.shipDate} onChange={set("shipDate")} />
        </Field>
        <Field label="Tracking # / BOL #">
          <input style={IS} value={form.trackingNum} onChange={set("trackingNum")} placeholder="Tracking or BOL number" />
        </Field>
        <Field label="Shipping Cost ($)">
          <input style={IS} type="number" step="0.01" min="0" value={form.shippingCost} onChange={set("shippingCost")} placeholder="Blank = unknown" />
        </Field>
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
        <button style={BS} onClick={onClose}>
          Cancel
        </button>
        <button style={BP} onClick={save}>
          Save Shipment
        </button>
      </div>
    </Modal>
  );
}
