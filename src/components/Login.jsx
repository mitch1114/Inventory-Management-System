import { useState } from "react";
import { signIn } from "../lib/auth";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      // App listens for the auth change and swaps to the main UI.
    } catch (err) {
      setError(err.message || "Sign in failed. Check your email and password.");
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#F1F5F9",
        fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 16,
          boxShadow: "0 8px 40px rgba(0,0,0,0.08)",
          padding: "32px 30px",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontWeight: 900, fontSize: 20, color: "#0F172A", letterSpacing: "-0.02em" }}>
            ACC Crappie Stix
          </div>
          <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 4 }}>
            Sign in to access the inventory system
          </div>
        </div>

        <form onSubmit={submit}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>
            Email
          </label>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
            placeholder="you@company.com"
          />

          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.07em", margin: "16px 0 5px" }}>
            Password
          </label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={inputStyle}
            placeholder="••••••••"
          />

          {error && (
            <div
              style={{
                marginTop: 16,
                padding: "9px 12px",
                borderRadius: 8,
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                color: "#B91C1C",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              width: "100%",
              marginTop: 22,
              background: "linear-gradient(135deg,#6D28D9,#4F46E5)",
              border: "none",
              borderRadius: 8,
              padding: "11px 18px",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              cursor: busy ? "default" : "pointer",
              fontFamily: "inherit",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div style={{ marginTop: 18, fontSize: 11, color: "#94A3B8", textAlign: "center", lineHeight: 1.6 }}>
          Accounts are created by an administrator. Contact your admin if you
          need access.
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  background: "#FFFFFF",
  border: "1px solid #CBD5E1",
  borderRadius: 8,
  padding: "10px 12px",
  color: "#0F172A",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};
