import { useState, useMemo, useRef } from "react";
import { uid, fmt, fmtNum, nowIso, fmtDate, fmtTs, toCSV, dlCSV, parseCSV } from "../lib/utils";
import { STAGE_LABEL } from "../lib/constants";
import { customerHistoryStats, historyRevenue, normalizeName } from "../lib/historyImport";
import { isQboConnected, fetchInvoices } from "../lib/qbo";
import { Badge, Modal, Field, Table, TR, TD, IS, SS, BP, BS, BAq } from "./ui";

// --- Helpers -----------------------------------------------------------------
const CUSTOMER_TYPES = [
  { value: "dealer", label: "Dealer" },
  { value: "distributor-t1", label: "Tier 1 Distributor" },
  { value: "distributor-t2", label: "Tier 2 Distributor" },
  { value: "buying-group", label: "Buying Group" },
  { value: "retailer", label: "Retailer" },
];
const TYPE_LABEL = Object.fromEntries(CUSTOMER_TYPES.map((t) => [t.value, t.label]));

const CONTACT_ROLES = [
  { key: "owner", label: "Owner" },
  { key: "buyer", label: "Buyer" },
  { key: "marketing", label: "Marketing" },
  { key: "ops", label: "OPS" },
  { key: "finance", label: "Finance" },
];

const blankContact = () => ({ name: "", email: "", phone: "" });
const blankContacts = () =>
  Object.fromEntries(CONTACT_ROLES.map((r) => [r.key, blankContact()]));

const PAYMENT_TERMS = ["Net 30", "Due on Receipt", "Net 15", "Net 45", "Net 60"];

const blank = () => ({
  name: "",
  type: "dealer",
  email: "",
  phone: "",
  address: "",
  billToAddress: "",
  paymentTerms: "Net 30",
  notes: "",
  contacts: blankContacts(),
});

// Section header used in the detail modal
const SH = {
  fontSize: 11,
  fontWeight: 700,
  color: "#64748B",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  margin: "0 0 8px",
};

