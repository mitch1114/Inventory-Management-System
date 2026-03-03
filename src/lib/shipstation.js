// --- ShipStation client-side helpers ------------------------------------------
// All calls go through our Vercel API routes (/api/shipstation/*) which keep
// the ShipStation API key/secret in server-side environment variables only.

const API_BASE = "/api/shipstation";

/**
 * Test the ShipStation connection.
 * Returns { connected: bool, error?: string, stores?: [] }
 */
export async function testConnection() {
  try {
    const res = await fetch(`${API_BASE}/test-connection`);
    return await res.json();
  } catch (err) {
    return { connected: false, error: `Network error: ${err.message}` };
  }
}

/**
 * Push an order to ShipStation (called when advancing to "booked").
 * @param {Object} order - The sales order object from our data
 * @param {Array} products - Full products array for SKU lookup
 * @returns {{ success: bool, shipstationOrderId?: number, error?: string }}
 */
export async function pushOrder(order, products) {
  try {
    // Enrich lines with SKU + product name for ShipStation
    const prodMap = {};
    products.forEach((p) => { prodMap[p.id] = p; });

    const enrichedOrder = {
      ...order,
      lines: order.lines.map((l) => {
        const prod = prodMap[l.productId];
        return {
          ...l,
          sku: prod ? prod.sku : "",
          productName: prod ? prod.name : "",
        };
      }),
    };

    const res = await fetch(`${API_BASE}/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: enrichedOrder }),
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: `Network error: ${err.message}` };
  }
}

/**
 * Check ShipStation for shipment updates on a list of order numbers.
 * Returns shipped orders with carrier + tracking info.
 * @param {string[]} orderNumbers
 * @returns {{ success: bool, shipments?: Array }}
 */
export async function syncShipments(orderNumbers) {
  if (!orderNumbers || orderNumbers.length === 0) {
    return { success: true, shipments: [] };
  }
  try {
    const nums = orderNumbers.slice(0, 20).join(",");
    const res = await fetch(`${API_BASE}/sync-shipments?orderNumbers=${encodeURIComponent(nums)}`);
    return await res.json();
  } catch (err) {
    return { success: false, error: `Network error: ${err.message}` };
  }
}
