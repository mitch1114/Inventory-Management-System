import { useState } from "react";

/**
 * Collapsible help/info panel with a clickable trigger button.
 * @param {string} title - Header text shown on the trigger and panel header
 * @param {Array<{heading:string, body:string|JSX.Element}>} sections - Content sections
 * @param {string} [buttonLabel] - Override for the trigger button text (defaults to "Help")
 */
export default function HelpPanel({ title, sections, buttonLabel }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        style={{
          background: "#EFF6FF",
          border: "1px solid #BFDBFE",
          borderRadius: 8,
          padding: "7px 14px",
          color: "#2563EB",
          fontWeight: 600,
          fontSize: 12,
          cursor: "pointer",
          fontFamily: "inherit",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 14, lineHeight: 1 }}>&#9432;</span>
        {buttonLabel || "Help"}
      </button>

      {/* Overlay panel */}
      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            backdropFilter: "blur(4px)",
            zIndex: 1100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E8F0",
              borderRadius: 14,
              width: "100%",
              maxWidth: 600,
              maxHeight: "85vh",
              overflow: "auto",
              boxShadow: "0 8px 40px rgba(0,0,0,0.12)",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "18px 22px",
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
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    background: "#EFF6FF",
                    border: "1px solid #BFDBFE",
                    borderRadius: 8,
                    width: 32,
                    height: 32,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    color: "#2563EB",
                  }}
                >
                  &#9432;
                </span>
                <span style={{ fontWeight: 700, fontSize: 16, color: "#0F172A" }}>
                  {title}
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
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

            {/* Body */}
            <div style={{ padding: "20px 22px" }}>
              {sections.map((section, idx) => (
                <div key={idx} style={{ marginBottom: idx < sections.length - 1 ? 20 : 0 }}>
                  <h4
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#0F172A",
                      margin: "0 0 8px",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        background: "linear-gradient(135deg,#6D28D9,#4F46E5)",
                        color: "#FFFFFF",
                        borderRadius: 6,
                        width: 22,
                        height: 22,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {idx + 1}
                    </span>
                    {section.heading}
                  </h4>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#475569",
                      lineHeight: 1.6,
                      paddingLeft: 30,
                    }}
                  >
                    {section.body}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: "14px 22px",
                borderTop: "1px solid #E2E8F0",
                textAlign: "right",
              }}
            >
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: "#F8FAFC",
                  border: "1px solid #CBD5E1",
                  borderRadius: 8,
                  padding: "8px 18px",
                  color: "#475569",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
