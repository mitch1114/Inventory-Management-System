// --- Historical data import ----------------------------------------------------
// Parses the two one-time company spreadsheets (customer contact list + running
// YOY sales sheet) and merges them into app state:
//   - customers: bill-to address / email / phone merged by name, BLANKS ONLY --
//     the ship-to `address` field is NEVER touched (it feeds ShipStation).
//   - historicalSales: order-level history rows (no SKUs), kept separate from
//     live salesOrders so they can't affect inventory, the board, or counters.
import { parseCSV, uid } from "./utils";

// Normalize a customer name for matching: lowercase, & -> and, drop
// punctuation, drop trailing business suffixes, collapse whitespace.
export function normalizeName(name) {
  let s = String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[',’.“”"#()]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Strip trailing legal suffixes (repeat for "co inc" style tails)
  for (let i = 0; i < 2; i++) {
    s = s.replace(/\b(llc|inc|co|corp|corporation|company|ltd)$/g, "").trim();
  }
  return s;
}

// Known name variants: normalized sales-sheet name -> normalized customer-list
// name. Only for cases normalization can't bridge.
const NAME_ALIASES = {
  "armstrong crickets": "armstrong tackle",
  "bucksaw marina": "bucksaw resort and marina",
  "bucksaw resort": "bucksaw resort and marina",
  "tim hunter and associates": "tim hunter and assiciates", // list has the typo
  "fast break bait and tackle": "fast break",
  "winchester sportsmans outfitters": "winchesters sportsmans outfitters",
  "winchesters sportmans outfitters": "winchesters sportsmans outfitters",
  "limits sporting good": "limits sporting goods",
  "pressleys outdoors": "presleys outdoors",
  "milans fishing and archery": "milans archery and fishing",
  "ane": "ane wholesale",
  "thumpers elite": "thumpers elite outfitters",
};

// Find an existing customer for a sheet name. Tries normalized equality,
// aliases, then a space-less comparison (catches "MidwayUSA" vs "Midway USA").
export function matchCustomer(sheetName, customers) {
  const n = normalizeName(sheetName);
  if (!n) return null;
  const target = NAME_ALIASES[n] || n;
  const squash = (s) => s.replace(/ /g, "");
  for (const c of customers) {
    const cn = normalizeName(c.name);
    if (cn === target || cn === n) return c;
  }
  for (const c of customers) {
    if (squash(normalizeName(c.name)) === squash(target)) return c;
  }
  return null;
}

// --- Money / date cleaning ------------------------------------------------------
export function parseMoney(v) {
  const s = String(v == null ? "" : v).replace(/[^0-9.-]/g, "");
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Accepts "31-Jul-26", "10/3/2026", "2026-07-31". Junk ("HOLD FOR PAYMENT",
// "NA", malformed) returns null.
export function parseSheetDate(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})-([A-Za-z]{3})[A-Za-z]*-(\d{2,4})$/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (!mo) return null;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${String(mo).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  return null;
}

// --- Customer contact list CSV ---------------------------------------------------
// Expected columns: cust_data (name), Bill to, Main Email, Main Phone.
// The BOUNCE column is spreadsheet lookup noise and is ignored.
export function parseCustomerListCSV(text) {
  const lines = String(text || "").split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /cust_data/i.test(l) || (/bill\s*to/i.test(l) && /email/i.test(l)));
  if (headerIdx === -1) return { error: "Couldn't find the header row (expected columns like cust_data / Bill to / Main Email)." };
  const rows = parseCSV(lines.slice(headerIdx).join("\n"));
  const headers = Object.keys(rows[0] || {});
  const col = (re) => headers.find((h) => re.test(h)) || null;
  const nameCol = col(/cust_data|^name$|customer/i);
  const billCol = col(/bill\s*to/i);
  const emailCol = col(/email/i);
  const phoneCol = col(/phone/i);
  if (!nameCol) return { error: `No name column found. Columns: ${headers.join(", ")}` };

  const seen = new Set();
  const customers = [];
  for (const r of rows) {
    const name = (r[nameCol] || "").trim();
    if (!name) continue;
    const key = normalizeName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    customers.push({
      name,
      billToAddress: billCol ? (r[billCol] || "").trim() : "",
      email: emailCol ? (r[emailCol] || "").trim() : "",
      phone: phoneCol ? (r[phoneCol] || "").trim() : "",
    });
  }
  return { customers };
}

// Merge parsed customer rows into the existing customer list. Existing
// customers (matched by name) only get BLANK fields filled; the ship-to
// `address` field is never written. Returns { customers, added, updated }.
export function mergeCustomerList(existing, parsed) {
  const out = existing.map((c) => ({ ...c }));
  let added = 0;
  let updated = 0;
  for (const p of parsed) {
    const match = matchCustomer(p.name, out);
    if (match) {
      const idx = out.findIndex((c) => c.id === match.id);
      const c = out[idx];
      const next = {
        ...c,
        billToAddress: c.billToAddress || p.billToAddress,
        email: c.email || p.email,
        phone: c.phone || p.phone,
      };
      if (next.billToAddress !== c.billToAddress || next.email !== c.email || next.phone !== c.phone) updated++;
      out[idx] = next;
    } else {
      out.push({
        id: uid(),
        name: p.name,
        type: "dealer",
        email: p.email,
        phone: p.phone,
        address: "", // ship-to intentionally left blank
        billToAddress: p.billToAddress,
      });
      added++;
    }
  }
  return { customers: out, added, updated };
}

// --- Sales history CSV -----------------------------------------------------------
// The sheet has 2 junk rows (totals + owner names) before the real header:
// Customer, State, PO Date, PO Amount, Dealer, House, PO#, Ship Date, Freight,
// Tracking#, INVOICE#, INVOICE AMOUNT, ...
export function parseSalesHistoryCSV(text) {
  const lines = String(text || "").split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /customer/i.test(l) && /po date/i.test(l));
  if (headerIdx === -1) return { error: "Couldn't find the header row (expected columns Customer / PO Date / PO Amount...)." };
  const rows = parseCSV(lines.slice(headerIdx).join("\n"));
  const headers = Object.keys(rows[0] || {});
  const col = (re) => headers.find((h) => re.test(h.trim())) || null;
  const c = {
    customer: col(/^customer$/i),
    state: col(/^state$/i),
    poDate: col(/po date/i),
    poAmount: col(/po amount/i),
    type: col(/^dealer$/i),
    poRef: col(/^po#$/i),
    shipDate: col(/ship date/i),
    tracking: col(/tracking/i),
    invoiceNum: col(/^invoice#$/i),
    invoiceAmount: col(/invoice amount/i),
  };
  if (!c.customer || !c.poAmount) {
    return { error: `Missing required columns. Found: ${headers.join(", ")}` };
  }

  // Junk "customer" values from malformed / column-shifted sheet rows
  const JUNK_NAMES = new Set(["dealer", "distributor", "house", "tha", "customer"]);
  const entries = [];
  let blank = 0;
  for (const r of rows) {
    const customer = (r[c.customer] || "").trim();
    const poAmount = parseMoney(r[c.poAmount]);
    const nc = normalizeName(customer);
    if (!customer || poAmount == null || JUNK_NAMES.has(nc) || /^[a-z]{2}$/.test(nc)) {
      blank++;
      continue;
    }
    entries.push({
      customer,
      state: c.state ? (r[c.state] || "").trim() : "",
      date: parseSheetDate(r[c.poDate]),
      poAmount,
      type: /distributor/i.test(c.type ? r[c.type] || "" : "") ? "distributor" : "dealer",
      poRef: c.poRef ? (r[c.poRef] || "").trim() : "",
      shipDate: parseSheetDate(c.shipDate ? r[c.shipDate] : null),
      tracking: c.tracking ? (r[c.tracking] || "").trim() : "",
      invoiceNum: c.invoiceNum ? (r[c.invoiceNum] || "").trim() : "",
      invoiceAmount: parseMoney(c.invoiceAmount ? r[c.invoiceAmount] : null),
    });
  }
  return { entries, skippedBlank: blank };
}

// Build the import plan: match each history row to a customer (existing or to
// be created), and skip rows whose PO# already exists as a live order's dealer
// PO ref (overlap with the operational system).
export function buildSalesImportPlan(entries, customers, salesOrders) {
  const livePoRefs = new Set(
    (salesOrders || [])
      .map((o) => (o.dealerPORef || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const skippedOverlap = [];
  const newCustomerMap = new Map(); // normalized -> { name, type }
  const rows = [];
  for (const e of entries) {
    if (e.poRef && livePoRefs.has(e.poRef.toLowerCase())) {
      skippedOverlap.push(e);
      continue;
    }
    const match = matchCustomer(e.customer, customers);
    const canonical = match ? match.name : e.customer;
    if (!match) {
      const key = normalizeName(e.customer);
      if (!newCustomerMap.has(key)) newCustomerMap.set(key, { name: e.customer, type: e.type });
    }
    rows.push({ ...e, customer: canonical, matched: !!match });
  }
  return {
    rows,
    skippedOverlap,
    newCustomers: [...newCustomerMap.values()],
  };
}

// Revenue basis for a history entry: what was actually invoiced when known,
// the PO amount otherwise (open/unbilled rows).
export const historyRevenue = (h) => (h.invoiceAmount != null ? h.invoiceAmount : h.poAmount);

// Aggregate history for one customer (matched by normalized name).
export function customerHistoryStats(historicalSales, customerName) {
  const key = normalizeName(customerName);
  const rows = (historicalSales || []).filter((h) => normalizeName(h.customer) === key);
  let po = 0;
  let invoiced = 0;
  let withInvoice = 0;
  let first = null;
  let last = null;
  rows.forEach((h) => {
    po += h.poAmount || 0;
    if (h.invoiceAmount != null) {
      invoiced += h.invoiceAmount;
      withInvoice += h.poAmount || 0;
    }
    if (h.date) {
      if (!first || h.date < first) first = h.date;
      if (!last || h.date > last) last = h.date;
    }
  });
  return {
    rows,
    orders: rows.length,
    poTotal: po,
    invoicedTotal: invoiced,
    revenue: rows.reduce((s, h) => s + historyRevenue(h), 0),
    fillRate: withInvoice > 0 ? invoiced / withInvoice : null,
    first,
    last,
  };
}
