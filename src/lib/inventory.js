import { LOCKING, STAGE_LABEL } from "./constants";
import { uid, nowIso, todayIso, nextSoNumber } from "./utils";

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
  // Guard against double-advancing (e.g. two users shipping the same order
  // would deduct onHand twice).
  if (order.fulfillmentStage === newStage) return data;

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

// Resolve outstanding backorders on an order before it ships, so shipped
// orders never carry untracked backorders.
//
// policy "kill" (fill & kill): cancel the remainder. Ordered quantities stay on
//   the lines and the cancelled amount is recorded as qtyKilled, so fill-rate
//   reporting still reflects the shortfall after shipment.
// policy "split": move the remainder to a new confirmed sales order (numbered
//   like any other SO, tagged with backorderOf) that locks stock and auto-fills
//   from receiving like a normal order.
export function resolveBackorders(data, orderId, policy) {
  const order = data.salesOrders.find((o) => o.id === orderId);
  if (!order) return data;
  const boOf = (l) => (l.qtyBackordered != null ? l.qtyBackordered : 0);
  const boLines = (order.lines || []).filter((l) => boOf(l) > 0);
  if (boLines.length === 0) return data;
  const totalBO = boLines.reduce((s, l) => s + boOf(l), 0);

  if (policy === "kill") {
    const salesOrders = data.salesOrders.map((o) =>
      o.id === orderId
        ? {
            ...o,
            lines: o.lines.map((l) =>
              boOf(l) > 0
                ? { ...l, qtyBackordered: 0, qtyKilled: (l.qtyKilled || 0) + boOf(l) }
                : l,
            ),
          }
        : o,
    );
    return {
      ...data,
      salesOrders,
      auditLog: [
        ...(data.auditLog || []),
        {
          id: uid(),
          ts: nowIso(),
          type: "fill-kill",
          entity: order.orderNum,
          description: `Fill & kill: cancelled ${totalBO} backordered unit(s) on ${order.orderNum} (${order.customer}) at shipment`,
        },
      ],
    };
  }

  // policy "split" -- carve the remainder into a tracked backorder order
  const computed = computeInventory(data.products, data.salesOrders);
  const availMap = Object.fromEntries(computed.map((p) => [p.id, p.available]));
  const num = nextSoNumber(data);
  const orderNum = `SO-${String(num).padStart(4, "0")}`;
  const childLines = boLines.map((l) => {
    const avail = availMap[l.productId] || 0;
    const filled = Math.min(boOf(l), avail);
    availMap[l.productId] = avail - filled;
    return {
      productId: l.productId,
      qty: boOf(l),
      price: l.price,
      qtyFilled: filled,
      qtyBackordered: boOf(l) - filled,
    };
  });
  const child = {
    id: uid(),
    orderNum,
    customer: order.customer,
    date: todayIso(),
    fulfillmentStage: "confirmed",
    type: order.type || "standard",
    dealerPORef: order.dealerPORef || "",
    backorderOf: order.orderNum,
    lines: childLines,
    shipment: {},
    notes: `Backorder carried over from ${order.orderNum}`,
  };
  const salesOrders = data.salesOrders.map((o) =>
    o.id === orderId
      ? {
          ...o,
          lines: o.lines.map((l) =>
            boOf(l) > 0 ? { ...l, qty: l.qty - boOf(l), qtyBackordered: 0 } : l,
          ),
        }
      : o,
  );
  return {
    ...data,
    salesOrders: [...salesOrders, child],
    counters: { ...(data.counters || {}), so: num },
    auditLog: [
      ...(data.auditLog || []),
      {
        id: uid(),
        ts: nowIso(),
        type: "backorder-split",
        entity: orderNum,
        description: `Moved ${totalBO} backordered unit(s) from ${order.orderNum} to backorder order ${orderNum} (${order.customer})`,
      },
    ],
  };
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
