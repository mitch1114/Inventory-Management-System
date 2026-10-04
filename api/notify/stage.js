// POST /api/notify/stage
// Sends an internal "order reached a stage" email to teammates via Resend,
// driven by the configurable notification rules in Settings. See
// server/notify/stage-email.js (also used by the scheduled cron).
import { sendStageEmail } from "../../server/notify/stage-email.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const result = await sendStageEmail(req.body || {});
  return res.status(200).json(result);
}
