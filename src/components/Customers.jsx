import { useState, useMemo, useRef } from "react";
import { uid, fmt, fmtNum, nowIso, toCSV, dlCSV, parseCSV } from "../lib/utils";
import { Badge, Modal, Field, Table, TR, TD, IS, SS, BP, BS, BD, BAq } from "./ui";

// --- Helpers -----------------------------------------------------------------
const CUSTOMER_TYPES = [
  { value: "dealer", label: "Dealer" },
  { value: "distributor-t1", label: "Tier 1 Distributor" },
  { value: "distributor-t2", label: "Tier 2 Distributor" },
  { value: "buying-group", label: "Buying Group" },
  { value: "retailer", label: "Retailer" },
];
const TYPE_LABEL = Object.fromEntries(CUSTOMER_TYPES.map((t) => [t.value, t.label]));

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
  const [importResult, setImportResult] = useState(null);
  const fileRef = useRef(null);

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

  // --- CSV Import ------------------------------------------------------------
  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCSV(ev.target.result);
      if (rows.length === 0) {
        setImportResult({ error: "No data rows found in CSV." });
        return;
      }

      // Detect columns (case-insensitive, flexible)
      const headers = Object.keys(rows[0]);
      const find = (aliases) =>
        headers.find((h) => aliases.includes(h.toLowerCase().trim())) || null;

      const nameCol = find(["name", "customer", "customer name", "company", "company name"]);
      const typeCol = find(["type", "customer type", "account type", "category"]);
      const emailCol = find(["email", "e-mail", "email address"]);
      const phoneCol = find(["phone", "phone number", "telephone", "tel"]);
      const addressCol = find(["address", "street", "location", "ship to", "shipping address"]);

      if (!nameCol) {
        setImportResult({
          error: `Could not find a "Name" column. Found columns: ${headers.join(", ")}`,
        });
        return;
      }

      const existingNames = new Set(
        data.customers.map((c) => c.name.toLowerCase().trim()),
      );

      let added = 0;
      let skipped = 0;
      let updated = 0;
      const newCustomers = [...data.customers];

      for (const row of rows) {
        const name = (row[nameCol] || "").trim();
        if (!name) {
          skipped++;
          continue;
        }

        const type = typeCol ? (row[typeCol] || "").trim().toLowerCase() : "";
        const validTypes = CUSTOMER_TYPES.map((t) => t.value);
        const resolvedType = validTypes.includes(type) ? type : "dealer";

        const email = emailCol ? (row[emailCol] || "").trim() : "";
        const phone = phoneCol ? (row[phoneCol] || "").trim() : "";
        const address = addressCol ? (row[addressCol] || "").trim() : "";

        // Check for existing customer (by name, case-insensitive)
        const existingIdx = newCustomers.findIndex(
          (c) => c.name.toLowerCase().trim() === name.toLowerCase(),
        );

        if (existingIdx !== -1) {
          // Update existing customer with any non-empty fields from CSV
          const existing = newCustomers[existingIdx];
          newCustomers[existingIdx] = {
            ...existing,
            type: type ? resolvedType : existing.type,
            email: email || existing.email,
            phone: phone || existing.phone,
            address: address || existing.address,
          };
          updated++;
        } else {
          newCustomers.push({
            id: uid(),
            name,
            type: resolvedType,
            email,
            phone,
            address,
          });
          added++;
        }
      }

      setData((d) => ({
        ...d,
        customers: newCustomers,
        auditLog: [
          ...(d.auditLog || []),
          {
            id: uid(),
            ts: nowIso(),
            type: "dealer-import",
            entity: "Customer Import",
            description: `CSV import: ${added} added, ${updated} updated, ${skipped} skipped`,
          },
        ],
      }));

      setImportResult({
        success: true,
        message: `Imported ${rows.length} row${rows.length !== 1 ? "s" : ""}: ${added} added, ${updated} updated${skipped > 0 ? `, ${skipped} skipped (no name)` : ""}`,
      });
    };
    reader.readAsText(file);
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
          <button style={BAq} onClick={() => fileRef.current?.click()}>
            Import CSV
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={handleImport}
          />
          <button style={BS} onClick={exportCSV}>
            Export CSV
          </button>
          <button style={BP} onClick={openNew}>
            + New Customer
          </button>
        </div>
      </div>

      {/* Import result banner */}
      {importResult && (
        <div
          style={{
            background: importResult.success ? "#F0FDF4" : "#FEF2F2",
            border: `1px solid ${importResult.success ? "#BBF7D0" : "#FECACA"}`,
            borderRadius: 10,
            padding: "12px 18px",
            marginBottom: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 14,
            color: importResult.success ? "#15803D" : "#DC2626",
            fontWeight: 600,
          }}
        >
          <span>{importResult.message || importResult.error}</span>
          <button
            style={{ ...BS, padding: "5px 12px", fontSize: 12 }}
            onClick={() => setImportResult(null)}
          >
            Dismiss
          </button>
        </div>
      )}

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
                <Badge status={c.type || "dealer"} label={TYPE_LABEL[c.type] || c.type || "Dealer"} />
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
              {CUSTOMER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
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
