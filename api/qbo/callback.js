// GET /api/qbo/callback
// OAuth 2.0 callback handler. Exchanges authorization code for tokens
// and returns them to the frontend via a postMessage to the opener window.

const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { code, realmId, state, error } = req.query;

  if (error) {
    return res.status(200).send(resultPage({ error: `Authorization denied: ${error}` }));
  }

  if (!code || !realmId) {
    return res.status(200).send(resultPage({ error: "Missing authorization code or realm ID." }));
  }

  const clientId = process.env.INTUIT_CLIENT_ID;
  const clientSecret = process.env.INTUIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res
      .status(200)
      .send(resultPage({ error: "Server missing INTUIT_CLIENT_ID or INTUIT_CLIENT_SECRET." }));
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
      const errBody = await tokenRes.text();
      return res
        .status(200)
        .send(resultPage({ error: `Token exchange failed (${tokenRes.status}): ${errBody}` }));
    }

    const tokens = await tokenRes.json();
    // Send tokens back to the opener window
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
      }),
    );
  } catch (err) {
    return res.status(200).send(resultPage({ error: `Token exchange error: ${err.message}` }));
  }
}

// Returns an HTML page that sends the result to the opener window via postMessage,
// then closes itself. This is the standard pattern for popup-based OAuth.
function resultPage(result) {
  const payload = JSON.stringify(result);
  return `<!DOCTYPE html>
<html>
<head><title>QuickBooks Connected</title></head>
<body>
<p>${result.error ? "Connection failed. You can close this window." : "Connected! This window will close automatically."}</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: "qbo-auth", payload: ${payload} }, "*");
    setTimeout(function() { window.close(); }, 1500);
  }
</script>
</body>
</html>`;
}
