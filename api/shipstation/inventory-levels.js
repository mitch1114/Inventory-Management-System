// GET /api/shipstation/inventory-levels?sku=SKU1,SKU2,...&warehouse_id=xxx
// Fetches inventory stock levels from ShipStation V2 Inventory API
//
// ShipStation V2 API: GET /v2/inventory
// Docs: https://docs.shipstation.com/openapi/inventory/getinventorylevels

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
    const skus = (req.query.skus || "").split(",").filter(Boolean);
    const warehouseId = req.query.warehouse_id || "";

    // If specific SKUs requested, fetch each individually (V2 API filters by single SKU)
    // Otherwise fetch all inventory grouped by warehouse
    const allInventory = [];

    if (skus.length > 0) {
      // Batch: fetch each SKU (max 50 to avoid rate limits)
      for (const sku of skus.slice(0, 50)) {
        const params = new URLSearchParams({ sku, group_by: "warehouse", page_size: "100" });
        if (warehouseId) params.set("inventory_warehouse_id", warehouseId);

        const response = await fetch(`${SS_V2_BASE}/v2/inventory?${params}`, {
          headers: { "api-key": apiKey },
        });

        if (!response.ok) continue;
        const data = await response.json();
        if (data.inventory) {
          allInventory.push(...data.inventory);
        }
      }
    } else {
      // Fetch all inventory
      const params = new URLSearchParams({ group_by: "warehouse", page_size: "500" });
      if (warehouseId) params.set("inventory_warehouse_id", warehouseId);

      const response = await fetch(`${SS_V2_BASE}/v2/inventory?${params}`, {
        headers: { "api-key": apiKey },
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({
          error: `ShipStation V2 API error: ${response.status}`,
          detail: errText,
        });
      }

      const data = await response.json();
      allInventory.push(...(data.inventory || []));
    }

    // Normalize response
    const inventory = allInventory.map((item) => ({
      sku: item.sku || "",
      onHand: item.on_hand != null ? item.on_hand : 0,
      available: item.available != null ? item.available : 0,
      warehouseId: item.inventory_warehouse_id || "",
      locationId: item.inventory_location_id || "",
      averageCost: item.average_cost ? item.average_cost.amount : null,
    }));

    return res.status(200).json({ success: true, inventory });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
