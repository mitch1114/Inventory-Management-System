// --- DEALER PO IMPORT ---------------------------------------------------------
// Natively parses ACC Crappie Stix order writer format (dealer + distributor).
//
// The order writer template has shipped in more than one layout (e.g. the 2026
// distributor writer swapped the UPC# and PRODUCT CODE columns and shifted the
// program-type cell down a row), so nothing here relies on fixed row/column
// positions. Instead:
//   - The product table header row is located by its labels (PRODUCT CODE,
//     DESCRIPTION, ORDER QUANTITY) and column indices are mapped by name.
//   - Header metadata (Customer Name:, PO#:, Order Date:, ...) is found by
//     scanning for the label and reading the value beside/below it.
//
// Known layouts covered:
//   2025 dealer/distributor writer: PRODUCT CODE | DESCRIPTION | UPC# | ORDER QUANTITY | ...
//   2026 distributor writer:        UPC# | DESCRIPTION | PRODUCT CODE | ORDER QUANTITY | ...
// Col labels vary: "DEALER COST" / "DIST COST" / "DISTRIBUTOR COST" are the same
// field, as are "DEALER. EXT" / "DIST. EXT".

// Format a value as yyyy-mm-dd. XLSX (cellDates: true) hands us Date objects;
// serial-based dates land on UTC midnight, so prefer UTC getters in that case
// to avoid the off-by-one-day shift in US timezones.
function toIsoDate(v) {
  if (v instanceof Date) {
    const useUtc = v.getUTCHours() === 0 && v.getUTCMinutes() === 0;
    const y = useUtc ? v.getUTCFullYear() : v.getFullYear();
    const m = (useUtc ? v.getUTCMonth() : v.getMonth()) + 1;
    const d = useUtc ? v.getUTCDate() : v.getDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

function cellStr(v) {
  if (v == null) return "";
  const iso = toIsoDate(v);
  if (iso) return iso;
  return String(v).trim();
}

// Locate the product table header row and map its columns by label.
function findProductHeader(sheetData) {
  const max = Math.min(40, sheetData.length);
  for (let i = 0; i < max; i++) {
    const row = sheetData[i];
    if (!row) continue;
    const labels = row.map((c) => String(c == null ? "" : c).toUpperCase().trim());
    const skuCol = labels.findIndex((l) => l.includes("PRODUCT CODE"));
    if (skuCol === -1) continue;
    const descCol = labels.findIndex((l) => l.includes("DESCRIPTION"));
    const qtyCol = labels.findIndex((l) => l.includes("ORDER QUANTITY") || l === "QTY" || l.includes("ORDER QTY"));
    if (descCol === -1 || qtyCol === -1) continue;
    const cols = {
      sku: skuCol,
      desc: descCol,
      qty: qtyCol,
      upc: labels.findIndex((l) => l.includes("UPC")),
      status: labels.findIndex((l) => l === "STATUS"),
      moq: labels.findIndex((l) => l === "MOQ"),
      cost: labels.findIndex((l) => l.includes("COST") && !l.includes("EXT")),
      msrp: labels.findIndex((l) => l === "MSRP"),
      extCost: labels.findIndex((l) => l.includes("EXT") && !l.includes("MSRP")),
    };
    return { headerRow: i, cols };
  }
  return null;
}

// Find a labeled metadata value: the first non-empty cell to the RIGHT of the
// cell whose text starts with the label (e.g. "Customer Name:" -> "Pitman Creek").
function findLabeledValue(sheetData, label, maxRow) {
  const target = label.toUpperCase();
  for (let i = 0; i < Math.min(maxRow, sheetData.length); i++) {
    const row = sheetData[i];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] == null ? "" : row[j]).toUpperCase().trim();
      if (cell.startsWith(target)) {
        for (let k = j + 1; k < row.length; k++) {
          const v = cellStr(row[k]);
          if (v !== "") return v;
        }
        return "";
      }
    }
  }
  return "";
}

