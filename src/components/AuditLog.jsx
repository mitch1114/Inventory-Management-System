import { useState, useMemo } from "react";
import { uid, fmtTs, nowIso, toCSV, dlCSV } from "../lib/utils";
import { Badge, Table, TR, TD, IS, BP, BS, BD } from "./ui";

// All possible audit log entry types for the filter chips
const LOG_TYPES = [
  { key: "all", label: "All" },
  { key: "dealer-import", label: "Dealer Import" },
  { key: "shipped-log", label: "Shipped" },
  { key: "stage-advance", label: "Stage Advance" },
  { key: "ordered", label: "PO Ordered" },
  { key: "received", label: "PO Received" },
  { key: "adjustment", label: "Adjustment" },
  { key: "auto-allocated", label: "Auto-Allocated" },
];

// --- Component ---------------------------------------------------------------
export default function AuditLog({ data, setData }) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Filtered + reversed (newest first)
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return [...(data.auditLog || [])]
      .reverse()
      .filter((a) => {
        if (typeFilter !== "all" && a.type !== typeFilter) return false;
        if (
          q &&
          !(a.description || "").toLowerCase().includes(q) &&
          !(a.entity || "").toLowerCase().includes(q) &&
          !(a.type || "").toLowerCase().includes(q)
        )
          return false;
        return true;
      });
  }, [data.auditLog, typeFilter, search]);

  // Unique types actually present in the log (for chip highlighting)
  const presentTypes = useMemo(() => {
    const s = new Set();
    (data.auditLog || []).forEach((a) => s.add(a.type));
    return s;
  }, [data.auditLog]);

  // --- CSV Export -------------------------------------------------------------
  const exportCSV = () => {
    const rows = filtered.map((a) => ({
      Timestamp: a.ts,
      Type: a.type,
      Entity: a.entity || "",
      Description: a.description || "",
    }));
    const csv = toCSV(rows, ["Timestamp", "Type", "Entity", "Description"]);
    dlCSV(csv, "audit-log.csv");
  };

  // --- Clear Log -------------------------------------------------------------
  const clearLog = () => {
    if (!confirm("Clear the entire audit log? This cannot be undone.")) return;
    setData((d) => ({
      ...d,
      auditLog: [
        {
          id: uid(),
          ts: nowIso(),
          type: "adjustment",
          entity: "System",
          description: "Audit log cleared",
        },
      ],
    }));
  };

  // --- Render ----------------------------------------------------------------
  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 18,
        }}
      >
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>
            Audit Log
          </h2>
          <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 13 }}>
            {(data.auditLog || []).length} entr
            {(data.auditLog || []).length === 1 ? "y" : "ies"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            style={{ ...IS, width: 220 }}
            placeholder="Search log..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button style={BS} onClick={exportCSV}>
            Export CSV
          </button>
          <button style={BD} onClick={clearLog}>
            Clear Log
          </button>
        </div>
      </div>

      {/* Type Filter Chips */}
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        {LOG_TYPES.filter(
          (t) => t.key === "all" || presentTypes.has(t.key),
        ).map((t) => {
          const active = typeFilter === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTypeFilter(t.key)}
              style={{
                background: active ? "#6D28D9" : "#F8FAFC",
                color: active ? "#FFFFFF" : "#475569",
                border: active ? "1px solid #6D28D9" : "1px solid #CBD5E1",
                borderRadius: 20,
                padding: "5px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Log Table */}
      <Table
        headers={["Timestamp", "Type", "Entity", "Description"]}
        empty={filtered.length === 0 ? "No log entries found." : null}
      >
        {filtered.map((a, i) => (
          <TR key={a.id} i={i}>
            <TD>
              <span style={{ fontSize: 12, color: "#64748B", whiteSpace: "nowrap" }}>
                {fmtTs(a.ts)}
              </span>
            </TD>
            <TD>
              <Badge status={a.type} label={a.type.replace(/-/g, " ")} />
            </TD>
            <TD mono accent="#6D28D9">
              {a.entity || "--"}
            </TD>
            <TD>
              <span style={{ fontSize: 13, color: "#334155" }}>
                {a.description || "--"}
              </span>
            </TD>
          </TR>
        ))}
      </Table>

      {/* Entry count summary */}
      {filtered.length > 0 && (
        <div
          style={{
            textAlign: "right",
            fontSize: 12,
            color: "#94A3B8",
            marginTop: 10,
          }}
        >
          Showing {filtered.length} of {(data.auditLog || []).length} entries
        </div>
      )}
    </div>
  );
}
