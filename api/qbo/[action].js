// Single serverless function serving all /api/qbo/* routes.
// Vercel's Hobby plan caps deployments at 12 functions, so the individual
// handlers live in /server/qbo and are dispatched here by the [action] path
// segment. URLs are unchanged (e.g. /api/qbo/auth, /api/qbo/callback).
import auth from "../../server/qbo/auth.js";
import callback from "../../server/qbo/callback.js";
import refresh from "../../server/qbo/refresh.js";
import invoices from "../../server/qbo/invoices.js";

const ROUTES = {
  auth,
  callback,
  refresh,
  invoices,
};

export default function handler(req, res) {
  const fn = ROUTES[req.query.action];
  if (!fn) return res.status(404).json({ error: "Not found" });
  return fn(req, res);
}
