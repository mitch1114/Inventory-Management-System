import { SC } from "../lib/constants";

// --- Shared style constants ---------------------------------------------------
export const IS = {
  width: "100%",
  background: "#FFFFFF",
  border: "1px solid #CBD5E1",
  borderRadius: 8,
  padding: "9px 12px",
  color: "#0F172A",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};
export const SS = { ...IS, cursor: "pointer" };
export const BP = {
  background: "linear-gradient(135deg,#6D28D9,#4F46E5)",
  border: "none",
  borderRadius: 8,
  padding: "9px 18px",
  color: "#fff",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
};
export const BS = {
  background: "#F8FAFC",
  border: "1px solid #CBD5E1",
  borderRadius: 8,
  padding: "9px 18px",
  color: "#475569",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
};
export const BD = {
  background: "#FEF2F2",
  border: "1px solid #FECACA",
  borderRadius: 8,
  padding: "9px 18px",
  color: "#DC2626",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
};
export const BG = {
  background: "#F0FDF4",
  border: "1px solid #BBF7D0",
  borderRadius: 8,
  padding: "9px 18px",
  color: "#15803D",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
};
export const BAq = {
  background: "#ECFEFF",
  border: "1px solid #A5F3FC",
  borderRadius: 8,
  padding: "9px 18px",
  color: "#0E7490",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
};

// --- Badge --------------------------------------------------------------------
export function Badge({ status, label }) {
  const s = SC[status] || {
    bg: "#F3F4F6",
    text: "#374151",
    dot: "#9CA3AF",
    border: "#D1D5DB",
  };
  return (
    <span
      style={{
        background: s.bg,
        color: s.text,
        border: `1px solid ${s.border}`,
        borderRadius: 20,
        padding: "2px 10px",
        fontSize: 12,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: s.dot,
          flexShrink: 0,
        }}
      />
      {label || status}
    </span>
  );
}

// --- Modal --------------------------------------------------------------------
export function Modal({ title, onClose, children, width = 640 }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        backdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 14,
          width: "100%",
          maxWidth: width,
          maxHeight: "92vh",
          overflow: "auto",
          boxShadow: "0 8px 40px rgba(0,0,0,0.12)",
        }}
      >
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid #E2E8F0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            position: "sticky",
            top: 0,
            background: "#FFFFFF",
            zIndex: 1,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 17, color: "#0F172A" }}>{title}</span>
          <button
            onClick={onClose}
            style={{
              background: "#F1F5F9",
              border: "1px solid #E2E8F0",
              color: "#64748B",
              cursor: "pointer",
              fontSize: 16,
              borderRadius: 8,
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            &times;
          </button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  );
}

// --- Field --------------------------------------------------------------------
export function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 600,
          color: "#64748B",
          marginBottom: 5,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}
      >
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

// --- Table --------------------------------------------------------------------
export function Table({ headers, children, empty }) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E8F0",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#F8FAFC" }}>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  padding: "11px 14px",
                  textAlign: "left",
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#94A3B8",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  borderBottom: "1px solid #E2E8F0",
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty && (
        <div style={{ padding: 48, textAlign: "center", color: "#94A3B8", fontSize: 14 }}>
          {empty}
        </div>
      )}
    </div>
  );
}

export const TR = ({ children, i, hl }) => (
  <tr
    style={{
      borderBottom: "1px solid #F1F5F9",
      background: hl ? "#EFF6FF" : i % 2 === 0 ? "transparent" : "#FAFAFA",
    }}
  >
    {children}
  </tr>
);

export const TD = ({ children, mono, accent, s }) => (
  <td
    style={{
      padding: "11px 14px",
      fontSize: 13,
      color: accent || "#374151",
      fontFamily: mono ? "monospace" : "inherit",
      fontWeight: mono ? 600 : 400,
      ...s,
    }}
  >
    {children}
  </td>
);
