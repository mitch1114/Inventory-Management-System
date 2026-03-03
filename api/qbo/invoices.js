// POST /api/qbo/invoices
// Fetches invoices from QuickBooks Online and returns them mapped to our
// sales order format. Requires accessToken and realmId in the request body.

const QBO_BASE = "https://quickbooks.api.intuit.com";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { accessToken, realmId, startDate, maxResults } = req.body || {};

  if (!accessToken || !realmId) {
    return res.status(400).json({ error: "Missing accessToken or realmId." });
  }

  // Build query -- fetch recent invoices, optionally from a start date
  const limit = Math.min(maxResults || 100, 1000);
  let query = `SELECT * FROM Invoice ORDERBY TxnDate DESC MAXRESULTS ${limit}`;
  if (startDate) {
    query = `SELECT * FROM Invoice WHERE TxnDate >= '${startDate}' ORDERBY TxnDate DESC MAXRESULTS ${limit}`;
  }

  const url = `${QBO_BASE}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=73`;

  try {
    const qbRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!qbRes.ok) {
      const errBody = await qbRes.text();
      return res.status(qbRes.status).json({
        error: `QBO query failed (${qbRes.status}): ${errBody}`,
      });
    }

    const body = await qbRes.json();
    const invoices = body?.QueryResponse?.Invoice || [];

    // Map QBO invoices to our sales order format
    const salesOrders = invoices.map((inv) => mapInvoice(inv));

    return res.status(200).json({
      success: true,
      count: salesOrders.length,
      salesOrders,
    });
  } catch (err) {
    return res.status(500).json({ error: `Invoice fetch error: ${err.message}` });
  }
}

// Map a QBO Invoice object to our sales order shape
function mapInvoice(inv) {
  const lines = (inv.Line || [])
    .filter((l) => l.DetailType === "SalesItemLineDetail" && l.SalesItemLineDetail)
    .map((l) => {
      const detail = l.SalesItemLineDetail;
      return {
        productId: null, // Will be matched client-side by name/SKU
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
