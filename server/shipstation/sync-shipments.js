// GET /api/shipstation/sync-shipments?orderNumbers=SO-0001,SO-0002,...
// Checks ShipStation for shipped orders and returns tracking info
//
// ShipStation API: GET /shipments?orderNumber={num}
// Docs: https://www.shipstation.com/docs/api/shipments/list/

const SS_BASE = "https://ssapi.shipstation.com";

export default async function handler(req, res) {
  const _origin = req.headers.origin || ""; res.setHeader("Access-Control-Allow-Origin", _origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.SHIPSTATION_API_KEY;
  const apiSecret = process.env.SHIPSTATION_API_SECRET;
  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: "ShipStation API credentials not configured. Both SHIPSTATION_API_KEY and SHIPSTATION_API_SECRET are required." });
  }

  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
  const orderNumbers = (req.query.orderNumbers || "").split(",").filter(Boolean);

  if (orderNumbers.length === 0) {
    return res.status(400).json({ error: "No order numbers provided" });
  }

  try {
    const shipments = [];

    // Query ShipStation for each order (batch to avoid rate limits)
    for (const orderNum of orderNumbers.slice(0, 20)) {
      const url = `${SS_BASE}/shipments?orderNumber=${encodeURIComponent(orderNum)}&pageSize=50`;
      const response = await fetch(url, {
        headers: { Authorization: `Basic ${auth}` },
      });

      if (!response.ok) continue;
      const data = await response.json();

      // Orders often ship in multiple boxes -- aggregate every non-voided
      // shipment: sum label costs, join tracking numbers, use latest ship date.
      const active = (data.shipments || []).filter((s) => !s.voided);
      if (active.length > 0) {
        const latest = active.reduce((a, b) =>
          String(a.shipDate || "") >= String(b.shipDate || "") ? a : b,
        );
        const cost = active.reduce(
          (sum, s) => sum + (Number(s.shipmentCost) || 0) + (Number(s.insuranceCost) || 0),
          0,
        );
        const tracking = [...new Set(active.map((s) => s.trackingNumber).filter(Boolean))];
        shipments.push({
          orderNumber: orderNum,
          carrier: latest.carrierCode || latest.serviceCode || "",
          trackingNum: tracking.join(","),
          shipDate: latest.shipDate ? latest.shipDate.slice(0, 10) : "",
          delivered: latest.deliveryDate ? true : false,
          deliveryDate: latest.deliveryDate ? latest.deliveryDate.slice(0, 10) : "",
          shipstationShipmentId: latest.shipmentId,
          shippingCost: Math.round(cost * 100) / 100,
          shipmentCount: active.length,
        });
      }
    }

    return res.status(200).json({ success: true, shipments });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
