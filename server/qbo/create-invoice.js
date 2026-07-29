// POST /api/qbo/create-invoice
// Creates a draft invoice in QuickBooks Online for a picked order. Looks up
// the customer by DisplayName (creating one if missing), maps each line's SKU
// to a QBO Item by Name, and creates the invoice. SKUs with no matching QBO
// item are skipped and reported back in skippedSkus rather than failing the
// whole invoice. Requires accessToken and realmId in the request body.

const QBO_BASE = "https://quickbooks.api.intuit.com";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Escape single quotes for QBO query strings (doubled per the QBO query spec)
const escQ = (s) => String(s).replace(/'/g, "''");

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { accessToken, realmId, customerName, orderNum, date, lines } = req.body || {};

  if (!accessToken || !realmId) {
    return res.status(400).json({ error: "Missing accessToken or realmId." });
  }
  if (!customerName || !orderNum || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: "Missing customerName, orderNum, or lines." });
  }
  // Validate date format to prevent malformed TxnDate values
  if (date && !DATE_RE.test(date)) {
    return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
  }

  const base = `${QBO_BASE}/v3/company/${encodeURIComponent(realmId)}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const query = async (q) => {
    const r = await fetch(`${base}/query?query=${encodeURIComponent(q)}&minorversion=73`, { headers });
    if (!r.ok) throw new Error(`QBO query failed (${r.status}): ${q}`);
    return r.json();
  };

  try {
    // 1. Find the customer by display name, creating one if it doesn't exist
    const custBody = await query(`SELECT * FROM Customer WHERE DisplayName = '${escQ(customerName)}'`);
    let customer = custBody?.QueryResponse?.Customer?.[0];
    if (!customer) {
      const createRes = await fetch(`${base}/customer?minorversion=73`, {
        method: "POST",
        headers,
        body: JSON.stringify({ DisplayName: customerName }),
      });
      if (!createRes.ok) throw new Error(`QBO customer create failed (${createRes.status})`);
      const createBody = await createRes.json();
      customer = createBody?.Customer;
    }
    if (!customer || !customer.Id) throw new Error("QBO customer lookup returned no Id");

    // 2. Map each line's SKU to a QBO Item -- unmatched SKUs are skipped
    const invoiceLines = [];
    const skippedSkus = [];
    for (const l of lines) {
      const itemBody = await query(`SELECT * FROM Item WHERE Name = '${escQ(l.sku || "")}'`);
      const item = itemBody?.QueryResponse?.Item?.[0];
      if (!item) {
        skippedSkus.push(l.sku);
        continue;
      }
      const qty = l.qty || 0;
      const rate = l.rate || 0;
      invoiceLines.push({
        DetailType: "SalesItemLineDetail",
        Amount: qty * rate,
        SalesItemLineDetail: {
          ItemRef: { value: item.Id },
          Qty: qty,
          UnitPrice: rate,
        },
      });
    }

    if (invoiceLines.length === 0) {
      return res.status(200).json({ success: false, reason: "no-items", skippedSkus });
    }

    // 3. Create the invoice (left unsent in QBO -- review before emailing)
    const invRes = await fetch(`${base}/invoice?minorversion=73`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        CustomerRef: { value: customer.Id },
        TxnDate: date,
        DocNumber: orderNum,
        PrivateNote: `Auto-created from ${orderNum} at Picked & Packed`,
        Line: invoiceLines,
      }),
    });
    if (!invRes.ok) {
      const errText = await invRes.text().catch(() => "");
      throw new Error(`QBO invoice create failed (${invRes.status}): ${errText}`);
    }
    const invBody = await invRes.json();
    const inv = invBody?.Invoice;
    if (!inv || !inv.Id) throw new Error("QBO invoice create returned no Invoice");

    return res.status(200).json({
      success: true,
      invoice: {
        qboId: inv.Id,
        docNumber: inv.DocNumber,
        totalAmount: inv.TotalAmt,
        balance: inv.Balance,
        date: inv.TxnDate,
      },
      skippedSkus,
    });
  } catch (err) {
    console.error("QBO create-invoice error:", err.message);
    return res.status(200).json({ success: false, reason: "qbo-error" });
  }
}
