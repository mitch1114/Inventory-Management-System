// --- Utility helpers ----------------------------------------------------------
export const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
export const fmt = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
export const fmtNum = (n) => new Intl.NumberFormat("en-US").format(n || 0);
export const fmtDate = (d) =>
  d
    ? new Date(d.includes("T") ? d : d + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "--";
export const fmtTs = (ts) =>
  new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export const nowIso = () => new Date().toISOString();
export const todayIso = () => new Date().toISOString().slice(0, 10);

// Next sales-order number: the counter OR the highest SO-#### actually in the
// data, whichever is greater. A stale counter (tab that missed a sync) can
// otherwise hand out a number that's already taken.
export function nextSoNumber(data) {
  const counter = (data.counters && data.counters.so) || 0;
  const maxExisting = (data.salesOrders || []).reduce((m, o) => {
    const match = /^SO-(\d+)$/.exec(o.orderNum || "");
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return Math.max(counter, maxExisting) + 1;
}

// --- CSV helpers --------------------------------------------------------------
const escCSV = (v) => `"${String(v != null ? v : "").replace(/"/g, '""')}"`;

export function toCSV(rows, headers) {
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escCSV(r[h])).join(","))].join(
    "\n",
  );
}

export function dlCSV(csv, fn) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = fn;
  a.click();
}

export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const hdrs = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const vals = [];
      let cur = "";
      let inQ = false;
      for (const ch of line) {
        if (ch === '"') {
          inQ = !inQ;
          continue;
        }
        if (ch === "," && !inQ) {
          vals.push(cur.trim());
          cur = "";
          continue;
        }
        cur += ch;
      }
      vals.push(cur.trim());
      return Object.fromEntries(hdrs.map((h, i) => [h, vals[i] != null ? vals[i] : ""]));
    });
}

// --- Header row detection for XLSX files with metadata rows ------------------
// Scans the first maxRows rows of raw sheet data (array-of-arrays) for a row
// that looks like a header row (contains at least a SKU-like + QTY-like column).
// Returns { headerRowIdx, headers } or null if the first row is fine.
export function findHeaderRow(sheetData, colAliases, maxRows = 30) {
  const skuAliases = colAliases.sku;
  const qtyAliases = colAliases.qty;
  const matchesAny = (val, aliases) => {
    const lv = String(val || "").toLowerCase().trim();
    if (!lv) return false;
    if (aliases.includes(lv)) return true;
    if (aliases.some((a) => lv.includes(a))) return true;
    if (lv.length >= 3 && aliases.some((a) => a.includes(lv))) return true;
    return false;
  };
  for (let i = 0; i < Math.min(maxRows, sheetData.length); i++) {
    const row = sheetData[i];
    if (!row || !Array.isArray(row)) continue;
    let hasSku = false;
    let hasQty = false;
    for (const cell of row) {
      if (matchesAny(cell, skuAliases)) hasSku = true;
      if (matchesAny(cell, qtyAliases)) hasQty = true;
      if (hasSku && hasQty) return { headerRowIdx: i, headers: row.map((c) => String(c || "").trim()) };
    }
  }
  return null;
}

export function detectCol(headers, aliases) {
  // Pass 1: exact match (header == alias)
  const exact = headers.find((h) => aliases.includes(h.toLowerCase().trim()));
  if (exact) return exact;
  // Pass 2: header contains an alias as substring (e.g. "Order Quantity" contains "quantity")
  for (const h of headers) {
    const lh = h.toLowerCase().trim();
    if (aliases.some((a) => lh.includes(a))) return h;
  }
  // Pass 3: alias contains the header as substring (e.g. alias "order quantity" contains header "quantity")
  for (const h of headers) {
    const lh = h.toLowerCase().trim();
    if (lh.length >= 3 && aliases.some((a) => a.includes(lh))) return h;
  }
  return null;
}
