// POST /api/qbo/invoices
// Fetches invoices from QuickBooks Online and returns them mapped to our
// sales order format. Requires accessToken and realmId in the request body.

const QBO_BASE = "https://quickbooks.api.intuit.com";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { accessToken, realmId, startDate, maxResults } = req.body || {};

  if (!accessToken || !realmId) {
    return res.status(400).json({ error: "Missing accessToken or realmId." });
  }

  // Validate startDate format to prevent query injection
  if (startDate && !DATE_RE.test(startDate)) {
    return res.status(400).json({ error: "Invalid startDate format. Use YYYY-MM-DD." });
  }

  const limit = Math.min(maxResults || 100, 1000);
  let query = `SELECT * FROM Invoice ORDERBY TxnDate DESC MAXRESULTS ${limit}`;
  if (startDate) {
    query = `SELECT * FROM Invoice WHERE TxnDate >= '${startDate}' ORDERBY TxnDate DESC MAXRESULTS ${limit}`;
  }

  const url = `${QBO_BASE}/v3/company/${encodeURIComponent(realmId)}/query?query=${encodeURIComponent(query)}&minorversion=73`;

  try {
    const qbRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!qbRes.ok) {
      console.error(`QBO query failed: ${qbRes.status}`);
      return res.status(qbRes.status).json({
        error: `Invoice fetch failed (${qbRes.status}). Check your QuickBooks connection.`,
      });
    }

    const body = await qbRes.json();
    const invoices = body?.QueryResponse?.Invoice || [];

    const salesOrders = invoices.map((inv) => mapInvoice(inv));

    return res.status(200).json({
      success: true,
      count: salesOrders.length,
      salesOrders,
    });
  } catch (err) {
    console.error("QBO invoice fetch error:", err.message);
    return res.status(500).json({ error: "Invoice fetch error. Please try again." });
  }
}

function mapInvoice(inv) {
  const lines = (inv.Line || [])
    .filter((l) => l.DetailType === "SalesItemLineDetail" && l.SalesItemLineDetail)
    .map((l) => {
      const detail = l.SalesItemLineDetail;
      return {
        productId: null,
        qboItemRef: detail.ItemRef ? detail.ItemRef.value : null,
        qboItemName: detail.ItemRef ? detail.ItemRef.name : "",
        qty: detail.Qty || 0,
        price: detail.UnitPrice || 0,
        amount: l.Amount || 0,
        qtyFilled: 0,
        qtyBackordered: 0,
      };
    });

  return {
    qboId: inv.Id,
    qboDocNumber: inv.DocNumber || "",
    customer: inv.CustomerRef ? inv.CustomerRef.name : "Unknown",
    qboCustomerRef: inv.CustomerRef ? inv.CustomerRef.value : null,
    date: inv.TxnDate || "",
    dueDate: inv.DueDate || "",
    totalAmount: inv.TotalAmt || 0,
    balance: inv.Balance || 0,
    status: mapQboStatus(inv),
    lines,
    email: inv.BillEmail ? inv.BillEmail.Address : "",
  };
}

function mapQboStatus(inv) {
  if (inv.Balance === 0 && inv.TotalAmt > 0) return "paid";
  if (inv.DueDate && new Date(inv.DueDate) < new Date()) return "overdue";
  return "open";
}
