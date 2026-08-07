// POST /api/notify/stage
// Sends an internal "order reached a stage" email to teammates via Resend,
// driven by the configurable notification rules in Settings.
// Requires RESEND_API_KEY and NOTIFY_FROM_EMAIL environment variables; when
// either is missing this is a silent no-op ({ sent: false, reason: "not-configured" })
// so order workflow never breaks because email isn't set up.

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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.NOTIFY_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    return res.status(200).json({ sent: false, reason: "not-configured" });
  }

  const { to, orderNum, poRef, customer, stageLabel, units, value, note } = req.body || {};
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (recipients.length === 0 || !orderNum) {
    return res.status(200).json({ sent: false, reason: "missing-fields" });
  }

  const valueLine =
    units != null || value != null
      ? `<p style="margin:0 0 6px;"><strong>Order size:</strong> ${esc(units != null ? units : "?")} unit${units === 1 ? "" : "s"}${value != null ? ` &middot; $${esc(Number(value).toFixed(2))}` : ""}</p>`
      : "";

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0F172A;">
    <div style="background:linear-gradient(135deg,#6D28D9,#4F46E5);border-radius:10px 10px 0 0;padding:18px 24px;">
      <h1 style="margin:0;font-size:18px;color:#FFFFFF;">ACC Crappie Stix</h1>
    </div>
    <div style="border:1px solid #E2E8F0;border-top:none;border-radius:0 0 10px 10px;padding:24px;">
      <h2 style="margin:0 0 16px;font-size:16px;">Order reached: ${esc(stageLabel)}</h2>
      <p style="margin:0 0 6px;"><strong>Order:</strong> ${esc(orderNum)}</p>
      ${poRef ? `<p style="margin:0 0 6px;"><strong>PO Ref:</strong> ${esc(poRef)}</p>` : ""}
      <p style="margin:0 0 6px;"><strong>Customer:</strong> ${esc(customer || "--")}</p>
      ${valueLine}
      ${note ? `<p style="margin:0 0 6px;"><strong>Note:</strong> ${esc(note)}</p>` : ""}
      <p style="margin:20px 0 0;">
        <a href="https://ops.acccrappiestix.com" style="display:inline-block;background:#6D28D9;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:14px;padding:11px 26px;border-radius:8px;">Open in ACC Ops</a>
      </p>
      <p style="margin:14px 0 0;color:#64748B;font-size:12px;">
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
        to: recipients,
        subject: `Order ${poRef || orderNum} (${customer}) → ${stageLabel}`,
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
      console.error(`Resend stage send failed for ${orderNum}: HTTP ${sendRes.status} -- ${detail}`);
      return res.status(200).json({ sent: false, reason: `resend-http-${sendRes.status}`, detail });
    }

    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error(`Resend stage send failed for ${orderNum}:`, err.message);
    return res.status(200).json({ sent: false, reason: "send-failed", detail: err.message });
  }
}
