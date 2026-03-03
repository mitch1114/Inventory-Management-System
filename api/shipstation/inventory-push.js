// POST /api/shipstation/inventory-push
// Pushes inventory stock levels to ShipStation V2 Inventory API
//
// ShipStation V2 API: POST /v2/inventory
// Docs: https://docs.shipstation.com/manage-inventory-levels

const SS_V2_BASE = "https://api.shipstation.com";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.SHIPSTATION_V2_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ShipStation V2 API key not configured. Add SHIPSTATION_V2_API_KEY to your Vercel environment variables." });
  }

  try {
    const { items, warehouseId, locationId } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No inventory items provided" });
    }
    if (!locationId) {
      return res.status(400).json({ error: "inventory location ID (locationId) is required" });
    }

    const results = [];
    const errors = [];

    // Push each SKU's stock level (use "adjust" to set to exact quantity)
    for (const item of items.slice(0, 100)) {
      if (!item.sku) {
        errors.push({ sku: item.sku, error: "Missing SKU" });
        continue;
      }

      const body = {
        transaction_type: "adjust",
        inventory_location_id: locationId,
        sku: item.sku,
        quantity: item.onHand != null ? item.onHand : 0,
        reason: item.reason || "Synced from ACC Crappie Stix Inventory System",
      };

      const response = await fetch(`${SS_V2_BASE}/v2/inventory`, {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        results.push({ sku: item.sku, success: true });
      } else {
        const errText = await response.text();
        errors.push({ sku: item.sku, error: `${response.status}: ${errText}` });
      }
    }

    return res.status(200).json({
      success: errors.length === 0,
      updated: results.length,
      failed: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
