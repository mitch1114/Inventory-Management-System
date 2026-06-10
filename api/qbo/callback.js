// GET /api/qbo/callback
// OAuth 2.0 callback handler. Exchanges authorization code for tokens
// and returns them to the frontend via a postMessage to the opener window.

const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { code, realmId, state, error } = req.query;

  if (error) {
    return res.status(200).send(resultPage({ error: "Authorization was denied." }, req));
  }

  if (!code || !realmId) {
    return res.status(200).send(resultPage({ error: "Missing authorization code or realm ID." }, req));
  }

  // Validate state token (CSRF prevention)
  if (!state) {
    return res.status(200).send(resultPage({ error: "Missing state parameter." }, req));
  }
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
    const age = Date.now() - (decoded.ts || 0);
    if (age > 10 * 60 * 1000 || age < 0) {
      return res.status(200).send(resultPage({ error: "Authorization expired. Please try again." }, req));
    }
  } catch {
    return res.status(200).send(resultPage({ error: "Invalid state parameter." }, req));
  }

  const clientId = process.env.INTUIT_CLIENT_ID;
  const clientSecret = process.env.INTUIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res
      .status(200)
      .send(resultPage({ error: "Server missing INTUIT_CLIENT_ID or INTUIT_CLIENT_SECRET." }, req));
  }

  // Build redirect URI (must match exactly what was sent in /auth)
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/qbo/callback`;

  // Exchange code for tokens
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    const tokenRes = await fetch(INTUIT_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!tokenRes.ok) {
      console.error(`QBO token exchange failed: ${tokenRes.status}`);
      return res
        .status(200)
        .send(resultPage({ error: "Token exchange failed. Please try again." }, req));
    }

    const tokens = await tokenRes.json();
    return res.status(200).send(
      resultPage({
        success: true,
        data: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          realmId,
          expiresIn: tokens.expires_in,
          tokenType: tokens.token_type,
          issuedAt: Date.now(),
        },
      }, req),
    );
  } catch (err) {
    console.error("QBO token exchange error:", err.message);
    return res.status(200).send(resultPage({ error: "Token exchange error. Please try again." }, req));
  }
}

function resultPage(result, req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const origin = `${proto}://${host}`;
  const safePayload = JSON.stringify(result).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `<!DOCTYPE html>
<html>
<head><title>QuickBooks Connected</title></head>
<body>
<p>${result.error ? "Connection failed. You can close this window." : "Connected! This window will close automatically."}</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: "qbo-auth", payload: ${safePayload} }, ${JSON.stringify(origin)});
    setTimeout(function() { window.close(); }, 1500);
  }
</script>
</body>
</html>`;
}
