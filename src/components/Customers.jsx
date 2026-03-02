import { useState, useMemo } from "react";
import { uid, fmt, fmtNum, nowIso, toCSV, dlCSV } from "../lib/utils";
import { Badge, Modal, Field, Table, TR, TD, IS, SS, BP, BS, BD } from "./ui";

// --- Helpers -----------------------------------------------------------------
const blank = () => ({
  name: "",
  type: "dealer",
  email: "",
  phone: "",
  address: "",
});

// --- Component ---------------------------------------------------------------
export default function Customers({ data, setData }) {
  const [editing, setEditing] = useState(null); // null | "new" | customer object
  const [form, setForm] = useState(blank());
  const [search, setSearch] = useState("");

  // Per-customer order count and lifetime value
  const stats = useMemo(() => {
    const map = {};
    data.salesOrders.forEach((o) => {
      const key = o.customer;
      if (!map[key]) map[key] = { orders: 0, value: 0 };
      map[key].orders += 1;
      map[key].value += o.lines.reduce(
        (s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty) * l.price,
        0,
      );
    });
    return map;
  }, [data.salesOrders]);

  // Filtered list
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.customers.filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.type || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q) ||
        (c.address || "").toLowerCase().includes(q),
    );
  }, [data.customers, search]);

  // --- Open create / edit ----------------------------------------------------
  const openNew = () => {
    setForm(blank());
    setEditing("new");
  };
  const openEdit = (c) => {
    setForm({
      name: c.name,
      type: c.type || "dealer",
      email: c.email || "",
      phone: c.phone || "",
      address: c.address || "",
    });
    setEditing(c);
  };

  // --- Save ------------------------------------------------------------------
  const save = () => {
    if (editing === "new") {
      const customer = { id: uid(), ...form };
      setData((d) => ({
        ...d,
        customers: [...d.customers, customer],
        auditLog: [
          ...(d.auditLog || []),
          {
            id: uid(),
            ts: nowIso(),
            type: "adjustment",
            entity: customer.name,
            description: `Added customer ${customer.name} (${customer.type})`,
          },
        ],
      }));
    } else {
      setData((d) => ({
        ...d,
        customers: d.customers.map((c) =>
          c.id === editing.id ? { ...c, ...form } : c,
        ),
        auditLog: [
          ...(d.auditLog || []),
          {
            id: uid(),
            ts: nowIso(),
            type: "adjustment",
            entity: editing.name,
            description: `Updated customer ${form.name}`,
          },
        ],
      }));
    }
    setEditing(null);
  };

  // --- Delete ----------------------------------------------------------------
  const deleteCustomer = (c) => {
    if (!confirm(`Delete customer "${c.name}"?`)) return;
    setData((d) => ({
      ...d,
      customers: d.customers.filter((x) => x.id !== c.id),
      auditLog: [
        ...(d.auditLog || []),
        {
          id: uid(),
          ts: nowIso(),
          type: "adjustment",
          entity: c.name,
          description: `Deleted customer ${c.name}`,
        },
      ],
    }));
  };

  // --- CSV Export -------------------------------------------------------------
  const exportCSV = () => {
    const rows = filtered.map((c) => {
      const s = stats[c.name] || { orders: 0, value: 0 };
      return {
        Name: c.name,
        Type: c.type || "",
        Email: c.email || "",
        Phone: c.phone || "",
        Address: c.address || "",
        Orders: s.orders,
        "Lifetime Value": s.value.toFixed(2),
      };
    });
    const csv = toCSV(rows, [
      "Name",
      "Type",
      "Email",
      "Phone",
      "Address",
      "Orders",
      "Lifetime Value",
    ]);
    dlCSV(csv, "customers.csv");
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
            Customers
          </h2>
          <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 13 }}>
            {data.customers.length} customer{data.customers.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            style={{ ...IS, width: 220 }}
            placeholder="Search customers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button style={BS} onClick={exportCSV}>
            Export CSV
          </button>
          <button style={BP} onClick={openNew}>
            + New Customer
          </button>
        </div>
      </div>

      {/* Customer Table */}
      <Table
        headers={["Name", "Type", "Email", "Phone", "Address", "Orders", "Lifetime Value", "Actions"]}
        empty={filtered.length === 0 ? "No customers found." : null}
      >
        {filtered.map((c, i) => {
          const s = stats[c.name] || { orders: 0, value: 0 };
          return (
            <TR key={c.id} i={i}>
              <TD>
                <span style={{ fontWeight: 600, color: "#0F172A" }}>{c.name}</span>
              </TD>
              <TD>
                <Badge status={c.type || "dealer"} label={c.type || "dealer"} />
              </TD>
              <TD>
                <span style={{ color: "#6D28D9", fontSize: 12 }}>{c.email || "--"}</span>
              </TD>
              <TD>{c.phone || "--"}</TD>
              <TD>
                <span style={{ fontSize: 12, color: "#64748B" }}>{c.address || "--"}</span>
              </TD>
              <TD>
                <span style={{ fontWeight: 600 }}>{fmtNum(s.orders)}</span>
              </TD>
              <TD mono accent="#15803D">
                {fmt(s.value)}
              </TD>
              <TD>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    style={{ ...BS, padding: "5px 10px", fontSize: 11 }}
                    onClick={() => openEdit(c)}
                  >
                    Edit
                  </button>
                  <button
                    style={{ ...BD, padding: "5px 10px", fontSize: 11 }}
                    onClick={() => deleteCustomer(c)}
                  >
                    Delete
                  </button>
                </div>
              </TD>
            </TR>
          );
        })}
      </Table>

      {/* Create / Edit Modal */}
      {editing && (
        <Modal
          title={editing === "new" ? "New Customer" : `Edit ${editing.name}`}
          onClose={() => setEditing(null)}
          width={560}
        >
          <Field label="Customer Name">
            <input
              style={IS}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Company or person name"
            />
          </Field>
          <Field label="Type">
            <select
              style={SS}
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            >
              <option value="dealer">Dealer</option>
              <option value="distributor">Distributor</option>
              <option value="retailer">Retailer</option>
            </select>
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
          <Field label="Address">
            <textarea
              style={{ ...IS, minHeight: 50, resize: "vertical" }}
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="Street, City, State ZIP"
            />
          </Field>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
            <button style={BS} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button style={BP} onClick={save} disabled={!form.name.trim()}>
              {editing === "new" ? "Add Customer" : "Save Changes"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
