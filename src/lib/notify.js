// --- Email notification helpers -------------------------------------------------
// Calls go through our Vercel API routes (/api/notify/*) which keep the
// Resend API key in server-side environment variables only. Fire-and-forget:
// these never throw, so a broken email setup can never block order workflow.

import { STAGE_LABEL } from "./constants";
import { uid, nowIso } from "./utils";

/**
 * Send a "your order has shipped" email for an order.
 * @param {Object} order - Sales order (expects customer, orderNum, lines, shipment)
 * @param {Array} customers - Customer list ({ name, email }) to resolve the address
 * @returns {{ sent: boolean, reason?: string }}
 */
export async function sendShippedEmail(order, customers) {
  try {
    const custName = (order.customer || "").trim().toLowerCase();
    const customer = (customers || []).find(
      (c) => (c.name || "").trim().toLowerCase() === custName,
    );
    const email = customer && customer.email;
    if (!email) return { sent: false, reason: "no-email" };

    const lines = order.lines || [];
    const units = lines.reduce(
      (s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty),
      0,
    );
    const itemsSummary = `${units} unit${units !== 1 ? "s" : ""} across ${lines.length} line${lines.length !== 1 ? "s" : ""}`;

    const shipment = order.shipment || {};
    const res = await fetch("/api/notify/shipped", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: email,
        customer: order.customer,
        orderNum: order.orderNum,
        carrier: shipment.carrier || "",
        trackingNum: shipment.trackingNum || "",
        shipDate: shipment.shipDate || "",
        itemsSummary,
      }),
    });
    return await res.json();
  } catch (_) {
    return { sent: false };
  }
}

/**
 * Notify teammates when an order reaches a fulfillment stage, based on the
 * configurable rules in Settings (data.notificationRules).
 * @param {Object} order - Sales order (expects orderNum, dealerPORef, customer, lines)
 * @param {string} stage - Stage just reached ("confirmed" | "picked" | "booked" | "shipped")
 * @param {Array} rules - Notification rules ({ id, name, email, stage })
 * @returns {{ sent?: boolean, skipped?: boolean, reason?: string }}
 */
export async function sendStageNotifications(order, stage, rules) {
  const matching = (rules || []).filter(
    (r) => r.stage === stage && r.email && String(r.email).includes("@"),
  );
  if (matching.length === 0) return { skipped: true };
  const recipients = matching.map((r) => r.email);
  try {
    const lines = order.lines || [];
    const units = lines.reduce(
      (s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty),
      0,
    );
    const value = lines.reduce(
      (s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty) * (l.price || 0),
      0,
    );

    const shipment = order.shipment || {};
    const note =
      stage === "shipped" && (shipment.carrier || shipment.trackingNum)
        ? `Shipped via ${shipment.carrier || "?"}${shipment.trackingNum ? ` -- ${shipment.trackingNum}` : ""}`
        : "";

    const res = await fetch("/api/notify/stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: recipients,
        orderNum: order.orderNum,
        poRef: order.dealerPORef || "",
        customer: order.customer || "",
        stageLabel: STAGE_LABEL[stage] || stage,
        units,
        value,
        note,
      }),
    });
    const result = await res.json();
    return { ...result, to: recipients };
  } catch (err) {
    return { sent: false, reason: "network", detail: err.message, to: recipients };
  }
}

/**
 * Send a test notification for a rule so email setup can be verified from
 * Settings without waiting for a real order. Returns the raw API result
 * ({ sent, reason?, detail? }) -- unlike the order flows, failures here are
 * meant to be shown to the user.
 * @param {Object} rule - Notification rule ({ email, stage })
 */
export async function sendTestStageEmail(rule) {
  try {
    const res = await fetch("/api/notify/stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: [rule.email],
        orderNum: "TEST-0000",
        poRef: "",
        customer: "Notification test",
        stageLabel: `${STAGE_LABEL[rule.stage] || rule.stage} (TEST)`,
        units: 1,
        value: 0,
        note: "This is a test sent from Settings -> Team Notifications.",
      }),
    });
    return await res.json();
  } catch (err) {
    return { sent: false, reason: "network", detail: err.message };
  }
}

/**
 * Build an audit-log entry describing the outcome of a stage-notification
 * attempt, so send failures are visible in the app (the API result is
 * otherwise fire-and-forget). Returns null when nothing was attempted
 * (no rules matched the stage), so callers can skip logging.
 * @param {string} orderNum - Order number the notification was for
 * @param {string} stage - Stage that triggered it
 * @param {Object} result - Result from sendStageNotifications
 */
export function notifyAuditEntry(orderNum, stage, result) {
  if (!result || result.skipped) return null;
  const to = (result.to || []).join(", ");
  const label = STAGE_LABEL[stage] || stage;
  return {
    id: uid(),
    ts: nowIso(),
    type: "notify",
    entity: orderNum,
    description: result.sent
      ? `Emailed "${label}" notification for ${orderNum} to ${to}`
      : `FAILED to email "${label}" notification for ${orderNum} to ${to}${result.reason ? ` -- ${result.reason}` : ""}${result.detail ? `: ${result.detail}` : ""}`,
  };
}
