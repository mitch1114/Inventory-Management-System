// --- Product cost import from the ACC pricing & margins workbook -------------------
// Reads the "Pricing costs" sheet (per-SKU complete goods cost + active landed
// cost incl. estimated DDP) and maps it onto products' costPrice / landedCost.
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
const cell = (row, i) => (i >= 0 && row ? row[i] : null);
const findCol = (header, re) => header.findIndex((h) => re.test(String(h || "").trim()));

/**
 * Parse the workbook's per-SKU costs.
 * @param {Array<Array>} costRows - "Pricing costs" sheet rows
 * @param {Array<Array>} [productRows] - "Products" sheet rows (adds UPCs for matching)
 * @returns {{ rows: Array<{sku, upc, category, goods, landed, status}>, error?: string }}
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

  const upcBySku = {};
  const pHdr = (productRows || []).findIndex(
    (r) => r && r.some((c) => String(c || "").trim() === "SKU") && r.some((c) => String(c || "").trim() === "UPC"),
  );
  if (pHdr !== -1) {
    const ps = productRows[pHdr].findIndex((c) => String(c || "").trim() === "SKU");
    const pu = productRows[pHdr].findIndex((c) => String(c || "").trim() === "UPC");
    productRows.slice(pHdr + 1).forEach((r) => {
      const sku = String(cell(r, ps) || "").trim();
      const upc = String(cell(r, pu) || "").trim();
      if (sku && upc) upcBySku[sku.toUpperCase()] = upc;
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
    if (r.goods == null && r.landed == null) {
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
    };
    const same = Math.abs(entry.oldCost - newCost) < 0.00005 && Math.abs(entry.oldLanded - newLanded) < 0.00005;
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
        description: `Imported product costs from ${fileName || "pricing workbook"}: ${plan.updates.length} updated, ${plan.unchanged.length} unchanged, ${plan.incomplete.length} skipped (no cost yet), ${plan.unmatched.length} not found in the app`,
      },
    ],
  };
}
