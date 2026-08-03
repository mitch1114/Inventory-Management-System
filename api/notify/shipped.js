// POST /api/notify/shipped
// Sends a "your order has shipped" email to the customer via Resend.
// Requires RESEND_API_KEY and NOTIFY_FROM_EMAIL environment variables; when
// either is missing this is a silent no-op ({ sent: false, reason: "not-configured" })
// so shipping never breaks because email isn't set up.

const RESEND_URL = "https://api.resend.com/emails";

// HTML-escape a value before interpolating it into the email body.
function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Public tracking link for the big three carriers; null for anything else.
function trackingUrl(carrier, trackingNum) {
  if (!trackingNum) return null;
  const c = String(carrier || "").toLowerCase();
  const num = encodeURIComponent(String(trackingNum));
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${num}`;
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${num}`;
  if (c.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${num}`;
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.NOTIFY_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    return res.status(200).json({ sent: false, reason: "not-configured" });
  }

  const { to, customer, orderNum, carrier, trackingNum, shipDate, itemsSummary } = req.body || {};
  if (!to || !orderNum) {
    return res.status(200).json({ sent: false, reason: "missing-fields" });
  }

  const url = trackingUrl(carrier, trackingNum);
  const trackingLine = trackingNum
    ? `<p style="margin:0 0 6px;"><strong>Tracking:</strong> ${esc(carrier)} ${esc(trackingNum)}</p>` +
      (url
        ? `<p style="margin:0 0 6px;"><a href="${esc(url)}" style="color:#6D28D9;">Track your package</a></p>`
        : "")
    : carrier
      ? `<p style="margin:0 0 6px;"><strong>Carrier:</strong> ${esc(carrier)}</p>`
      : "";

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0F172A;">
    <div style="background:linear-gradient(135deg,#6D28D9,#4F46E5);border-radius:10px 10px 0 0;padding:18px 24px;">
      <h1 style="margin:0;font-size:18px;color:#FFFFFF;">ACC Crappie Stix</h1>
    </div>
    <div style="border:1px solid #E2E8F0;border-top:none;border-radius:0 0 10px 10px;padding:24px;">
      <p style="margin:0 0 12px;">Hi ${esc(customer || "there")},</p>
      <p style="margin:0 0 16px;">
        Good news -- your order <strong>${esc(orderNum)}</strong> has shipped!
      </p>
      ${trackingLine}
      ${shipDate ? `<p style="margin:0 0 6px;"><strong>Ship date:</strong> ${esc(shipDate)}</p>` : ""}
      ${itemsSummary ? `<p style="margin:0 0 6px;"><strong>Items:</strong> ${esc(itemsSummary)}</p>` : ""}
      <p style="margin:16px 0 0;">
        Thanks for fishing with us!<br />
        -- The ACC Crappie Stix Team
      </p>
    </div>
  </div>`;

  try {
    const sendRes = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject: `Your ACC Crappie Stix order ${orderNum} has shipped`,
        html,
      }),
    });

    if (!sendRes.ok) {
      // Surface Resend's actual error (e.g. "domain is not verified") so the
      // client can show WHY the send failed instead of a generic status code.
      let detail = "";
      try {
        const body = await sendRes.json();
        detail = (body && (body.message || body.error || body.name)) || JSON.stringify(body);
      } catch (_) {
        /* non-JSON error body */
      }
      console.error(`Resend send failed for ${orderNum}: HTTP ${sendRes.status} -- ${detail}`);
      return res.status(200).json({ sent: false, reason: `resend-http-${sendRes.status}`, detail });
    }

    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error(`Resend send failed for ${orderNum}:`, err.message);
    return res.status(200).json({ sent: false, reason: "send-failed", detail: err.message });
  }
}
