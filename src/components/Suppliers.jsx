import { useState, useMemo } from "react";
import { uid, nowIso } from "../lib/utils";
import { Modal, Field, Badge, IS, BP, BS, BD } from "./ui";

// --- Helpers -----------------------------------------------------------------
const blank = () => ({
  name: "",
  contact: "",
  email: "",
  phone: "",
  leadDays: 14,
});

// --- Component ---------------------------------------------------------------
export default function Suppliers({ data, setData }) {
  const [editing, setEditing] = useState(null); // null | "new" | supplier object
  const [form, setForm] = useState(blank());
  const [search, setSearch] = useState("");

  // Counts per supplier
  const counts = useMemo(() => {
    const prodCount = {};
    const poCount = {};
    data.products.forEach((p) => {
      if (p.supplier) prodCount[p.supplier] = (prodCount[p.supplier] || 0) + 1;
    });
    data.purchaseOrders.forEach((po) => {
      poCount[po.supplierId] = (poCount[po.supplierId] || 0) + 1;
    });
    return { prodCount, poCount };
  }, [data.products, data.purchaseOrders]);

  // Filtered list
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.suppliers.filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        (s.contact || "").toLowerCase().includes(q) ||
        (s.email || "").toLowerCase().includes(q) ||
        (s.phone || "").toLowerCase().includes(q),
    );
  }, [data.suppliers, search]);

  // --- Open create / edit ----------------------------------------------------
  const openNew = () => {
    setForm(blank());
    setEditing("new");
  };
  const openEdit = (s) => {
    setForm({
      name: s.name,
      contact: s.contact || "",
      email: s.email || "",
      phone: s.phone || "",
      leadDays: s.leadDays != null ? s.leadDays : 14,
    });
    setEditing(s);
  };

  // --- Save ------------------------------------------------------------------
  const save = () => {
    if (editing === "new") {
      const supplier = { id: uid(), ...form };
      setData((d) => ({
        ...d,
        suppliers: [...d.suppliers, supplier],
        auditLog: [
          ...(d.auditLog || []),
          {
            id: uid(),
            ts: nowIso(),
            type: "adjustment",
            entity: supplier.name,
            description: `Added supplier ${supplier.name}`,
          },
        ],
      }));
    } else {
      setData((d) => ({
        ...d,
        suppliers: d.suppliers.map((s) =>
          s.id === editing.id ? { ...s, ...form } : s,
        ),
        auditLog: [
          ...(d.auditLog || []),
          {
            id: uid(),
            ts: nowIso(),
            type: "adjustment",
            entity: editing.name,
            description: `Updated supplier ${form.name}`,
          },
        ],
      }));
    }
    setEditing(null);
  };

  // --- Delete ----------------------------------------------------------------
  const deleteSupplier = (s) => {
    if (!confirm(`Delete supplier "${s.name}"?`)) return;
    setData((d) => ({
      ...d,
      suppliers: d.suppliers.filter((x) => x.id !== s.id),
      auditLog: [
        ...(d.auditLog || []),
        {
          id: uid(),
          ts: nowIso(),
          type: "adjustment",
          entity: s.name,
          description: `Deleted supplier ${s.name}`,
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
            Suppliers
          </h2>
          <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 13 }}>
            {data.suppliers.length} supplier{data.suppliers.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            style={{ ...IS, width: 220 }}
            placeholder="Search suppliers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button style={BP} onClick={openNew}>
            + New Supplier
          </button>
        </div>
      </div>

      {/* Supplier Cards */}
      {filtered.length === 0 && (
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E2E8F0",
            borderRadius: 12,
            padding: 48,
            textAlign: "center",
            color: "#94A3B8",
            fontSize: 14,
          }}
        >
          No suppliers found.
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 14,
        }}
      >
        {filtered.map((s) => {
          const prods = counts.prodCount[s.id] || 0;
          const pos = counts.poCount[s.id] || 0;
          return (
            <div
              key={s.id}
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                borderRadius: 12,
                padding: "18px 20px",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Accent bar */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: 3,
                  height: "100%",
                  background: "linear-gradient(135deg,#6D28D9,#4F46E5)",
                }}
              />

              {/* Name + lead time */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: 10,
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>
                  {s.name}
                </div>
                <Badge
                  status="ordered"
                  label={`${s.leadDays != null ? s.leadDays : "--"} day lead`}
                />
              </div>

              {/* Contact info */}
              <div style={{ fontSize: 13, color: "#475569", marginBottom: 4 }}>
                {s.contact && (
                  <div style={{ marginBottom: 2 }}>
                    <span style={{ color: "#94A3B8", fontSize: 11 }}>Contact:</span>{" "}
                    {s.contact}
                  </div>
                )}
                {s.email && (
                  <div style={{ marginBottom: 2 }}>
                    <span style={{ color: "#94A3B8", fontSize: 11 }}>Email:</span>{" "}
                    <span style={{ color: "#6D28D9" }}>{s.email}</span>
                  </div>
                )}
                {s.phone && (
                  <div style={{ marginBottom: 2 }}>
                    <span style={{ color: "#94A3B8", fontSize: 11 }}>Phone:</span>{" "}
                    {s.phone}
                  </div>
                )}
              </div>

              {/* Counts */}
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: "1px solid #F1F5F9",
                  fontSize: 12,
                  color: "#64748B",
                }}
              >
                <span>
                  <strong style={{ color: "#0F172A" }}>{prods}</strong> product
                  {prods !== 1 ? "s" : ""}
                </span>
                <span>
                  <strong style={{ color: "#0F172A" }}>{pos}</strong> PO
                  {pos !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Actions */}
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginTop: 12,
                }}
              >
                <button
                  style={{ ...BS, padding: "5px 12px", fontSize: 11 }}
                  onClick={() => openEdit(s)}
                >
                  Edit
                </button>
                <button
                  style={{ ...BD, padding: "5px 12px", fontSize: 11 }}
                  onClick={() => deleteSupplier(s)}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create / Edit Modal */}
      {editing && (
        <Modal
          title={editing === "new" ? "New Supplier" : `Edit ${editing.name}`}
          onClose={() => setEditing(null)}
          width={520}
        >
          <Field label="Company Name">
            <input
              style={IS}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Supplier name"
            />
          </Field>
          <Field label="Contact Person">
            <input
              style={IS}
              value={form.contact}
              onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
              placeholder="Full name"
            />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
            <Field label="Email">
              <input
                style={IS}
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="email@example.com"
              />
            </Field>
            <Field label="Phone">
              <input
                style={IS}
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="555-1234"
              />
            </Field>
          </div>
          <Field label="Lead Time (days)">
            <input
              style={{ ...IS, width: 120 }}
              type="number"
              min="1"
              value={form.leadDays}
              onChange={(e) =>
                setForm((f) => ({ ...f, leadDays: Math.max(1, +e.target.value || 1) }))
              }
            />
          </Field>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
            <button style={BS} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button style={BP} onClick={save} disabled={!form.name.trim()}>
              {editing === "new" ? "Add Supplier" : "Save Changes"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
