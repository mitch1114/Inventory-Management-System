import { LOCKING, STAGE_LABEL } from "./constants";
import { uid, nowIso } from "./utils";

// --- Core inventory engine ----------------------------------------------------
// available = onHand - locked (locked = all units in confirmed/picked/booked orders)
// onHand only decrements when "shipped"
export function computeInventory(products, salesOrders) {
  const locked = {};
  const bord = {};
  (salesOrders || []).forEach((o) => {
    if (!LOCKING.has(o.fulfillmentStage)) return;
    (o.lines || []).forEach((l) => {
      const filled = l.qtyFilled != null ? l.qtyFilled : l.qty;
      if (filled > 0) locked[l.productId] = (locked[l.productId] || 0) + filled;
      const bo = l.qtyBackordered != null ? l.qtyBackordered : 0;
      if (bo > 0) bord[l.productId] = (bord[l.productId] || 0) + bo;
    });
  });
  return products.map((p) => ({
    ...p,
    locked: locked[p.id] || 0,
    backordered: bord[p.id] || 0,
    available: Math.max(0, p.onHand - (locked[p.id] || 0)),
  }));
}

// adjustedLines: optional array of { productId, qtyFilled } to override fill quantities
export function advanceStage(data, orderId, newStage, shipInfo, adjustedLines) {
  const order = data.salesOrders.find((o) => o.id === orderId);
  if (!order) return data;

  // Build updated order lines if adjusted quantities were provided
  let updatedOrderLines = order.lines;
  if (adjustedLines) {
    const adjMap = {};
    adjustedLines.forEach((a) => { adjMap[a.productId] = a.qtyFilled; });
    updatedOrderLines = order.lines.map((l) => {
      if (adjMap[l.productId] == null) return l;
      const newFilled = Math.max(0, Math.min(l.qty, adjMap[l.productId]));
      return {
        ...l,
        qtyFilled: newFilled,
        qtyBackordered: l.qty - newFilled,
      };
    });
  }

  let products = data.products;
  if (newStage === "shipped") {
    products = products.map((p) => {
      const deduct = updatedOrderLines
        .filter((l) => l.productId === p.id)
        .reduce((s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty), 0);
      return deduct > 0 ? { ...p, onHand: Math.max(0, p.onHand - deduct) } : p;
    });
  }
  const salesOrders = data.salesOrders.map((o) =>
    o.id === orderId
      ? { ...o, fulfillmentStage: newStage, lines: updatedOrderLines, shipment: shipInfo || o.shipment || {} }
      : o,
  );

  // Build audit description
  const totalOrdered = updatedOrderLines.reduce((s, l) => s + l.qty, 0);
  const totalFilled = updatedOrderLines.reduce((s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty), 0);
  const totalBO = updatedOrderLines.reduce((s, l) => s + (l.qtyBackordered != null ? l.qtyBackordered : 0), 0);
  const fillPct = totalOrdered > 0 ? Math.round((totalFilled / totalOrdered) * 100) : 100;

  let desc;
  if (newStage === "shipped") {
    desc = `Shipped ${order.orderNum} -> ${order.customer}${shipInfo && shipInfo.carrier ? " * " + shipInfo.carrier + (shipInfo.trackingNum ? " " + shipInfo.trackingNum : "") : ""}`;
  } else if (newStage === "picked" && adjustedLines) {
    desc = `${order.orderNum} -> ${STAGE_LABEL[newStage]} (${order.customer}) -- ${totalFilled}/${totalOrdered} units filled (${fillPct}%)${totalBO > 0 ? ` * ${totalBO} backordered` : ""}`;
  } else {
    desc = `${order.orderNum} -> ${STAGE_LABEL[newStage]} (${order.customer})`;
  }

  const auditLog = [
    ...(data.auditLog || []),
    {
      id: uid(),
      ts: nowIso(),
      type: newStage === "shipped" ? "shipped-log" : "stage-advance",
      entity: order.orderNum,
      description: desc,
    },
  ];
  return { ...data, products, salesOrders, auditLog };
}

export function autoAllocate(data, receivedLines) {
  let { salesOrders, auditLog } = data;
  const logs = [];
  const orders = salesOrders.map((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l })) }));
  for (const { productId, qty: incoming } of receivedLines) {
    let pool = incoming;
    const targets = orders
      .map((o, i) => ({ o, i }))
      .filter(
        ({ o }) =>
          LOCKING.has(o.fulfillmentStage) &&
          o.lines.some(
            (l) => l.productId === productId && (l.qtyBackordered != null ? l.qtyBackordered : 0) > 0,
          ),
      )
      .sort((a, b) => a.o.date.localeCompare(b.o.date));
    for (const { o, i } of targets) {
      if (pool <= 0) break;
      orders[i].lines = orders[i].lines.map((l) => {
        if (l.productId !== productId) return l;
        const bo = l.qtyBackordered != null ? l.qtyBackordered : 0;
        const fill = Math.min(pool, bo);
        pool -= fill;
        return {
          ...l,
          qtyFilled: (l.qtyFilled != null ? l.qtyFilled : 0) + fill,
          qtyBackordered: bo - fill,
        };
      });
      if (
        orders[i].lines.every(
          (l) => (l.qtyBackordered != null ? l.qtyBackordered : 0) === 0,
        )
      )
        logs.push({
          id: uid(),
          ts: nowIso(),
          type: "auto-allocated",
          entity: o.orderNum,
          description: `Auto-filled backorder ${o.orderNum} for ${o.customer}`,
        });
    }
  }
  return { ...data, salesOrders: orders, auditLog: [...(auditLog || []), ...logs] };
}
