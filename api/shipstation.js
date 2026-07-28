// Single serverless function serving all /api/shipstation/* routes.
// Vercel's Hobby plan caps deployments at 12 functions, so the individual
// handlers live in /server/shipstation and are dispatched here by the
// [action] path segment. URLs are unchanged (e.g. /api/shipstation/create-order).
import createOrder from "../server/shipstation/create-order.js";
import inventoryLevels from "../server/shipstation/inventory-levels.js";
import inventoryPush from "../server/shipstation/inventory-push.js";
import inventoryWarehouses from "../server/shipstation/inventory-warehouses.js";
import syncShipments from "../server/shipstation/sync-shipments.js";
import testConnection from "../server/shipstation/test-connection.js";
import testConnectionV2 from "../server/shipstation/test-connection-v2.js";

const ROUTES = {
  "create-order": createOrder,
  "inventory-levels": inventoryLevels,
  "inventory-push": inventoryPush,
  "inventory-warehouses": inventoryWarehouses,
  "sync-shipments": syncShipments,
  "test-connection": testConnection,
  "test-connection-v2": testConnectionV2,
};

export default function handler(req, res) {
  const fn = ROUTES[req.query.action];
  if (!fn) return res.status(404).json({ error: "Not found" });
  return fn(req, res);
}
