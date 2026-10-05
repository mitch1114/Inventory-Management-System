// --- Order margin --------------------------------------------------------------------
// Gross margin on an order, using the price the customer actually agreed to on
// each line (no list prices needed):
//
//   revenue  = merchandise (qty x line price) + freight billed to the customer
//   costs    = landed cost of goods + FET + shipping cost
//   profit   = revenue - costs        margin % = profit / revenue
//
// which equals merchandise - COGS - FET - freight ACC pays. Mirrors the pricing
// workbook's "margin after shipping" (before selling costs / allowances).
//
// Unit cost and FET are SNAPSHOTTED onto each line when the order ships
// (snapshotLineCosts), so later cost updates never rewrite past margins.
// Open orders and orders shipped before snapshots existed use current product
// cost and are flagged as estimates.
import { billableFreight } from "./freight";

export const MARGIN_TARGET = 0.3; // workbook contribution-margin target

const filledQty = (l) => (l.qtyFilled != null ? l.qtyFilled : l.qty);
const r4 = (n) => Math.round(n * 10000) / 10000;

// Landed cost per unit for a product (supplier cost when no landed cost yet)
export const productUnitCost = (p) => (p && (p.landedCost || p.costPrice)) || 0;

/**
 * Federal excise tax per unit (sport fishing equipment), following the
 * workbook: rate x min(constructive base, actual unit price), capped per
 * article for rods/combos. Base defaults to the actual price when no
 * constructive (distributor) base is on file.
 * @returns {number|null} null when the product has no FET rate set
 */
export function fetPerUnit(p, unitPrice) {
  if (!p || p.fetRate == null || p.fetRate === "") return null;
  const rate = Number(p.fetRate) || 0;
  if (rate <= 0) return 0;
  const base = p.fetBase > 0 ? Math.min(p.fetBase, unitPrice || 0) : unitPrice || 0;
  const tax = rate * base;
  return r4(p.fetCap > 0 ? Math.min(tax, p.fetCap) : tax);
}

/** Copy each line's current unit cost + FET onto the line (call at shipment). */
export function snapshotLineCosts(lines, products) {
  const byId = new Map((products || []).map((p) => [p.id, p]));
  return (lines || []).map((l) => {
    const p = byId.get(l.productId);
    const fet = fetPerUnit(p, l.price);
    return {
      ...l,
      unitCost: r4(productUnitCost(p)),
      ...(fet != null ? { fetUnit: fet } : {}),
    };
  });
}

/**
 * Margin for one order.
 * Shipped orders use filled quantities; open orders use ordered quantities
 * (what's expected to ship). Freight only counts once a shipping cost exists.
 * @param {Object} order
 * @param {Object} prodMap - productId -> product
 */
export function orderMargin(order, prodMap) {
  const shipped = order.fulfillmentStage === "shipped";
  let merch = 0;
  let cogs = 0;
  let fet = 0;
  let estimatedCost = false;
  const missingCost = [];
  const missingFet = [];
  const lines = (order.lines || []).map((l) => {
    const p = prodMap[l.productId];
    const qty = shipped ? filledQty(l) : l.qty;
    const price = l.price || 0;
    const snap = l.unitCost != null;
    const unitCost = snap ? l.unitCost : productUnitCost(p);
    if (!snap) estimatedCost = true;
    if (qty > 0 && !(unitCost > 0)) missingCost.push(p ? p.sku : l.productId);
    let unitFet = l.fetUnit != null ? l.fetUnit : fetPerUnit(p, price);
    if (unitFet == null) {
      if (qty > 0) missingFet.push(p ? p.sku : l.productId);
      unitFet = 0;
    }
    const rev = qty * price;
    const cost = qty * unitCost;
    const tax = qty * unitFet;
    merch += rev;
    cogs += cost;
    fet += tax;
    return {
      productId: l.productId,
      sku: p ? p.sku : "",
      name: p ? p.name : "",
      qty,
      price,
      unitCost,
      unitFet,
      revenue: rev,
      cogs: cost,
      fet: tax,
      profit: rev - cost - tax,
      costSource: snap ? "snapshot" : unitCost > 0 ? "current" : "missing",
    };
  });
  const ship = order.shipment || {};
  const freightKnown = ship.shippingCost != null && ship.shippingCost !== "";
  const shippingCost = freightKnown ? Number(ship.shippingCost) || 0 : 0;
  const freightBilled = freightKnown ? billableFreight(order) : 0;
  const revenue = merch + freightBilled;
  const profit = revenue - cogs - fet - shippingCost;
  return {
    merch,
    freightBilled,
    revenue,
    cogs,
    fet,
    shippingCost,
    accFreight: shippingCost - freightBilled,
    profit,
    marginPct: revenue > 0 ? profit / revenue : null,
    freightKnown,
    estimatedCost,
    missingCost,
    missingFet,
    complete: missingCost.length === 0,
    lines,
  };
}

/** Sum margins over many orders. */
export function sumMargins(results) {
  const t = { merch: 0, freightBilled: 0, revenue: 0, cogs: 0, fet: 0, shippingCost: 0, accFreight: 0, profit: 0, orders: 0, incomplete: 0, estimated: 0 };
  results.forEach((m) => {
    ["merch", "freightBilled", "revenue", "cogs", "fet", "shippingCost", "accFreight", "profit"].forEach((k) => (t[k] += m[k]));
    t.orders++;
    if (!m.complete) t.incomplete++;
    if (m.estimatedCost) t.estimated++;
  });
  t.marginPct = t.revenue > 0 ? t.profit / t.revenue : null;
  return t;
}

export const marginColor = (pct) =>
  pct == null ? "#94A3B8" : pct < 0 ? "#B91C1C" : pct < MARGIN_TARGET ? "#B45309" : "#15803D";
