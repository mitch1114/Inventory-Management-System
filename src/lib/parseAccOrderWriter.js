// --- DEALER PO IMPORT ---------------------------------------------------------
// Natively parses ACC Crappie Stix order writer format (dealer + distributor)
//
// Confirmed layout from real submitted POs (0-indexed rows):
//   Row 7  (Excel 8):  A="Customer Name:"  B=value
//   Row 8  (Excel 9):  A="Order Date:"     B=value  (comes as JS Date object from XLSX)
//   Row 9  (Excel 10): A="Buyer Name:"     B=value
//   Row 10 (Excel 11): A="Buyer Email:"    B=value
//   Row 11 (Excel 12): A="PO#:"            B=value
//   Row 12 (Excel 13): A=pricing text      E="Ship Date:"  F=value
//   Row 14 (Excel 15): A=Ship To address   (customer fills this in)
//   Row 18 (Excel 19): A=Bill To address   (customer fills this in)
//   Row 17 (Excel 18): A="BILL TO ADDRESS" label
//   Row 21 (Excel 22): Column headers -- PRODUCT CODE, DESCRIPTION, UPC#,
//                      ORDER QUANTITY, STATUS, MOQ, [DEALER/DIST] COST, MSRP,
//                      [DEALER/DIST]. EXT, MSRP EXT
//   Row 22+ (Excel 23+): Product rows. Category headers have no SKU.
//                         Replacement tips section starts after "REPLACEMENT TIP PRICING"
//
// Col G label varies: "DEALER COST", "DISTRIBUTOR COST", or "DIST COST" -- all the same field

export function parseAccOrderWriter(sheetData) {
  const HEADER_ROW = 21; // 0-indexed = Excel row 22
  const header = sheetData[HEADER_ROW];
  if (!header) return null;

  // Detect dealer vs distributor from E8 (0-indexed: row 6, col 4)
  const programCell = String((sheetData[6] && sheetData[6][4]) || "").toUpperCase();
  const isDistributor = programCell.includes("DISTRIBUTOR");
  const fileType = isDistributor ? "distributor" : "dealer";

  // Helper: get cell value as clean string, handles Date objects from XLSX
  const cell = (rowIdx, colIdx) => {
    const row = sheetData[rowIdx];
    if (!row) return "";
    const v = row[colIdx];
    if (v == null) return "";
    // XLSX parses Excel date cells as JS Date objects
    if (v instanceof Date) {
      return v.toISOString().slice(0, 10); // "2026-02-24"
    }
    return String(v).trim();
  };

  // All header values are in column B (index 1)
  const customerName = cell(7, 1); // B8
  const orderDateRaw = cell(8, 1); // B9 -- may be ISO string from Date object
  const buyerName = cell(9, 1); // B10
  const buyerEmail = cell(10, 1); // B11
  const poNumber = cell(11, 1); // B12
  const shipDateRaw = cell(12, 5); // F13 (col F, after "Ship Date:" label in E)
  const shipToAddr = cell(14, 0); // A15 -- customer fills in ship-to
  const billToAddr = cell(18, 0); // A19 -- customer fills in bill-to
  const comments = cell(9, 4); // E10 label is "Comments", value below or to right
  const distTotal = parseFloat(sheetData[18] && sheetData[18][7]) || 0; // H19
  const msrpTotal = parseFloat(sheetData[19] && sheetData[19][7]) || 0; // H20

  // Normalize order date -- could be "2026-02-24" ISO string or raw date string
  const parseDate = (raw) => {
    if (!raw) return new Date().toISOString().slice(0, 10);
    // Already ISO format from our cell() helper handling Date objects
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    // Try parsing as date string
    try {
      const d = new Date(raw);
      if (!isNaN(d)) return d.toISOString().slice(0, 10);
    } catch (_e) {
      /* ignore */
    }
    return new Date().toISOString().slice(0, 10);
  };
  const orderDate = parseDate(orderDateRaw);
  const shipDate = parseDate(shipDateRaw);

  // Parse product rows -- stop when we hit the Replacement Tips section
  const products = [];
  let inReplacementSection = false;

  for (let i = HEADER_ROW + 1; i < sheetData.length; i++) {
    const row = sheetData[i];
    if (!row || row.every((c) => c == null || c === "" || c === 0)) continue;

    const sku = row[0];
    const desc = row[1];
    const upc = row[2];
    const qty = row[3];
    const status = row[4];
    const moq = row[5];
    const cost = row[6];
    const msrp = row[7];
    const extCost = row[8];

    // Detect replacement tip pricing section -- stop importing regular products
    if (
      !sku &&
      desc &&
      String(desc).toUpperCase().includes("REPLACEMENT TIP PRICING")
    ) {
      inReplacementSection = true;
      continue;
    }
    if (inReplacementSection) continue;

    // Skip free tip program notes
    if (
      !sku &&
      desc &&
      (String(desc).toUpperCase().includes("FREE TIP") ||
        String(desc).toUpperCase().includes("BUY 9") ||
        String(desc).toUpperCase().includes("BUY 18"))
    )
      continue;

    // Category header rows: no SKU, has description, no UPC
    if (!sku && desc && !upc) continue;

    // Must have a SKU
    if (!sku) continue;

    // Skip rows with N/A UPC (replacement tip duplicates mixed in product area)
    if (String(upc || "").toUpperCase() === "N/A") continue;

    // Parse quantity
    let qtyNum = 0;
    if (qty != null) {
      const qtyStr = String(qty).trim().replace(/\s/g, "");
      if (qtyStr !== "" && qtyStr !== "-" && qtyStr !== "0") {
        qtyNum = parseInt(qtyStr) || 0;
      }
    }

    products.push({
      sku: String(sku).trim(),
      desc: String(desc || "").trim(),
      upc: String(upc || "")
        .replace(/\.0$/, "")
        .trim(),
      qty: qtyNum,
      status: String(status || "").trim(),
      moq: parseFloat(moq) || 1,
      cost: parseFloat(cost) || 0,
      msrp: parseFloat(msrp) || 0,
      extCost: parseFloat(extCost) || 0,
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

export function detectAccFormat(sheetData) {
  if (!sheetData || sheetData.length < 8) return false;
  const row7 = sheetData[6]; // row 8 (0-indexed row 7)
  if (!row7) return false;
  const e8 = String(row7[4] || "").toUpperCase();
  return e8.includes("DEALER PROGRAM") || e8.includes("DISTRIBUTOR PROGRAM");
}
