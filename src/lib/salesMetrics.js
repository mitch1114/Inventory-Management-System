// --- Sales metrics for Reports ---------------------------------------------------
// One flat list of "sales facts" built from live orders + imported history, so
// every period, comparison, customer and channel figure uses the same rules:
//   Top line  = what the customer ordered, dated by ORDER date
//   Invoiced  = what shipped (billed), dated by SHIP date (the invoice date)
// Live orders and imported history never overlap (history import skips PO#s
// that exist as live orders), so they can be summed.
import { historyRevenue, matchCustomer } from "./historyImport";

const filledQty = (l) => (l.qtyFilled != null ? l.qtyFilled : l.qty);

export const CHANNEL_LABELS = {
  dealer: "Dealer",
  distributor: "Distributor",
  "buying-group": "Buying Group",
  "big-box": "Big Box",
};

export function normalizeChannel(t) {
  const s = String(t || "").toLowerCase();
  if (s.startsWith("distributor")) return "distributor";
  if (s === "buying-group") return "buying-group";
  if (s === "big-box") return "big-box";
  return "dealer";
}

export function buildSalesFacts(salesOrders, historicalSales, customers) {
  const custList = customers || [];
  const byName = new Map(custList.map((c) => [String(c.name || "").toLowerCase().trim(), c]));
  const custOf = (name) =>
    byName.get(String(name || "").toLowerCase().trim()) || matchCustomer(name, custList);

  const facts = [];
  (salesOrders || []).forEach((o) => {
    if (o.fulfillmentStage === "cancelled") return;
    const cust = custOf(o.customer);
    const ordered = (o.lines || []).reduce((s, l) => s + l.qty * (l.price || 0), 0);
    const shipped = o.fulfillmentStage === "shipped";
    facts.push({
      source: "live",
      id: o.id,
      customer: (cust && cust.name) || o.customer || "",
      channel: normalizeChannel(o.channel || (cust && cust.type)),
      orderDate: o.date || "",
      ordered,
      shipDate: shipped ? (o.shipment && o.shipment.shipDate) || o.date || "" : "",
      invoiced: shipped
        ? (o.lines || []).reduce((s, l) => s + filledQty(l) * (l.price || 0), 0)
        : null,
      preorder: o.type === "preorder",
    });
  });
  (historicalSales || []).forEach((h) => {
    const cust = custOf(h.customer);
    const invoicedKnown = h.invoiceAmount != null || !!h.shipDate;
    facts.push({
      source: "hist",
      id: h.id,
      customer: (cust && cust.name) || h.customer || "",
      channel: normalizeChannel((cust && cust.type) || h.type),
      orderDate: h.date || "",
      ordered: h.poAmount || 0,
      shipDate: invoicedKnown ? h.shipDate || h.date || "" : "",
      invoiced: invoicedKnown ? historyRevenue(h) : null,
      preorder: false,
    });
  });
  return facts;
}

const inR = (d, [s, e]) => !!d && d >= s && d <= e;

// Period totals. Fill rate = invoiced / ordered value of the orders that
// shipped in the period (same definition as the historical fill rate).
export function periodMetrics(facts, range) {
  let topLine = 0;
  let orders = 0;
  let invoiced = 0;
  let invoicedOrders = 0;
  let fillBase = 0;
  let histShare = false;
  facts.forEach((f) => {
    if (inR(f.orderDate, range)) {
      topLine += f.ordered;
      orders++;
      if (f.source === "hist") histShare = true;
    }
    if (f.invoiced != null && inR(f.shipDate, range)) {
      invoiced += f.invoiced;
      invoicedOrders++;
      fillBase += f.ordered;
      if (f.source === "hist") histShare = true;
    }
  });
  return {
    topLine,
    orders,
    aov: orders > 0 ? topLine / orders : 0,
    invoiced,
    invoicedOrders,
    fillRate: fillBase > 0 ? invoiced / fillBase : null,
    usesHistory: histShare,
  };
}

// { key -> { topLine, invoiced, orders } } for the period
export function groupMetrics(facts, range, keyOf) {
  const m = {};
  const b = (k) => (m[k] = m[k] || { key: k, topLine: 0, invoiced: 0, orders: 0 });
  facts.forEach((f) => {
    const k = keyOf(f);
    if (inR(f.orderDate, range)) {
      b(k).topLine += f.ordered;
      b(k).orders++;
    }
    if (f.invoiced != null && inR(f.shipDate, range)) b(k).invoiced += f.invoiced;
  });
  return m;
}

// Month-by-month totals for a calendar year: [{ m: 1..12, topLine, invoiced }]
export function monthlyForYear(facts, year) {
  const rows = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, topLine: 0, invoiced: 0 }));
  const y = String(year);
  facts.forEach((f) => {
    if ((f.orderDate || "").slice(0, 4) === y) {
      const mi = Number(f.orderDate.slice(5, 7)) - 1;
      if (rows[mi]) rows[mi].topLine += f.ordered;
    }
    if (f.invoiced != null && (f.shipDate || "").slice(0, 4) === y) {
      const mi = Number(f.shipDate.slice(5, 7)) - 1;
      if (rows[mi]) rows[mi].invoiced += f.invoiced;
    }
  });
  return rows;
}

// --- Date range helpers (ISO yyyy-mm-dd, local calendar) ----------------------
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (s) => s.split("-").map(Number);
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

export function addDays(s, n) {
  const [y, m, d] = parts(s);
  const dt = new Date(y, m - 1, d + n);
  return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

// Shift by whole months, clamping the day (Mar 31 - 1 month = Feb 28/29)
export function addMonths(s, n) {
  const [y, m, d] = parts(s);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return iso(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export const daySpan = (s, e) => {
  const [y1, m1, d1] = parts(s);
  const [y2, m2, d2] = parts(e);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000) + 1;
};

/**
 * Comparison range for a period.
 *   mode "prev"     -> the equivalent previous period (previous month-to-date,
 *                      previous quarter-to-date, prior N days, prior-year YTD)
 *   mode "lastYear" -> the same dates one year earlier
 * `range` should already be clipped to today so partial periods compare
 * like-for-like (Sep 1-15 vs Aug 1-15, not vs all of August).
 */
export function compareRange(timeframe, mode, range) {
  if (!range || mode === "none" || timeframe === "allTime") return null;
  const [s, e] = range;
  if (mode === "lastYear") return [addMonths(s, -12), addMonths(e, -12)];
  switch (timeframe) {
    case "thisMonth":
    case "lastMonth":
      return [addMonths(s, -1), addMonths(e, -1)];
    case "thisQuarter":
    case "lastQuarter":
      return [addMonths(s, -3), addMonths(e, -3)];
    case "ytd":
      return [addMonths(s, -12), addMonths(e, -12)];
    default: {
      const len = daySpan(s, e);
      const pe = addDays(s, -1);
      return [addDays(pe, -(len - 1)), pe];
    }
  }
}

// Percent change; null when there's no baseline to compare against
export const pctChange = (cur, prev) => (prev > 0 ? (cur - prev) / prev : null);
