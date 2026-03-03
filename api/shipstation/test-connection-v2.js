// GET /api/shipstation/test-connection-v2
// Verifies ShipStation V2 API key is valid by listing inventory warehouses

const SS_V2_BASE = "https://api.shipstation.com";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.SHIPSTATION_V2_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      connected: false,
      error: "ShipStation V2 API key not configured. Add SHIPSTATION_V2_API_KEY to your Vercel environment variables.",
    });
  }

  try {
    const response = await fetch(`${SS_V2_BASE}/v2/inventory_warehouses?page_size=50`, {
      headers: { "api-key": apiKey },
    });

    if (!response.ok) {
      return res.status(200).json({
        connected: false,
        error: `Authentication failed (${response.status}). Check your V2 API key.`,
      });
    }

    const data = await response.json();
    const warehouses = (data.inventory_warehouses || []).map((w) => ({
      id: w.inventory_warehouse_id,
      name: w.name,
    }));

    return res.status(200).json({ connected: true, warehouses });
  } catch (err) {
    return res.status(200).json({
      connected: false,
      error: `Connection failed: ${err.message}`,
    });
  }
}
