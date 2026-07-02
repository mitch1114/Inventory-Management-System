// POST /api/qbo/refresh
// Refreshes an expired QBO access token using the refresh token.

const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return res.status(400).json({ error: "Missing refreshToken in request body." });
  }

  const clientId = process.env.INTUIT_CLIENT_ID;
  const clientSecret = process.env.INTUIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: "Server missing INTUIT_CLIENT_ID or INTUIT_CLIENT_SECRET." });
  }

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
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!tokenRes.ok) {
      console.error(`QBO token refresh failed: ${tokenRes.status}`);
      return res.status(tokenRes.status).json({
        error: `Token refresh failed (${tokenRes.status}). Please reconnect to QuickBooks.`,
      });
    }

    const tokens = await tokenRes.json();
    return res.status(200).json({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      tokenType: tokens.token_type,
      issuedAt: Date.now(),
    });
  } catch (err) {
    console.error("QBO token refresh error:", err.message);
    return res.status(500).json({ error: "Token refresh error. Please try again." });
  }
}
