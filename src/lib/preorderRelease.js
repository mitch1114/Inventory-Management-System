// --- Pre-order holding & automatic release ----------------------------------------
// Confirmed pre-orders are HELD out of the pick queue until shortly before their
// requested ship date. PREORDER_RELEASE_DAYS before that date they're released:
// on-hand stock reserved for them becomes real fills (locked), and they join
// the Confirmed column like any other order.
//
// Shared by the browser app and the server cron (api/cron/shipstation-pull.js),
// so imports here must carry explicit .js extensions and stay browser/Node-neutral.
import { LOCKING } from "./constants.js";

export const PREORDER_RELEASE_DAYS = 10;

const lineFilled = (l) => (l.qtyFilled != null ? l.qtyFilled : l.qty);
const lineBO = (l) => (l.qtyBackordered != null ? l.qtyBackordered : 0);

// A pre-order still waiting for its release window
export const isHeldPreorder = (o) =>
  o.fulfillmentStage === "confirmed" && o.type === "preorder" && !o.preorderReleasedAt;

// ISO date the pre-order releases to the pick queue ("" when it has no ship date)
export function releaseDateOf(o) {
  if (!o.requestedShipDate) return "";
  const [y, m, d] = o.requestedShipDate.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - PREORDER_RELEASE_DAYS));
  return dt.toISOString().slice(0, 10);
}

export function lockedByProduct(salesOrders) {
  const locked = {};
  (salesOrders || []).forEach((o) => {
    if (!LOCKING.has(o.fulfillmentStage)) return;
    (o.lines || []).forEach((l) => {
      const f = lineFilled(l);
      if (f > 0) locked[l.productId] = (locked[l.productId] || 0) + f;
    });
  });
  return locked;
}

/**
 * Reserve leftover shelf stock (onHand - locked - current orders' backorders)
 * for the unfilled units of HELD pre-orders, earliest ship window first. Pre-orders import with every unit on
 * backorder so they don't grab stock at import time; this keeps that stock
 * from also being promised to other orders until the pre-order is released or
 * picked (reserved units become real fills then) or receiving fills it.
 *
 * Returns { byLine: { "<orderId>:<lineIdx>": coveredQty }, byProduct: { pid: reservedQty } }.
 */
export function preOrderCoverage(products, salesOrders, lockedMap) {
  const locked = lockedMap || lockedByProduct(salesOrders);
  // Current (non-held) Confirmed orders outrank pre-orders, so their unfilled
  // units come off the pool first
  const currentBO = {};
  (salesOrders || []).forEach((o) => {
    if (o.fulfillmentStage !== "confirmed" || isHeldPreorder(o)) return;
    (o.lines || []).forEach((l) => {
      const bo = lineBO(l);
      if (bo > 0) currentBO[l.productId] = (currentBO[l.productId] || 0) + bo;
    });
  });
  const free = {};
  (products || []).forEach((p) => {
    free[p.id] = Math.max(0, (p.onHand || 0) - (locked[p.id] || 0) - (currentBO[p.id] || 0));
  });
  const byLine = {};
  const byProduct = {};
  const shipKey = (o) => o.requestedShipDate || o.date || "";
  (salesOrders || [])
    .filter(isHeldPreorder)
    .sort(
      (a, b) =>
        shipKey(a).localeCompare(shipKey(b)) ||
        (a.date || "").localeCompare(b.date || "") ||
        (a.orderNum || "").localeCompare(b.orderNum || ""),
    )
    .forEach((o) => {
      (o.lines || []).forEach((l, i) => {
        const bo = lineBO(l);
        if (bo <= 0) return;
        const cover = Math.min(bo, free[l.productId] || 0);
        if (cover <= 0) return;
        free[l.productId] -= cover;
        byLine[`${o.id}:${i}`] = cover;
        byProduct[l.productId] = (byProduct[l.productId] || 0) + cover;
      });
    });
  return { byLine, byProduct };
}

// Held pre-orders whose release date has arrived (pre-orders without a ship
// date never auto-release -- they wait for a manual Pick Now)
export function duePreorders(data, today) {
  return (data.salesOrders || []).filter((o) => {
    if (!isHeldPreorder(o)) return false;
    const rd = releaseDateOf(o);
    return !!rd && rd <= today;
  });
}

/**
 * Release every due pre-order: convert its reserved stock into fills, stamp
 * preorderReleasedAt, and log it. Pure -- returns { data, released } where
 * `released` holds the updated orders (for notifications).
 * @param {Object} data - App state
 * @param {{ today: string, now: string, makeId: () => string }} opts
 *   today: local ISO date (yyyy-mm-dd); now: ISO timestamp; makeId: audit id generator
 */
