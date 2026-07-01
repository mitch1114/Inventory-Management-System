// --- QuickBooks Online client-side helpers ------------------------------------
// Manages OAuth tokens in localStorage and provides fetch wrappers for the
// serverless API endpoints in /api/qbo/*.

const STORAGE_KEY = "qbo_tokens";

// --- Token storage -----------------------------------------------------------
export function getQboTokens() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveQboTokens(tokens) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export function clearQboTokens() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isQboConnected() {
  const t = getQboTokens();
  return !!(t && t.accessToken && t.realmId);
}

// --- Token refresh -----------------------------------------------------------
// QBO access tokens expire after ~1 hour. This checks and refreshes if needed.
export async function ensureFreshToken() {
  const tokens = getQboTokens();
  if (!tokens) throw new Error("Not connected to QuickBooks.");

  const elapsed = Date.now() - (tokens.issuedAt || 0);
  const expiresMs = (tokens.expiresIn || 3600) * 1000;

  // Refresh if within 5 minutes of expiry
  if (elapsed < expiresMs - 5 * 60 * 1000) {
    return tokens;
  }

  const res = await fetch("/api/qbo/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Refresh failed" }));
    // If refresh fails, clear tokens so user can reconnect
    if (res.status === 401 || res.status === 400) clearQboTokens();
    throw new Error(err.error || "Token refresh failed");
  }

  const fresh = await res.json();
  const updated = { ...tokens, ...fresh };
  saveQboTokens(updated);
  return updated;
}

// --- OAuth popup flow --------------------------------------------------------
export function connectQbo() {
  return new Promise((resolve, reject) => {
    const w = 600;
    const h = 700;
    const left = window.screenX + (window.innerWidth - w) / 2;
    const top = window.screenY + (window.innerHeight - h) / 2;

    const popup = window.open(
      "/api/qbo/auth",
      "qbo-auth",
      `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no`,
    );

    if (!popup) {
      reject(new Error("Popup blocked. Please allow popups for this site."));
      return;
    }

    const onMessage = (e) => {
      if (!e.data || e.data.type !== "qbo-auth") return;
      window.removeEventListener("message", onMessage);
      clearInterval(pollTimer);

      const { payload } = e.data;
      if (payload.error) {
        reject(new Error(payload.error));
      } else if (payload.success && payload.data) {
        saveQboTokens(payload.data);
        resolve(payload.data);
      } else {
        reject(new Error("Unexpected auth response"));
      }
    };

    window.addEventListener("message", onMessage);

    // Poll in case postMessage doesn't fire (e.g. popup closed manually)
    const pollTimer = setInterval(() => {
      if (popup.closed) {
        clearInterval(pollTimer);
        window.removeEventListener("message", onMessage);
        // Check if tokens were saved (success case where message was received)
        if (isQboConnected()) {
          resolve(getQboTokens());
        } else {
          reject(new Error("Authorization window was closed."));
        }
      }
    }, 500);
  });
}

// --- Fetch invoices ----------------------------------------------------------
export async function fetchInvoices({ startDate, maxResults } = {}) {
  const tokens = await ensureFreshToken();

  const res = await fetch("/api/qbo/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accessToken: tokens.accessToken,
      realmId: tokens.realmId,
      startDate,
      maxResults,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Invoice fetch failed" }));
    throw new Error(err.error || `Invoice fetch failed (${res.status})`);
  }

  return res.json();
}
