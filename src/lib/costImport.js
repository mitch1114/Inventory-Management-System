// --- Product cost import from the ACC pricing & margins workbook -------------------
// Reads the "Pricing costs" sheet (per-SKU complete goods cost + active landed
// cost incl. estimated DDP) and maps it onto products' costPrice / landedCost,
// plus FET settings from the "Products" sheet (class, rate, per-article cap,
// constructive distributor-price base) for order margins.
// SKUs the workbook hasn't costed yet ("n.a.") are skipped, never zeroed.
// Pure functions over sheet rows (arrays of cell values, e.g.
// XLSX.utils.sheet_to_json(ws, { header: 1, raw: true })) so they're testable.
import { buildScanIndex, matchScan } from "./scan";

const money = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(s)) return null; // "n.a.", "-", notes
  return parseFloat(s);
};
const round4 = (n) => Math.round(n * 10000) / 10000;
// Percent cell: 0.1 (raw) or "10.0%" (text) -> 0.1
const pct = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const m = /^\s*(-?\d*\.?\d+)\s*%\s*$/.exec(String(v));
  return m ? parseFloat(m[1]) / 100 : null;
};
const cell = (row, i) => (i >= 0 && row ? row[i] : null);
const findCol = (header, re) => header.findIndex((h) => re.test(String(h || "").trim()));

/**
 * Parse the workbook's per-SKU costs.
 * @param {Array<Array>} costRows - "Pricing costs" sheet rows
 * @param {Array<Array>} [productRows] - "Products" sheet rows (adds UPCs for matching)
 * @returns {{ rows: Array<{sku, upc, fet, category, goods, landed, status}>, error?: string }}
 */
export function parsePricingCosts(costRows, productRows) {
  const hIdx = (costRows || []).findIndex(
    (r) => r && r.some((c) => String(c || "").trim() === "SKU") && r.some((c) => /complete goods/i.test(String(c || ""))),
  );
  if (hIdx === -1) return { rows: [], error: 'Couldn\'t find the "Pricing costs" table (expected SKU and Complete goods / unit columns).' };
  const header = costRows[hIdx];
  const col = {
    sku: findCol(header, /^SKU$/),
    category: findCol(header, /^Category$/i),
    goods: findCol(header, /complete goods/i),
    landed: findCol(header, /active pricing cost/i),
    standardLanded: findCol(header, /^standard landed/i),
    status: findCol(header, /cost status/i),
  };

  // Products sheet: UPC (for matching) + FET settings per SKU
  const upcBySku = {};
  const fetBySku = {};
  const pHdr = (productRows || []).findIndex(
    (r) => r && r.some((c) => String(c || "").trim() === "SKU") && r.some((c) => String(c || "").trim() === "UPC"),
  );
  if (pHdr !== -1) {
    const ph = productRows[pHdr];
    const ps = findCol(ph, /^SKU$/);
    const pu = findCol(ph, /^UPC$/);
    const pClass = findCol(ph, /^FET class$/i);
    const pRate = findCol(ph, /^FET rate$/i);
    const pCap = findCol(ph, /^Rod cap/i);
    const pBase = findCol(ph, /constructive FET base/i);
    productRows.slice(pHdr + 1).forEach((r) => {
      const sku = String(cell(r, ps) || "").trim();
      if (!sku) return;
      const upc = String(cell(r, pu) || "").trim();
      if (upc) upcBySku[sku.toUpperCase()] = upc;
      const rate = pct(cell(r, pRate));
      if (rate != null) {
        fetBySku[sku.toUpperCase()] = {
          fetClass: String(cell(r, pClass) || "").trim(),
          fetRate: rate,
          fetCap: money(cell(r, pCap)),
          fetBase: money(cell(r, pBase)),
        };
      }
    });
  }

  const rows = [];
  for (const r of costRows.slice(hIdx + 1)) {
    const sku = String(cell(r, col.sku) || "").trim();
    // The SKU table ends at the first blank row (the shipment-history section follows)
    if (!sku) break;
    const landed = money(cell(r, col.landed));
    rows.push({
      sku,
      upc: upcBySku[sku.toUpperCase()] || "",
      fet: fetBySku[sku.toUpperCase()] || null,
      category: String(cell(r, col.category) || "").trim(),
      goods: money(cell(r, col.goods)),
      landed: landed != null ? landed : money(cell(r, col.standardLanded)),
      status: String(cell(r, col.status) || "").trim(),
    });
  }
  return { rows };
}