export function releaseDuePreorders(data, { today, now, makeId }) {
  const due = duePreorders(data, today);
  if (due.length === 0) return { data, released: [] };
  // Coverage favors the earliest ship windows, which are exactly the due ones
  const { byLine } = preOrderCoverage(data.products, data.salesOrders);
  const dueIds = new Set(due.map((o) => o.id));
  const released = [];
  const salesOrders = data.salesOrders.map((o) => {
    if (!dueIds.has(o.id)) return o;
    const lines = (o.lines || []).map((l, i) => {
      const cover = byLine[`${o.id}:${i}`] || 0;
      if (cover <= 0) return l;
      return {
        ...l,
        qtyFilled: (l.qtyFilled != null ? l.qtyFilled : 0) + cover,
        qtyBackordered: lineBO(l) - cover,
      };
    });
    const next = { ...o, lines, preorderReleasedAt: now };
    released.push(next);
    return next;
  });
  const auditLog = [
    ...(data.auditLog || []),
    ...released.map((o) => {
      const ordered = o.lines.reduce((s, l) => s + l.qty, 0);
      const filled = o.lines.reduce((s, l) => s + lineFilled(l), 0);
      const short = o.lines.reduce((s, l) => s + lineBO(l), 0);
      return {
        id: makeId(),
        ts: now,
        type: "preorder-release",
        entity: o.orderNum,
        description: `Pre-order ${o.orderNum} (${o.customer}) released to the pick queue -- ships ${o.requestedShipDate}; ${filled}/${ordered} units in stock${short > 0 ? `, ${short} still on backorder` : ""}`,
      };
    }),
  ];
  return { data: { ...data, salesOrders, auditLog }, released };
}

/**
 * Fill current orders' backorders from stock on the shelf. Current orders
 * outrank HELD pre-orders: the pool is onHand - locked, ignoring pre-order
 * reservations (a pre-order shipping in months shouldn't block an order that
 * needs to ship this week -- the pre-order shows as awaiting stock instead).
 * Only Confirmed, non-held orders are touched; picked orders keep whatever
 * quantities were actually picked. Oldest order first.
 * Pure -- returns { data, filled: [{ orderNum, units }] }.
 */
export function fillBackordersFromStock(data, { now, makeId }) {
  const locked = lockedByProduct(data.salesOrders);
  const pool = {};
  (data.products || []).forEach((p) => {
    pool[p.id] = Math.max(0, (p.onHand || 0) - (locked[p.id] || 0));
  });
  const targets = (data.salesOrders || [])
    .filter(
      (o) =>
        o.fulfillmentStage === "confirmed" &&
        !isHeldPreorder(o) &&
        (o.lines || []).some((l) => lineBO(l) > 0 && (pool[l.productId] || 0) > 0),
    )
    .sort(
      (a, b) =>
        (a.date || "").localeCompare(b.date || "") ||
        (a.orderNum || "").localeCompare(b.orderNum || ""),
    );
  if (targets.length === 0) return { data, filled: [] };
  const updated = {};
  const filled = [];
  targets.forEach((o) => {
    let units = 0;
    const lines = o.lines.map((l) => {
      const take = Math.min(lineBO(l), pool[l.productId] || 0);
      if (take <= 0) return l;
      pool[l.productId] -= take;
      units += take;
      return { ...l, qtyFilled: (l.qtyFilled != null ? l.qtyFilled : 0) + take, qtyBackordered: lineBO(l) - take };
    });
    if (units > 0) {
      updated[o.id] = { ...o, lines };
      filled.push({ orderNum: o.orderNum, customer: o.customer, units });
    }
  });
  if (filled.length === 0) return { data, filled: [] };
  return {
    data: {
      ...data,
      salesOrders: data.salesOrders.map((o) => updated[o.id] || o),
      auditLog: [
        ...(data.auditLog || []),
        ...filled.map((f) => ({
          id: makeId(),
          ts: now,
          type: "auto-allocated",
          entity: f.orderNum,
          description: `Filled ${f.units} backordered unit(s) on ${f.orderNum} (${f.customer}) from on-hand stock`,
        })),
      ],
    },
    filled,
  };
}

/**
 * The automatic order pass run by the app and the cron: fill current orders
 * from shelf stock first, then release pre-orders that are due (they take
 * the reserved stock that's left).
 * Returns { data, filled, released }.
 */
export function runOrderAutomation(data, opts) {
  const f = fillBackordersFromStock(data, opts);
  const r = releaseDuePreorders(f.data, opts);
  return { data: r.data, filled: f.filled, released: r.released };
}
