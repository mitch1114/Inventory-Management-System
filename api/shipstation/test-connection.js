// GET /api/shipstation/test-connection
// Verifies ShipStation API credentials are valid

const SS_BASE = "https://ssapi.shipstation.com";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.SHIPSTATION_API_KEY;
  const apiSecret = process.env.SHIPSTATION_API_SECRET;
  if (!apiKey) {
    return res.status(200).json({
      connected: false,
      error: "ShipStation API key not configured. Add SHIPSTATION_API_KEY to your Vercel environment variables.",
    });
  }
  if (!apiSecret) {
    return res.status(200).json({
      connected: false,
      error: "ShipStation API Secret is also required. Add SHIPSTATION_API_SECRET to your Vercel environment variables. Find both at ShipStation > Account > Settings > API Settings.",
    });
  }

  // ShipStation Basic Auth always requires key:secret
  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

  try {
    // Simple request to verify credentials -- list stores
    const response = await fetch(`${SS_BASE}/stores`, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!response.ok) {
      return res.status(200).json({
        connected: false,
        error: `Authentication failed (${response.status}). Check your API key and secret.`,
      });
    }

    const data = await response.json();
    return res.status(200).json({
      connected: true,
      stores: (data || []).map((s) => ({ name: s.storeName, id: s.storeId })),
    });
  } catch (err) {
    return res.status(200).json({
      connected: false,
      error: `Connection failed: ${err.message}`,
    });
  }
}
