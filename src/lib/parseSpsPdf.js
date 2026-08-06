// --- SPS Commerce EDI purchase-order PDF parser --------------------------------
// Parses the "Order" PDF that SPS Commerce generates for trading partners
// (Scheels, MidwayUSA, ...). Input is positioned text extracted with pdf.js:
// an array of pages, each an array of { x, y, str } items.
//
// The layouts differ slightly per partner (Scheels puts our SKU in the SKU
// column; Midway puts THEIR item number there and ours under "Vendors
// (Sellers) Item Number"), but every line item carries a UPC/GTIN -- so the
// importer matches products by UPC first and only falls back to SKU text.

const DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;

const toIso = (m) =>
  m ? `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}` : "";

// Group positioned items into visual rows (y within tolerance), left-to-right.
export function itemsToRows(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 3);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y);
  rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));
  return rows.map((r) => ({
    y: r.y,
    items: r.items,
    text: r.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim(),
  }));
}

// Quick format sniff: is this an SPS Commerce order PDF?
export function detectSpsFormat(pages) {
  const text = pages.flat().map((i) => i.str).join(" ");
  return /Order\s*#\s*:/.test(text) && /Unit Price:/.test(text) && /Requested Ship Date:/.test(text);
}

const titleCaseIfShouty = (s) =>
  /[a-z]/.test(s)
    ? s
    : s
        .toLowerCase()
        .replace(/\b[a-z]/g, (c) => c.toUpperCase())
        .trim();

/**
 * Parse an SPS order. Returns null when the format doesn't match.
 * @param {Array<Array<{x:number,y:number,str:string}>>} pages
 */
