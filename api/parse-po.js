// POST /api/parse-po
// Extracts supplier PO data (supplier, PI/PO number, line items) from an
// uploaded proforma invoice / purchase order PDF using Claude AI.
// Requires ANTHROPIC_API_KEY environment variable.

const MAX_BASE64_LENGTH = 7 * 1024 * 1024; // ~7MB of base64 (~5MB PDF)

const EXTRACTION_PROMPT = `Extract the purchase order data from this supplier proforma invoice / purchase order.

Return ONLY minified JSON -- no markdown fences, no commentary -- with exactly this shape:
{"supplier":string,"poRef":string,"date":"yyyy-mm-dd" or "","currency":string,"lines":[{"sku":string,"description":string,"qty":number,"unitCost":number}],"totalUnits":number,"totalCost":number}

Rules:
- "supplier" is the company issuing the document (the seller/factory), not the buyer.
- "poRef" is the PI / PO / invoice / sales confirmation number (e.g. the value of a "PI No." field).
- "date" is the document date converted to yyyy-mm-dd; use "" if no date is found.
- "currency" is the currency code used (e.g. "USD").
- "lines" contains only product line items. Skip subtotal, total, shipping, discount, deposit, and blank rows.
- "sku" is the item/part number exactly as printed. When both a buyer item code (e.g. a "Cust_Item" column) and a factory/internal code exist, use the buyer's item code.
- "qty" and "unitCost" are plain numbers -- no currency symbols, units, or thousands separators.
- "totalUnits" is the sum of all line qty values; "totalCost" is the document total amount.`;

export default async function handler(req, res) {
  const _origin = req.headers.origin || ""; res.setHeader("Access-Control-Allow-Origin", _origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { pdfBase64, filename } = req.body || {};
  if (!pdfBase64 || typeof pdfBase64 !== "string") {
    return res.status(400).json({
      success: false,
      reason: "parse-failed",
      error: "Missing pdfBase64 in request body.",
    });
  }
  if (pdfBase64.length > MAX_BASE64_LENGTH) {
    return res.status(413).json({
      success: false,
      reason: "too-large",
      error: "PDF is too large. Please upload a file under ~5MB.",
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ success: false, reason: "not-configured" });
  }

  // Defensive cleanup: strip a data: URL prefix and whitespace/newlines if present.
  const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, "").replace(/\s/g, "");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: cleanBase64,
                },
              },
              { type: "text", text: EXTRACTION_PROMPT },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`parse-po: Claude API error (${response.status}) for ${filename || "PDF"}: ${errBody}`);
      return res.status(200).json({ success: false, reason: "parse-failed" });
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b && b.type === "text" && b.text);
    let text = textBlock ? textBlock.text.trim() : "";

    // Strip ```json fences if the model wrapped its output anyway.
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) text = fenced[1].trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      console.error(`parse-po: failed to parse Claude JSON for ${filename || "PDF"}: ${err.message}`);
      return res.status(200).json({ success: false, reason: "parse-failed" });
    }

    if (!parsed || !Array.isArray(parsed.lines)) {
      console.error(`parse-po: unexpected JSON shape for ${filename || "PDF"}`);
      return res.status(200).json({ success: false, reason: "parse-failed" });
    }

    return res.status(200).json({ success: true, parsed });
  } catch (err) {
    console.error(`parse-po: request failed for ${filename || "PDF"}: ${err.message}`);
    return res.status(200).json({ success: false, reason: "parse-failed" });
  }
}
