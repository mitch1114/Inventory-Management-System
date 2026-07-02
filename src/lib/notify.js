// --- Shipped-email notification helpers ----------------------------------------
// Calls go through our Vercel API route (/api/notify/shipped) which keeps the
// Resend API key in server-side environment variables only. Fire-and-forget:
// this never throws, so a broken email setup can never block shipping.

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
