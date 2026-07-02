// POST /api/shipstation/create-order
// Pushes or updates an order in ShipStation when it reaches "booked"
//
// ShipStation API: POST /orders/createorder
// Docs: https://www.shipstation.com/docs/api/orders/create-update-order/

const SS_BASE = "https://ssapi.shipstation.com";

export default async function handler(req, res) {
  const _origin = req.headers.origin || ""; res.setHeader("Access-Control-Allow-Origin", _origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.SHIPSTATION_API_KEY;
  const apiSecret = process.env.SHIPSTATION_API_SECRET;
  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: "ShipStation API credentials not configured. Both SHIPSTATION_API_KEY and SHIPSTATION_API_SECRET are required." });
  }

  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

  try {
    const { order } = req.body;
    if (!order || !order.orderNum) {
      return res.status(400).json({ error: "Missing order data" });
    }

    // Build ShipStation order payload
    const ssOrder = {
      orderNumber: order.orderNum,
      orderDate: order.date || new Date().toISOString().slice(0, 10),
      orderStatus: "awaiting_shipment",
      customerUsername: order.customer || "Unknown",
      billTo: {
        name: order.customer || "Unknown",
        street1: order.address || "",
        city: "",
        state: "",
        postalCode: "",
        country: "US",
      },
      shipTo: {
        name: order.shipTo || order.customer || "Unknown",
        street1: order.shipToAddr || order.address || "",
        city: "",
        state: "",
        postalCode: "",
        country: "US",
      },
      items: (order.lines || []).map((l) => ({
        sku: l.sku || "",
        name: l.productName || l.sku || "",
        quantity: l.qtyFilled != null ? l.qtyFilled : l.qty,
        unitPrice: l.price || 0,
      })),
      customerNotes: order.notes || "",
      internalNotes: `PO Ref: ${order.dealerPORef || "N/A"} | Type: ${order.type || "dealer"}`,
    };

    const response = await fetch(`${SS_BASE}/orders/createorder`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ssOrder),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `ShipStation API error: ${response.status}`,
        detail: errText,
      });
    }

    const result = await response.json();
    return res.status(200).json({
      success: true,
      shipstationOrderId: result.orderId,
      orderNumber: result.orderNumber,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
