// GET /api/shipstation/inventory-warehouses
// Lists inventory warehouses and their locations from ShipStation V2
//
// ShipStation V2 API: GET /v2/inventory_warehouses, GET /v2/inventory_locations
// Docs: https://docs.shipstation.com/openapi/inventory

const SS_V2_BASE = "https://api.shipstation.com";

export default async function handler(req, res) {
  const _origin = req.headers.origin || ""; res.setHeader("Access-Control-Allow-Origin", _origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.SHIPSTATION_V2_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ShipStation V2 API key not configured. Add SHIPSTATION_V2_API_KEY to your Vercel environment variables." });
  }

  try {
    // Fetch warehouses
    const whRes = await fetch(`${SS_V2_BASE}/v2/inventory_warehouses?page_size=100`, {
      headers: { "api-key": apiKey },
    });

    if (!whRes.ok) {
      const errText = await whRes.text();
      return res.status(whRes.status).json({
        error: `ShipStation V2 API error: ${whRes.status}`,
        detail: errText,
      });
    }

    const whData = await whRes.json();
    const warehouses = (whData.inventory_warehouses || []).map((w) => ({
      id: w.inventory_warehouse_id,
      name: w.name,
    }));

    // Fetch locations for each warehouse
    const warehousesWithLocations = [];
    for (const wh of warehouses) {
      const locRes = await fetch(
        `${SS_V2_BASE}/v2/inventory_locations?inventory_warehouse_id=${encodeURIComponent(wh.id)}&page_size=100`,
        { headers: { "api-key": apiKey } },
      );

      let locations = [];
      if (locRes.ok) {
        const locData = await locRes.json();
        locations = (locData.inventory_locations || []).map((l) => ({
          id: l.inventory_location_id,
          name: l.name,
        }));
      }

      warehousesWithLocations.push({ ...wh, locations });
    }

    return res.status(200).json({ success: true, warehouses: warehousesWithLocations });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