// Find a section value: the first non-empty cell in the same column on the rows
// BELOW the label (e.g. "SHIP TO ADDRESS" -> address on the next row).
function findValueBelow(sheetData, label, maxRow) {
  const target = label.toUpperCase();
  for (let i = 0; i < Math.min(maxRow, sheetData.length); i++) {
    const row = sheetData[i];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] == null ? "" : row[j]).toUpperCase().trim();
      if (cell.startsWith(target)) {
        for (let k = i + 1; k < Math.min(i + 4, sheetData.length); k++) {
          const v = cellStr(sheetData[k] && sheetData[k][j]);
          if (v !== "") return v;
        }
        return "";
      }
    }
  }
  return "";
}

// Find a labeled numeric total (e.g. "DISTRIBUTOR TOTAL" ... 4353).
function findLabeledNumber(sheetData, labels, maxRow) {
  const targets = labels.map((l) => l.toUpperCase());
  for (let i = 0; i < Math.min(maxRow, sheetData.length); i++) {
    const row = sheetData[i];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] == null ? "" : row[j]).toUpperCase().trim();
      if (targets.some((t) => cell === t || cell.startsWith(t))) {
        for (let k = j + 1; k < row.length; k++) {
          const n = parseFloat(row[k]);
          if (!isNaN(n)) return n;
        }
      }
    }
  }
  return 0;
}