// --- Component ---------------------------------------------------------------
export default function Customers({ data, setData }) {
  const [editing, setEditing] = useState(null); // null | "new" | customer object
  const [form, setForm] = useState(blank());
  const [search, setSearch] = useState("");
  const [importResult, setImportResult] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [arSyncing, setArSyncing] = useState(false);
  const [arError, setArError] = useState(null);
  const [dealerImportMsg, setDealerImportMsg] = useState(null);
  const fileRef = useRef(null);
  const dealerFileRef = useRef(null);

  const qboConnected = isQboConnected();
  const viewing = viewingId ? data.customers.find((c) => c.id === viewingId) : null;

  // Per-customer order count and lifetime value -- live orders plus imported
  // sales history (matched by normalized name).
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
    const histByNorm = {};
    (data.historicalSales || []).forEach((h) => {
      const k = normalizeName(h.customer);
      if (!histByNorm[k]) histByNorm[k] = { orders: 0, value: 0 };
      histByNorm[k].orders += 1;
      histByNorm[k].value += historyRevenue(h);
    });
    data.customers.forEach((c) => {
      const hist = histByNorm[normalizeName(c.name)];
      if (!hist) return;
      if (!map[c.name]) map[c.name] = { orders: 0, value: 0 };
      map[c.name].orders += hist.orders;
      map[c.name].value += hist.value;
    });
    return map;
  }, [data.salesOrders, data.historicalSales, data.customers]);

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

  // Last AR sync timestamp (any customer)
  const arLastSync = useMemo(() => {
    let latest = null;
    data.customers.forEach((c) => {
      if (c.openARUpdated && (!latest || c.openARUpdated > latest)) latest = c.openARUpdated;
    });
    return latest;
  }, [data.customers]);

  // YTD orders for the customer currently being viewed
  const ytdOrders = useMemo(() => {
    if (!viewing) return [];
    const jan1 = `${new Date().getFullYear()}-01-01`;
    const key = viewing.name.toLowerCase().trim();
    return data.salesOrders
      .filter(
        (o) =>
          (o.customer || "").toLowerCase().trim() === key && (o.date || "") >= jan1,
      )
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [data.salesOrders, viewing]);

  // Imported sales history for the customer being viewed
  const hist = useMemo(
    () => (viewing ? customerHistoryStats(data.historicalSales || [], viewing.name) : null),
    [data.historicalSales, viewing],
  );

  const ytdTotals = useMemo(() => {
    let units = 0;
    let revenue = 0;
    ytdOrders.forEach((o) => {
      o.lines.forEach((l) => {
        units += l.qty;
        revenue += l.qty * l.price;
      });
    });
    return { orders: ytdOrders.length, units, revenue };
  }, [ytdOrders]);

  // --- Open create / edit / view ----------------------------------------------
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
      billToAddress: c.billToAddress || "",
      paymentTerms: c.paymentTerms || "Net 30",
      notes: c.notes || "",
      contacts: Object.fromEntries(
        CONTACT_ROLES.map((r) => [
          r.key,
          { ...blankContact(), ...((c.contacts || {})[r.key] || {}) },
        ]),
      ),
    });
    setEditing(c);
  };
  const openView = (c) => {
    setDealerImportMsg(null);
    setViewingId(c.id);
  };

  const setContact = (role, field, value) =>
    setForm((f) => ({
      ...f,
      contacts: { ...f.contacts, [role]: { ...f.contacts[role], [field]: value } },
    }));

  // Inline type change from the table -- distributors automatically get the
  // standard Net 60 terms unless they already have them.
  const setCustomerType = (c, type) => {
    setData((d) => ({
      ...d,
      customers: d.customers.map((x) =>
        x.id === c.id
          ? {
              ...x,
              type,
              paymentTerms:
                type.startsWith("distributor") && x.paymentTerms !== "Net 60"
                  ? "Net 60"
                  : x.paymentTerms,
            }
          : x,
      ),
      auditLog: [
        ...(d.auditLog || []),
        {
          id: uid(),
          ts: nowIso(),
          type: "adjustment",
          entity: c.name,
          description: `Changed ${c.name} type to ${TYPE_LABEL[type] || type}${type.startsWith("distributor") ? " (terms set to Net 60)" : ""}`,
        },
      ],
    }));
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

  // --- Sync open AR from QuickBooks --------------------------------------------
  const syncAR = async () => {
    setArSyncing(true);
    setArError(null);
    try {
      const res = await fetchInvoices({ maxResults: 1000 });
      const totals = {};
      (res.salesOrders || []).forEach((inv) => {
        const key = (inv.customer || "").toLowerCase().trim();
        const bal = Number(inv.balance) || 0;
        if (key && bal > 0) totals[key] = (totals[key] || 0) + bal;
      });
      const ts = nowIso();
      setData((d) => ({
        ...d,
        customers: d.customers.map((c) => ({
          ...c,
          openAR: totals[c.name.toLowerCase().trim()] || 0,
          openARUpdated: ts,
        })),
      }));
    } catch (err) {
      setArError(err.message || "AR sync failed");
    } finally {
      setArSyncing(false);
    }
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

  // --- Dealer / ship-to CSV import (distributor sub-accounts) ------------------
  const handleDealerImport = (e) => {
    const file = e.target.files[0];
    if (!file || !viewing) return;
    e.target.value = "";

    const customerId = viewing.id;
    const customerName = viewing.name;
    const existingSubs = viewing.subAccounts || [];

    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCSV(ev.target.result);
      if (rows.length === 0) {
        setDealerImportMsg({ error: "No data rows found in CSV." });
        return;
      }

      const headers = Object.keys(rows[0]);
      const find = (aliases) =>
        headers.find((h) => aliases.includes(h.toLowerCase().trim())) || null;

      const nameCol = find(["name", "dealer", "dealer name", "customer", "account", "account name"]);
      const addressCol = find(["address", "street", "location", "ship to", "shipping address"]);
      const cityCol = find(["city"]);
      const stateCol = find(["state", "st"]);
      const emailCol = find(["email", "e-mail", "email address"]);
      const phoneCol = find(["phone", "phone number", "telephone", "tel"]);

      if (!nameCol) {
        setDealerImportMsg({
          error: `Could not find a "Name" column. Found columns: ${headers.join(", ")}`,
        });
        return;
      }

      let added = 0;
      let updated = 0;
      let skipped = 0;
      const merged = [...existingSubs];

      for (const row of rows) {
        const name = (row[nameCol] || "").trim();
        if (!name) {
          skipped++;
          continue;
        }

        const address = [
          addressCol ? (row[addressCol] || "").trim() : "",
          cityCol ? (row[cityCol] || "").trim() : "",
          stateCol ? (row[stateCol] || "").trim() : "",
        ]
          .filter(Boolean)
          .join(", ");
        const email = emailCol ? (row[emailCol] || "").trim() : "";
        const phone = phoneCol ? (row[phoneCol] || "").trim() : "";

        const idx = merged.findIndex(
          (s) => s.name.toLowerCase().trim() === name.toLowerCase(),
        );
        if (idx !== -1) {
          merged[idx] = {
            ...merged[idx],
            address: address || merged[idx].address,
            email: email || merged[idx].email,
            phone: phone || merged[idx].phone,
          };
          updated++;
        } else {
          merged.push({ id: uid(), name, address, email, phone });
          added++;
        }
      }

      const count = added + updated;
      setData((d) => ({
        ...d,
        customers: d.customers.map((c) =>
          c.id === customerId ? { ...c, subAccounts: merged } : c,
        ),
        auditLog: [
          ...(d.auditLog || []),
          {
            id: uid(),
            ts: nowIso(),
            type: "adjustment",
            entity: customerName,
            description: `Imported ${count} dealer accounts for ${customerName}`,
          },
        ],
      }));

      setDealerImportMsg({
        success: true,
        message: `Imported ${count} dealer account${count !== 1 ? "s" : ""}: ${added} added, ${updated} updated${skipped > 0 ? `, ${skipped} skipped (no name)` : ""}`,
      });
    };
    reader.readAsText(file);
  };

  // Contacts with at least one filled field, for the detail view
  const filledContacts = viewing
    ? CONTACT_ROLES.map((r) => ({
        ...r,
        contact: (viewing.contacts || {})[r.key] || blankContact(),
      })).filter((r) => r.contact.name || r.contact.email || r.contact.phone)
    : [];

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
            {arLastSync && (
              <span style={{ color: "#94A3B8" }}> &middot; AR synced {fmtTs(arLastSync)}</span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            style={{ ...IS, width: 220 }}
            placeholder="Search customers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {qboConnected && (
            <button style={BAq} onClick={syncAR} disabled={arSyncing}>
              {arSyncing ? "Syncing AR..." : "Sync AR from QuickBooks"}
            </button>
          )}
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

      {/* AR sync error banner */}
      {arError && (
        <div
          style={{
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 10,
            padding: "12px 18px",
            marginBottom: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 14,
            color: "#DC2626",
            fontWeight: 600,
          }}
        >
          <span>AR sync failed: {arError}</span>
          <button
            style={{ ...BS, padding: "5px 12px", fontSize: 12 }}
            onClick={() => setArError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

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
        headers={["Name", "Type", "Email", "Phone", "Address", "Orders", "Lifetime Value", "Open AR", "Actions"]}
        empty={filtered.length === 0 ? "No customers found." : null}
      >
        {filtered.map((c, i) => {
          const s = stats[c.name] || { orders: 0, value: 0 };
          const dealerCount = (c.subAccounts || []).length;
          return (
            <TR key={c.id} i={i}>
              <TD>
                <span
                  style={{ fontWeight: 600, color: "#0F172A", cursor: "pointer" }}
                  onClick={() => openView(c)}
                >
                  {c.name}
                </span>
                {dealerCount > 0 && (
                  <span
                    style={{
                      marginLeft: 8,
                      background: "#F5F3FF",
                      color: "#6D28D9",
                      border: "1px solid #DDD6FE",
                      borderRadius: 20,
                      padding: "1px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {dealerCount} dealer{dealerCount !== 1 ? "s" : ""}
                  </span>
                )}
              </TD>
              <TD>
                {/* Inline-editable type -- pick a new one to reclassify */}
                <select
                  value={c.type || "dealer"}
                  onChange={(e) => setCustomerType(c, e.target.value)}
                  style={{
                    background: "transparent",
                    border: "1px solid #E2E8F0",
                    borderRadius: 8,
                    padding: "4px 6px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#334155",
                    fontFamily: "inherit",
                    cursor: "pointer",
                    maxWidth: 150,
                  }}
                >
                  {CUSTOMER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                  {c.type && !CUSTOMER_TYPES.some((t) => t.value === c.type) && (
                    <option value={c.type}>{c.type}</option>
                  )}
                </select>
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
              <TD mono accent={c.openAR > 0 ? "#B45309" : "#64748B"}>
                {c.openARUpdated ? fmt(c.openAR || 0) : "--"}
              </TD>
              <TD>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    style={{ ...BS, padding: "5px 10px", fontSize: 11 }}
                    onClick={() => openView(c)}
                  >
                    View
                  </button>
                  <button
                    style={{ ...BS, padding: "5px 10px", fontSize: 11 }}
                    onClick={() => openEdit(c)}
                  >
                    Edit
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
          width={680}
        >
          <Field label="Customer Name">
            <input
              style={IS}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Company or person name"
            />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
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
            <Field label="Payment Terms (used on QBO invoices)">
              <select
                style={SS}
                value={form.paymentTerms}
                onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))}
              >
                {PAYMENT_TERMS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          </div>
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
          <Field label="Ship-To Address (used for ShipStation labels)">
            <textarea
              style={{ ...IS, minHeight: 50, resize: "vertical" }}
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="Street, City, State ZIP"
            />
            {!form.address.trim() && form.billToAddress.trim() && (
              <button
                onClick={() => setForm((f) => ({ ...f, address: f.billToAddress }))}
                style={{
                  marginTop: 6,
                  background: "#EFF6FF",
                  border: "1px solid #BFDBFE",
                  borderRadius: 6,
                  padding: "4px 12px",
                  color: "#1D4ED8",
                  fontWeight: 600,
                  fontSize: 11,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Copy from Bill-To (they receive at the same address)
              </button>
            )}
          </Field>
          <Field label="Bill-To Address (invoicing only -- never used for shipping)">
            <textarea
              style={{ ...IS, minHeight: 50, resize: "vertical" }}
              value={form.billToAddress}
              onChange={(e) => setForm((f) => ({ ...f, billToAddress: e.target.value }))}
              placeholder="Street, City, State ZIP"
            />
          </Field>
          <Field label="Notes">
            <textarea
              style={{ ...IS, minHeight: 60, resize: "vertical" }}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Internal notes about this customer..."
            />
          </Field>

          <Field label="Contacts">
            <div style={{ display: "grid", gap: 6 }}>
              {CONTACT_ROLES.map((r) => (
                <div
                  key={r.key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "72px 1fr 1fr 1fr",
                    gap: 6,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>
                    {r.label}
                  </span>
                  <input
                    style={{ ...IS, padding: "6px 8px", fontSize: 12 }}
                    value={form.contacts[r.key].name}
                    onChange={(e) => setContact(r.key, "name", e.target.value)}
                    placeholder="Name"
                  />
                  <input
                    style={{ ...IS, padding: "6px 8px", fontSize: 12 }}
                    type="email"
                    value={form.contacts[r.key].email}
                    onChange={(e) => setContact(r.key, "email", e.target.value)}
                    placeholder="Email"
                  />
                  <input
                    style={{ ...IS, padding: "6px 8px", fontSize: 12 }}
                    value={form.contacts[r.key].phone}
                    onChange={(e) => setContact(r.key, "phone", e.target.value)}
                    placeholder="Phone"
                  />
                </div>
              ))}
            </div>
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

      {/* Customer Detail Modal */}
      {viewing && (
        <Modal title={viewing.name} onClose={() => setViewingId(null)} width={760}>
          {/* Customer info */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px 18px",
              marginBottom: 18,
            }}
          >
            <div>
              <div style={SH}>Type</div>
              <Badge
                status={viewing.type || "dealer"}
                label={TYPE_LABEL[viewing.type] || viewing.type || "Dealer"}
              />
            </div>
            <div>
              <div style={SH}>Open AR</div>
              <span style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 13, color: viewing.openAR > 0 ? "#B45309" : "#374151" }}>
                {viewing.openARUpdated ? fmt(viewing.openAR || 0) : "--"}
              </span>
              {viewing.openARUpdated && (
                <span style={{ fontSize: 11, color: "#94A3B8", marginLeft: 8 }}>
                  synced {fmtTs(viewing.openARUpdated)}
                </span>
              )}
            </div>
            <div>
              <div style={SH}>Email</div>
              <span style={{ fontSize: 13, color: "#6D28D9" }}>{viewing.email || "--"}</span>
            </div>
            <div>
              <div style={SH}>Phone</div>
              <span style={{ fontSize: 13 }}>{viewing.phone || "--"}</span>
            </div>
            <div>
              <div style={SH}>Payment Terms</div>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{viewing.paymentTerms || "Net 30"}</span>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={SH}>Ship-To Address (ShipStation)</div>
              <span style={{ fontSize: 13, color: "#64748B" }}>{viewing.address || "--"}</span>
            </div>
            {viewing.billToAddress && (
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={SH}>Bill-To Address (invoicing only)</div>
                <span style={{ fontSize: 13, color: "#64748B" }}>{viewing.billToAddress}</span>
              </div>
            )}
          </div>

          {/* Notes */}
          {viewing.notes && (
            <div style={{ marginBottom: 18 }}>
              <div style={SH}>Notes</div>
              <div
                style={{
                  background: "#F8FAFC",
                  border: "1px solid #E2E8F0",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 13,
                  color: "#374151",
                  whiteSpace: "pre-wrap",
                }}
              >
                {viewing.notes}
              </div>
            </div>
          )}

          {/* Contacts */}
          {filledContacts.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={SH}>Contacts</div>
              <div
                style={{
                  border: "1px solid #E2E8F0",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                {filledContacts.map((r, idx) => (
                  <div
                    key={r.key}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "90px 1fr 1fr 1fr",
                      gap: 8,
                      padding: "8px 12px",
                      fontSize: 12,
                      background: idx % 2 === 0 ? "transparent" : "#FAFAFA",
                      borderTop: idx > 0 ? "1px solid #F1F5F9" : "none",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: "#64748B" }}>{r.label}</span>
                    <span style={{ fontWeight: 600, color: "#0F172A" }}>
                      {r.contact.name || "--"}
                    </span>
                    <span style={{ color: "#6D28D9" }}>{r.contact.email || "--"}</span>
                    <span style={{ color: "#374151" }}>{r.contact.phone || "--"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dealers / Ship-To Accounts */}
          <div style={{ marginBottom: 18 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <div style={{ ...SH, margin: 0 }}>
                Dealers / Ship-To Accounts ({(viewing.subAccounts || []).length})
              </div>
              <button
                style={{ ...BAq, padding: "5px 12px", fontSize: 12 }}
                onClick={() => dealerFileRef.current?.click()}
              >
                Import CSV
              </button>
              <input
                ref={dealerFileRef}
                type="file"
                accept=".csv"
                style={{ display: "none" }}
                onChange={handleDealerImport}
              />
            </div>
            {dealerImportMsg && (
              <div
                style={{
                  background: dealerImportMsg.success ? "#F0FDF4" : "#FEF2F2",
                  border: `1px solid ${dealerImportMsg.success ? "#BBF7D0" : "#FECACA"}`,
                  borderRadius: 8,
                  padding: "8px 12px",
                  marginBottom: 8,
                  fontSize: 12,
                  color: dealerImportMsg.success ? "#15803D" : "#DC2626",
                  fontWeight: 600,
                }}
              >
                {dealerImportMsg.message || dealerImportMsg.error}
              </div>
            )}
            {(viewing.subAccounts || []).length === 0 ? (
              <div style={{ fontSize: 12, color: "#94A3B8" }}>
                No dealer accounts on file. Import a CSV from the distributor to add them.
              </div>
            ) : (
              <div
                style={{
                  border: "1px solid #E2E8F0",
                  borderRadius: 8,
                  overflow: "hidden",
                  maxHeight: 220,
                  overflowY: "auto",
                }}
              >
                {(viewing.subAccounts || []).map((s, idx) => (
                  <div
                    key={s.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "7px 12px",
                      fontSize: 12,
                      background: idx % 2 === 0 ? "transparent" : "#FAFAFA",
                      borderTop: idx > 0 ? "1px solid #F1F5F9" : "none",
                    }}
                  >
                    <span style={{ fontWeight: 600, color: "#0F172A" }}>{s.name}</span>
                    <span style={{ color: "#64748B", textAlign: "right" }}>
                      {s.address || "--"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Orders YTD */}
          <div>
            <div style={SH}>Orders YTD ({new Date().getFullYear()})</div>
            <div
              style={{
                display: "flex",
                gap: 18,
                marginBottom: 10,
                fontSize: 13,
                color: "#374151",
              }}
            >
              <span>
                <span style={{ fontWeight: 700 }}>{fmtNum(ytdTotals.orders)}</span> order
                {ytdTotals.orders !== 1 ? "s" : ""}
              </span>
              <span>
                <span style={{ fontWeight: 700 }}>{fmtNum(ytdTotals.units)}</span> units
              </span>
              <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#15803D" }}>
                {fmt(ytdTotals.revenue)}
              </span>
            </div>
            <Table
              headers={["Order #", "Date", "Stage", "Units", "Value"]}
              empty={ytdOrders.length === 0 ? "No orders this year." : null}
            >
              {ytdOrders.map((o, i) => {
                const units = o.lines.reduce((s, l) => s + l.qty, 0);
                const value = o.lines.reduce((s, l) => s + l.qty * l.price, 0);
                return (
                  <TR key={o.id} i={i}>
                    <TD mono>{o.orderNum}</TD>
                    <TD>{fmtDate(o.date)}</TD>
                    <TD>
                      <Badge
                        status={o.fulfillmentStage}
                        label={STAGE_LABEL[o.fulfillmentStage] || o.fulfillmentStage}
                      />
                    </TD>
                    <TD>{fmtNum(units)}</TD>
                    <TD mono accent="#15803D">
                      {fmt(value)}
                    </TD>
                  </TR>
                );
              })}
            </Table>
          </div>

          {/* Imported sales history */}
          {hist && hist.orders > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={SH}>
                Sales History ({hist.first ? fmtDate(hist.first) : "?"} &ndash;{" "}
                {hist.last ? fmtDate(hist.last) : "?"})
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 18,
                  marginBottom: 10,
                  fontSize: 13,
                  color: "#374151",
                  flexWrap: "wrap",
                }}
              >
                <span>
                  <span style={{ fontWeight: 700 }}>{fmtNum(hist.orders)}</span> order
                  {hist.orders !== 1 ? "s" : ""}
                </span>
                <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#15803D" }}>
                  {fmt(hist.revenue)} revenue
                </span>
                {hist.fillRate != null && (
                  <span>
                    <span style={{ fontWeight: 700 }}>{(hist.fillRate * 100).toFixed(1)}%</span>{" "}
                    historical fill rate (invoiced vs PO)
                  </span>
                )}
              </div>
              <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid #E2E8F0", borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#F8FAFC", position: "sticky", top: 0 }}>
                      {["Date", "PO#", "Invoice#", "PO Amt", "Invoiced", "Fill"].map((h) => (
                        <th key={h} style={{ padding: "7px 10px", textAlign: h === "Date" || h === "PO#" || h === "Invoice#" ? "left" : "right", fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...hist.rows]
                      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
                      .map((h, i) => (
                        <tr key={h.id || i} style={{ borderTop: "1px solid #F1F5F9", background: i % 2 === 0 ? "transparent" : "#FAFAFA" }}>
                          <td style={{ padding: "6px 10px" }}>{h.date ? fmtDate(h.date) : "--"}</td>
                          <td style={{ padding: "6px 10px", fontFamily: "monospace", color: "#6D28D9" }}>{h.poRef || "--"}</td>
                          <td style={{ padding: "6px 10px", fontFamily: "monospace", color: "#64748B" }}>{h.invoiceNum || "--"}</td>
                          <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "monospace" }}>{fmt(h.poAmount)}</td>
                          <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "monospace", color: "#15803D" }}>
                            {h.invoiceAmount != null ? fmt(h.invoiceAmount) : "--"}
                          </td>
                          <td style={{ padding: "6px 10px", textAlign: "right", color: "#64748B" }}>
                            {h.invoiceAmount != null && h.poAmount > 0
                              ? `${Math.round((h.invoiceAmount / h.poAmount) * 100)}%`
                              : "--"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
            <button
              style={BS}
              onClick={() => {
                setViewingId(null);
                openEdit(viewing);
              }}
            >
              Edit Customer
            </button>
            <button style={BP} onClick={() => setViewingId(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