export function parseSpsOrder(pages) {
  if (!detectSpsFormat(pages)) return null;
  const pageRows = pages.map((items) => itemsToRows(items));
  const allRows = pageRows.flat();
  const fullText = allRows.map((r) => r.text).join("\n");

  // --- Header fields -----------------------------------------------------------
  const poNumber = (fullText.match(/Order\s*#\s*:\s*([A-Za-z0-9][A-Za-z0-9-]*)/) || [])[1] || "";

  // Dates are label-anchored: the value sits on the label row or within the
  // next couple of visual rows.
  const dateNearLabel = (rows, labelRe, lookahead = 2) => {
    const idx = rows.findIndex((r) => labelRe.test(r.text));
    if (idx === -1) return [];
    const found = [];
    for (let i = idx; i <= Math.min(idx + lookahead, rows.length - 1); i++) {
      const matches = rows[i].text.matchAll(new RegExp(DATE_RE.source, "g"));
      for (const m of matches) found.push(toIso(m));
      if (found.length) break;
    }
    return found;
  };

  const firstPage = pageRows[0] || [];
  const poDates = dateNearLabel(firstPage, /PO Date:/);
  const shipDates = dateNearLabel(firstPage, /Requested Ship Date:/, 3);
  const orderDate = poDates[0] || "";
  const requestedShipDate = shipDates[0] || "";
  const cancelDate = shipDates[1] || "";

  const poType = (fullText.match(/PO Type\s*:\s*([^\n]+?)(?:\s+Original)?\s*$/m) || [])[1] || "";
  // Reject captures that ran into neighboring labels (empty buyer field)
  let buyerName = (fullText.match(/Buyer Name(?:\/| or )?Dep(?:t|artment)?\s*:?\s*([A-Za-z][^\n]*)/) || [])[1] || "";
  if (buyerName.includes(":")) buyerName = "";
  // Buyer email: any address that isn't ours (the vendor block lists ours too)
  const buyerEmail =
    [...fullText.matchAll(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)
      ].map((m) => m[1]).find((e) => !/acccrappiestix/i.test(e)) || "";

  // --- Ship To block -----------------------------------------------------------
  // Column-aware: keep only items left of the Bill To column, from the
  // "Ship To:" row down to "Freight Terms".
  let customer = "";
  const shipToLines = [];
  {
    const rows = firstPage;
    const startIdx = rows.findIndex((r) => /Ship To\s*:/.test(r.text));
    const endIdx = rows.findIndex((r, i) => i > startIdx && /Freight Terms/.test(r.text));
    if (startIdx !== -1) {
      // x cutoff = start of the Bill To / vendor column
      let xcut = Infinity;
      for (const r of rows.slice(startIdx, endIdx === -1 ? startIdx + 2 : endIdx)) {
        for (const it of r.items) {
          if (/Bill To/.test(it.str)) xcut = Math.min(xcut, it.x);
        }
      }
      for (let i = startIdx + 1; i < (endIdx === -1 ? rows.length : endIdx); i++) {
        const txt = rows[i].items
          .filter((it) => it.x < xcut - 4)
          .map((it) => it.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (!txt) continue;
        if (/^(Location ID|Phone|Fax|E-?mail|Contact)/i.test(txt)) continue;
        shipToLines.push(txt);
      }
      if (shipToLines.length > 0) customer = titleCaseIfShouty(shipToLines[0]);
    }
  }
  const shipToAddr = shipToLines.slice(1).join(" | ");

  // --- Line items ----------------------------------------------------------------
  // Anchor on: <line#> ... <UPC 12-14 digits> ... Unit Price: <price> <qty> Each <total>
  const ITEM_RE =
    /^(\d{1,3})\s+(.*?)\b(\d{12,14})\b\s+(.*?)Unit Price:\s*([\d,]+\.\d{2})\s+([\d,]+(?:\.\d+)?)\s+Each\s+([\d,]+\.\d{2})/;
  const money = (s) => parseFloat(String(s).replace(/,/g, "")) || 0;
  // SKU-shaped: dashed codes (SPS-51S-MF-C) or dashless letter+digit codes of
  // 6+ chars (DF4CLR300). All-digit tokens (UPCs, buyer item numbers) excluded.
  const SKU_TOKEN = /^(?:[A-Z0-9][A-Z0-9']*(?:-[A-Z0-9']+)+-?|(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{6,})$/;

  const lines = [];
  for (const rows of pageRows) {
    for (let i = 0; i < rows.length; i++) {
      const m = rows[i].text.match(ITEM_RE);
      if (!m) continue;
      const [, lineNo, pre, upc, mid, priceS, qtyS, totalS] = m;

      // SKU: first SKU-shaped token before the UPC (Scheels); if it wraps
      // ("SPS-661S-ML-" + "SPG" on the next row) stitch the fragments. Midway
      // instead puts our SKU on lone-token rows below ("JS-112-M-MS-" "SPG").
      const preTokens = pre.trim().split(/\s+/);
      let sku = preTokens.find((t) => SKU_TOKEN.test(t)) || "";
      const buyerSku = !sku && /^\d+$/.test(preTokens[0] || "") ? preTokens[0] : "";
      if (sku && sku.endsWith("-") && i + 1 < rows.length) {
        // Scheels wraps long SKUs: the tail ("SPG", "C"...) starts the next
        // visual row, ahead of the wrapped description text.
        const nextTok = rows[i + 1].text.trim().split(/\s+/)[0] || "";
        if (/^[A-Z0-9'][A-Z0-9'-]{0,11}$/.test(nextTok)) sku += nextTok;
      }
      if (!sku) {
        // Midway puts our SKU on lone-token rows below the item row
        // ("JS-112-M-MS-" then "SPG") -- stitch consecutive fragments.
        const frags = [];
        for (let j = i + 1; j < Math.min(i + 5, rows.length); j++) {
          if (ITEM_RE.test(rows[j].text)) break;
          const t = rows[j].text.trim();
          if (SKU_TOKEN.test(t) || /^[A-Z0-9]{2,6}$/.test(t)) frags.push(t);
        }
        let stitched = "";
        for (const f of frags) {
          stitched += f;
          if (!stitched.endsWith("-")) break;
        }
        if (stitched.includes("-")) sku = stitched;
      }

      const desc = mid
        .replace(/Product(?:\s*Description)?\s*:\s*/i, "")
        .replace(/\s+/g, " ")
        .trim();

      lines.push({
        lineNo: Number(lineNo),
        sku,
        buyerSku,
        upc,
        desc,
        qty: Math.round(money(qtyS)),
        price: money(priceS),
        total: money(totalS),
      });
    }
  }

  const statedTotal = money((fullText.match(/Purchase Order Total\s*:\s*([\d,]+\.\d{2})/) || [])[1] || "0");

  return {
    format: "sps",
    poNumber,
    orderDate,
    requestedShipDate,
    cancelDate,
    poType: poType.trim(),
    customer,
    shipToAddr,
    buyerName: buyerName.trim(),
    buyerEmail,
    lines,
    statedTotal,
  };
}