export function parseAccOrderWriter(sheetData) {
  const headerInfo = findProductHeader(sheetData);
  if (!headerInfo) return null;
  const { headerRow, cols } = headerInfo;

  // Program type (dealer / distributor / buying group): scan the header area
  // for the program-type text (its cell has moved between template versions).
  let fileType = "dealer";
  for (let i = 0; i < headerRow; i++) {
    const row = sheetData[i];
    if (!row) continue;
    const text = row.map((c) => String(c == null ? "" : c)).join(" ").toUpperCase();
    if (text.includes("BUYING GROUP")) {
      fileType = "buying-group";
      break;
    }
    if (text.includes("DISTRIBUTOR PROGRAM") || text.includes("DISTRIBUTOR PRO")) {
      fileType = "distributor";
      break;
    }
  }

  const customerName = findLabeledValue(sheetData, "CUSTOMER NAME", headerRow);
  const orderDateRaw = findLabeledValue(sheetData, "ORDER DATE", headerRow);
  const buyerName = findLabeledValue(sheetData, "BUYER NAME", headerRow);
  const buyerEmail = findLabeledValue(sheetData, "BUYER EMAIL", headerRow);
  const poNumber = findLabeledValue(sheetData, "PO#", headerRow);
  const shipDateRaw = findLabeledValue(sheetData, "SHIP DATE", headerRow);
  const shipToAddr = findValueBelow(sheetData, "SHIP TO ADDRESS", headerRow);
  const billToAddr = findValueBelow(sheetData, "BILL TO ADDRESS", headerRow);
  // The order writer template labels this "COMMENTS" or (newer) "SPECIAL INSTRUCTIONS".
  const comments =
    findLabeledValue(sheetData, "SPECIAL INSTRUCTIONS", headerRow) ||
    findValueBelow(sheetData, "SPECIAL INSTRUCTIONS", headerRow) ||
    findLabeledValue(sheetData, "COMMENTS", headerRow) ||
    findValueBelow(sheetData, "COMMENTS", headerRow);
  const distTotal = findLabeledNumber(sheetData, ["DISTRIBUTOR TOTAL", "DEALER TOTAL"], headerRow);
  const msrpTotal = findLabeledNumber(sheetData, ["MSRP TOTAL"], headerRow);

  // Normalize dates -- may already be ISO (from Date objects) or a date string.
  const parseDate = (raw) => {
    if (!raw) return todayLocalIso();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    try {
      const d = new Date(raw);
      if (!isNaN(d)) {
        // String dates parse in local time -- format with local getters.
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
    } catch (_e) {
      /* ignore */
    }
    return todayLocalIso();
  };
  const orderDate = parseDate(orderDateRaw);
  const shipDate = parseDate(shipDateRaw);

  const col = (row, idx) => (idx === -1 || idx == null ? undefined : row[idx]);

  // Parse product rows. Replacement tips are orderable line items, so the
  // tips section is parsed like any other rows -- only its heading marker is
  // skipped. Inside the tips section, N/A UPCs are normal (2026 dealer
  // writer) and some rows reuse the ROD's SKU for its tip, so tip SKUs are
  // derived to keep them from importing as the rod itself.
  const products = [];
  const looksLikeUpc = (s) => /^\d{11,14}$/.test(s);
  let inTipsSection = false;

  for (let i = headerRow + 1; i < sheetData.length; i++) {
    const row = sheetData[i];
    if (!row || row.every((c) => c == null || c === "" || c === 0)) continue;

    const rowText = row.map((c) => String(c == null ? "" : c)).join(" ").toUpperCase();

    // Section headings / program notes can appear in any column depending on
    // template version, so match against the whole row.
    if (rowText.includes("REPLACEMENT TIP PRICING")) {
      inTipsSection = true;
      continue;
    }

    let sku = cellStr(col(row, cols.sku));
    let upc = cellStr(col(row, cols.upc)).replace(/\.0$/, "");
    let desc = cellStr(col(row, cols.desc));

    // Some sections keep the older column order within a newer file (e.g. the
    // 2027 distributor writer's tips section has SKU/UPC swapped relative to
    // the file's own header). If the SKU cell is a barcode and the UPC cell
    // looks like a part number, swap them.
    if (looksLikeUpc(sku) && upc && !looksLikeUpc(upc) && upc.toUpperCase() !== "N/A") {
      [sku, upc] = [upc, sku];
    }

    if (!sku) continue; // category headers, notes, spacer rows

    // Skip note rows that carry text in the SKU column in some layouts
    if (rowText.includes("FREE TIP") || rowText.includes("BUY 9") || rowText.includes("BUY 18")) continue;

    if (upc.toUpperCase() === "N/A") {
      if (!inTipsSection && !/replacement\s*tip/i.test(desc)) continue; // duplicates in the product area
      upc = ""; // tips legitimately have no UPC in the 2026 dealer writer
    }

    // Tips listed under the rod's own SKU would import as the rod -- derive a
    // -TIP SKU so they match tip products (or surface as unmatched) instead.
    if ((inTipsSection || /replacement\s*tip/i.test(desc)) && !/-TIP$/i.test(sku)) {
      sku = `${sku}-TIP`;
    }

    const qtyRaw = col(row, cols.qty);
    let qtyNum = 0;
    if (qtyRaw != null) {
      const qtyStr = String(qtyRaw).trim().replace(/[\s,]/g, "");
      if (qtyStr !== "" && qtyStr !== "-") qtyNum = parseInt(qtyStr) || 0;
    }

    products.push({
      sku,
      desc,
      upc,
      qty: qtyNum,
      status: cellStr(col(row, cols.status)),
      moq: parseFloat(col(row, cols.moq)) || 1,
      cost: parseFloat(col(row, cols.cost)) || 0,
      msrp: parseFloat(col(row, cols.msrp)) || 0,
      extCost: parseFloat(col(row, cols.extCost)) || 0,
    });
  }

  const orderedProducts = products.filter((p) => p.qty > 0);

  return {
    fileType,
    customerName,
    orderDate,
    buyerName,
    buyerEmail,
    poNumber,
    shipDate,
    shipToAddr,
    billToAddr,
    comments,
    distTotal,
    msrpTotal,
    products,
    orderedProducts,
  };
}

function todayLocalIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function detectAccFormat(sheetData) {
  if (!sheetData || sheetData.length < 8) return false;

  // Primary: program-type text anywhere in the header area (cell position has
  // moved between template versions).
  for (let i = 0; i < Math.min(15, sheetData.length); i++) {
    const row = sheetData[i];
    if (!row) continue;
    const text = row.map((c) => String(c == null ? "" : c)).join(" ").toUpperCase();
    if (text.includes("DEALER PROGRAM") || text.includes("DISTRIBUTOR PROGRAM") || text.includes("BUYING GROUP PROGRAM")) return true;
  }

  // Secondary: ACC structural markers -- the product table header (PRODUCT CODE
  // + DESCRIPTION + ORDER QUANTITY in any column order) plus a Customer Name:
  // or PO#: label.
  const hasProductHeader = !!findProductHeader(sheetData);
  if (!hasProductHeader) return false;
  for (let i = 0; i < Math.min(25, sheetData.length); i++) {
    const row = sheetData[i];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      const c = String(row[j] == null ? "" : row[j]).toUpperCase().trim();
      if (c.includes("CUSTOMER NAME") || c.includes("PO#") || c === "PO NUMBER") return true;
    }
  }
  return false;
}
