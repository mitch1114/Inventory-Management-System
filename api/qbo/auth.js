// GET /api/qbo/auth
// Initiates QuickBooks Online OAuth 2.0 authorization flow.
// Redirects the user to Intuit's consent screen.

const INTUIT_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";

export default function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const clientId = process.env.INTUIT_CLIENT_ID;
  if (!clientId) {
    return res.status(400).json({
      error: "INTUIT_CLIENT_ID not configured. Add it to your Vercel environment variables.",
    });
  }

  // Build the redirect URI from the request host
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/qbo/callback`;

  // Generate a simple state token to prevent CSRF
  const state = Buffer.from(JSON.stringify({ ts: Date.now() })).toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: redirectUri,
    state,
  });

  const authUrl = `${INTUIT_AUTH_URL}?${params.toString()}`;
  res.redirect(302, authUrl);
}