/**
 * Match workbook rows to products (SKU first, then UPC) and work out changes.
 * @returns {{ updates: Array, unchanged: Array, incomplete: Array, unmatched: Array, notInWorkbook: Array }}
 */
export function planCostImport(rows, products) {
  const bySku = new Map((products || []).map((p) => [String(p.sku || "").trim().toUpperCase(), p]));
  const scanIdx = buildScanIndex(products || []);
  const byId = new Map((products || []).map((p) => [p.id, p]));
  const updates = [];
  const unchanged = [];
  const incomplete = [];
  const unmatched = [];
  const touched = new Set();

  rows.forEach((r) => {
    if (r.goods == null && r.landed == null && !r.fet) {
      incomplete.push(r);
      return;
    }
    let p = bySku.get(r.sku.toUpperCase());
    let matchedBy = "sku";
    if (!p && r.upc) {
      const pid = matchScan(scanIdx, r.upc);
      p = pid ? byId.get(pid) : null;
      matchedBy = "upc";
    }
    if (!p) {
      unmatched.push(r);
      return;
    }
    touched.add(p.id);
    const newCost = r.goods != null ? round4(r.goods) : p.costPrice || 0;
    const newLanded = r.landed != null ? round4(r.landed) : p.landedCost || 0;
    const entry = {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      wbSku: r.sku,
      matchedBy,
      status: r.status,
      oldCost: p.costPrice || 0,
      newCost,
      oldLanded: p.landedCost || 0,
      newLanded,
      landedMissing: r.landed == null,
      costMissing: r.goods == null && r.landed == null,
      oldFet: { fetRate: p.fetRate ?? null, fetCap: p.fetCap ?? null, fetBase: p.fetBase ?? null },
      newFet: r.fet
        ? { fetClass: r.fet.fetClass, fetRate: r.fet.fetRate, fetCap: r.fet.fetCap, fetBase: r.fet.fetBase }
        : null,
    };
    const fetSame =
      !entry.newFet ||
      (entry.oldFet.fetRate === entry.newFet.fetRate &&
        entry.oldFet.fetCap === entry.newFet.fetCap &&
        entry.oldFet.fetBase === entry.newFet.fetBase);
    const same =
      fetSame && Math.abs(entry.oldCost - newCost) < 0.00005 && Math.abs(entry.oldLanded - newLanded) < 0.00005;
    (same ? unchanged : updates).push(entry);
  });

  const notInWorkbook = (products || []).filter((p) => !touched.has(p.id));
  return { updates, unchanged, incomplete, unmatched, notInWorkbook };
}

/** Apply a plan's updates to app state (costs only -- nothing else changes). */
export function applyCostImport(data, plan, { fileName, now, makeId }) {
  const upd = new Map(plan.updates.map((u) => [u.productId, u]));
  const products = data.products.map((p) => {
    const u = upd.get(p.id);
    if (!u) return p;
    return {
      ...p,
      costPrice: u.newCost,
      landedCost: u.newLanded,
      ...(u.newFet || {}),
      costSource: { file: fileName || "pricing workbook", importedAt: now, status: u.status || "" },
    };
  });
  return {
    ...data,
    products,
    auditLog: [
      ...(data.auditLog || []),
      {
        id: makeId(),
        ts: now,
        type: "adjustment",
        entity: "cost-import",
        description: `Imported product costs & FET from ${fileName || "pricing workbook"}: ${plan.updates.length} updated, ${plan.unchanged.length} unchanged, ${plan.incomplete.length} skipped (no cost yet), ${plan.unmatched.length} not found in the app`,
      },
    ],
  };
}
