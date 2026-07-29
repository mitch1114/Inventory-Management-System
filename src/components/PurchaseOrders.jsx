import { useState, useMemo } from "react";
import { LOCKING } from "../lib/constants";
import { autoAllocate } from "../lib/inventory";
import { uid, fmt, fmtNum, fmtDate, nowIso } from "../lib/utils";
import { LANDED_COST_TYPES } from "../lib/landedCost";
import { Badge, Modal, Field, Table, TR, TD, IS, SS, BP, BS, BD, BG, BAq } from "./ui";
import SupplierPOImport from "./SupplierPOImport";
import ReceivingModal from "./ReceivingModal";

// --- Helpers -----------------------------------------------------------------
const blank = () => ({
  supplierId: "",
  date: new Date().toISOString().slice(0, 10),
  expectedDate: "",
  status: "ordered",
  lines: [],
  notes: "",
});

const blankLine = () => ({ productId: "", qty: 1, cost: 0 });

// --- Component ---------------------------------------------------------------
export default function PurchaseOrders({ data, setData }) {
  const [editing, setEditing] = useState(null); // null | "new" | po object
  const [form, setForm] = useState(blank());
  const [allocResult, setAllocResult] = useState(null);
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [receiving, setReceiving] = useState(null); // PO being received
  const [viewing, setViewing] = useState(null); // PO shown in detail popup

  // Derived lookups
  const prodMap = useMemo(
    () => Object.fromEntries(data.products.map((p) => [p.id, p])),
    [data.products],
  );
  const suppMap = useMemo(
    () => Object.fromEntries(data.suppliers.map((s) => [s.id, s])),
    [data.suppliers],
  );

  // Filtered list
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.purchaseOrders.filter((po) => {
      const supp = suppMap[po.supplierId];
      return (
        !q ||
        po.orderNum.toLowerCase().includes(q) ||
        (supp && supp.name.toLowerCase().includes(q)) ||
        po.status.toLowerCase().includes(q) ||
        (po.notes || "").toLowerCase().includes(q)
      );
    });
  }, [data.purchaseOrders, suppMap, search]);

  // --- Open create / edit ----------------------------------------------------
  const openNew = () => {
    setForm(blank());
    setEditing("new");
  };
  const openEdit = (po) => {
    setForm({
      supplierId: po.supplierId,
      date: po.date,
      expectedDate: po.expectedDate || "",
      status: po.status,
      lines: po.lines.map((l) => ({ ...l })),
      notes: po.notes || "",
    });
    setEditing(po);
  };

  // --- Save ------------------------------------------------------------------
  const save = () => {
    const lineTotal = form.lines.reduce((s, l) => s + l.qty * l.cost, 0);
    if (editing === "new") {
      const num = (data.counters.po || 0) + 1;
      const po = {
        id: uid(),
        orderNum: `PO-${String(num).padStart(4, "0")}`,
        ...form,
        lines: form.lines.filter((l) => l.productId),
      };
      setData((d) => ({
        ...d,
        purchaseOrders: [...d.purchaseOrders, po],
        counters: { ...d.counters, po: num },
        auditLog: [
          ...(d.auditLog || []),
          {
            id: uid(),
            ts: nowIso(),
            type: "ordered",
            entity: po.orderNum,
            description: `Created ${po.orderNum} -- ${suppMap[po.supplierId]?.name || "Unknown"} -- ${fmt(lineTotal)}`,
          },
        ],
      }));
    } else {
      setData((d) => ({
        ...d,
        purchaseOrders: d.purchaseOrders.map((p) =>
          p.id === editing.id
            ? { ...p, ...form, lines: form.lines.filter((l) => l.productId) }
            : p,
        ),
        auditLog: [
          ...(d.auditLog || []),
          {
            id: uid(),
            ts: nowIso(),
            type: "adjustment",
            entity: editing.orderNum,
            description: `Updated ${editing.orderNum}`,
          },
        ],
      }));
    }
    setEditing(null);
  };

  // --- Receive PO (opens modal) -----------------------------------------------
  const receivePO = (po) => setReceiving(po);

  // --- Delete ----------------------------------------------------------------
  const deletePO = (po) => {
    if (!confirm(`Delete ${po.orderNum}?`)) return;
    setData((d) => ({
      ...d,
      purchaseOrders: d.purchaseOrders.filter((p) => p.id !== po.id),
      auditLog: [
        ...(d.auditLog || []),
        {
          id: uid(),
          ts: nowIso(),
          type: "adjustment",
          entity: po.orderNum,
          description: `Deleted ${po.orderNum}`,
        },
      ],
    }));
  };

  // --- Line helpers ----------------------------------------------------------
  const setLine = (idx, patch) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }));
  const removeLine = (idx) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));

  // --- Render ----------------------------------------------------------------
  const formTotal = form.lines.reduce((s, l) => s + l.qty * l.cost, 0);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>
            Supplier POs
          </h2>
          <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 13 }}>
            {data.purchaseOrders.length} supplier PO{data.purchaseOrders.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            style={{ ...IS, width: 220 }}
            placeholder="Search POs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button style={BAq} onClick={() => setShowImport(true)}>
            Import Supplier PO
          </button>
          <button style={BP} onClick={openNew}>
            + New PO
          </button>
        </div>
      </div>

      {/* Allocation result banner */}
      {allocResult && (
        <div
          style={{
            background: "#F0FDF4",
            border: "1px solid #BBF7D0",
            borderRadius: 10,
            padding: "12px 18px",
            marginBottom: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 14,
            color: "#15803D",
            fontWeight: 600,
          }}
        >
          <span>{allocResult}</span>
          <button
            style={{ ...BS, padding: "5px 12px", fontSize: 12 }}
            onClick={() => setAllocResult(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* PO Table */}
      <Table
        headers={["PO #", "Supplier", "Date", "Expected", "Status", "Lines", "Total", "Actions"]}
        empty={filtered.length === 0 ? "No purchase orders found." : null}
      >
        {filtered.map((po, i) => {
          const supp = suppMap[po.supplierId];
          const total = po.lines.reduce((s, l) => s + l.qty * l.cost, 0);
          const totalUnits = po.lines.reduce((s, l) => s + l.qty, 0);
          return (
            <TR key={po.id} i={i}>
              <TD mono accent="#6D28D9">
                <span
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                  onClick={() => setViewing(po)}
                >
                  {po.orderNum}
                </span>
              </TD>
              <TD>{supp ? supp.name : "--"}</TD>
              <TD>{fmtDate(po.date)}</TD>
              <TD>{po.expectedDate ? fmtDate(po.expectedDate) : "--"}</TD>
              <TD>
                <Badge status={po.status} label={po.status} />
              </TD>
              <TD>
                {po.lines.length} item{po.lines.length !== 1 ? "s" : ""} &middot;{" "}
                {fmtNum(totalUnits)} units
              </TD>
              <TD mono>{fmt(total)}</TD>
              <TD>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    style={{ ...BS, padding: "5px 10px", fontSize: 11 }}
                    onClick={() => setViewing(po)}
                  >
                    View
                  </button>
                  <button
                    style={{ ...BS, padding: "5px 10px", fontSize: 11 }}
                    onClick={() => openEdit(po)}
                  >
                    Edit
                  </button>
                  {(po.status === "ordered" || po.status === "partial") && (
                    <button
                      style={{ ...BG, padding: "5px 10px", fontSize: 11 }}
                      onClick={() => receivePO(po)}
                    >
                      Receive
                    </button>
                  )}
                  <button
                    style={{ ...BD, padding: "5px 10px", fontSize: 11 }}
                    onClick={() => deletePO(po)}
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
          title={editing === "new" ? "New Purchase Order" : `Edit ${editing.orderNum}`}
          onClose={() => setEditing(null)}
          width={780}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
            <Field label="Supplier">
              <select
                style={SS}
                value={form.supplierId}
                onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}
              >
                <option value="">-- select --</option>
                {data.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                style={SS}
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              >
                <option value="ordered">Ordered</option>
                <option value="partial">Partial</option>
                <option value="received">Received</option>
              </select>
            </Field>
            <Field label="Order Date">
              <input
                style={IS}
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </Field>
            <Field label="Expected Date">
              <input
                style={IS}
                type="date"
                value={form.expectedDate}
                onChange={(e) => setForm((f) => ({ ...f, expectedDate: e.target.value }))}
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              style={{ ...IS, minHeight: 50, resize: "vertical" }}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>

          {/* Lines */}
          <div
            style={{
              fontWeight: 700,
              fontSize: 12,
              color: "#64748B",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginBottom: 8,
              marginTop: 4,
            }}
          >
            Line Items
          </div>

          {form.lines.map((line, idx) => {
            const prod = prodMap[line.productId];
            return (
              <div
                key={idx}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 80px 100px auto",
                  gap: 8,
                  marginBottom: 6,
                  alignItems: "center",
                }}
              >
                <select
                  style={{ ...SS, fontSize: 12 }}
                  value={line.productId}
                  onChange={(e) => {
                    const p = prodMap[e.target.value];
                    setLine(idx, {
                      productId: e.target.value,
                      cost: p ? p.costPrice : 0,
                    });
                  }}
                >
                  <option value="">-- product --</option>
                  {data.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} -- {p.name}
                    </option>
                  ))}
                </select>
                <input
                  style={{ ...IS, fontSize: 12 }}
                  type="number"
                  min="1"
                  placeholder="Qty"
                  value={line.qty}
                  onChange={(e) => setLine(idx, { qty: Math.max(1, +e.target.value || 1) })}
                />
                <input
                  style={{ ...IS, fontSize: 12 }}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Cost"
                  value={line.cost}
                  onChange={(e) => setLine(idx, { cost: +e.target.value || 0 })}
                />
                <button
                  style={{ ...BD, padding: "6px 10px", fontSize: 11 }}
                  onClick={() => removeLine(idx)}
                >
                  &times;
                </button>
              </div>
            );
          })}

          <button style={{ ...BS, fontSize: 12, marginTop: 4 }} onClick={addLine}>
            + Add Line
          </button>

          <div
            style={{
              textAlign: "right",
              fontSize: 14,
              fontWeight: 700,
              color: "#0F172A",
              marginTop: 12,
            }}
          >
            Total: {fmt(formTotal)}
          </div>

          {/* Footer */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
            <button style={BS} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button style={BP} onClick={save} disabled={!form.supplierId}>
              {editing === "new" ? "Create PO" : "Save Changes"}
            </button>
          </div>
        </Modal>
      )}

      {/* PO Detail Popup */}
      {viewing &&
        (() => {
          const supp = suppMap[viewing.supplierId];
          const rows = viewing.lines.map((l) => {
            const prod = prodMap[l.productId];
            const ordered = l.qty || 0;
            const received = l.qtyReceived || 0;
            return {
              sku: prod ? prod.sku : l.sku || "--",
              name: prod ? prod.name : l.desc || "--",
              ordered,
              received,
              remaining: Math.max(0, ordered - received),
              cost: l.cost || 0,
              landed: l.landedUnitCost,
              ext: ordered * (l.cost || 0),
            };
          });
          const totals = rows.reduce(
            (t, r) => ({
              ordered: t.ordered + r.ordered,
              received: t.received + r.received,
              remaining: t.remaining + r.remaining,
              ext: t.ext + r.ext,
            }),
            { ordered: 0, received: 0, remaining: 0, ext: 0 },
          );
          const landedEntries = (viewing.landedCosts || []).filter(
            (c) => (parseFloat(c.amount) || 0) > 0,
          );
          const landedLabel = Object.fromEntries(
            LANDED_COST_TYPES.map((t) => [t.value, t.label]),
          );
          const lbl = {
            fontSize: 11,
            fontWeight: 600,
            color: "#64748B",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            marginBottom: 4,
          };
          const val = { fontSize: 13, color: "#0F172A", fontWeight: 600 };
          const canReceive = viewing.status === "ordered" || viewing.status === "partial";
          return (
            <Modal
              title={`Purchase Order ${viewing.orderNum}`}
              onClose={() => setViewing(null)}
              width={860}
            >
              {/* Header info */}
              <div
                style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}
              >
                <span
                  style={{
                    fontFamily: "monospace",
                    fontWeight: 800,
                    fontSize: 16,
                    color: "#6D28D9",
                  }}
                >
                  {viewing.orderNum}
                </span>
                <Badge status={viewing.status} label={viewing.status} />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: "0 18px",
                  marginBottom: 14,
                }}
              >
                <div>
                  <div style={lbl}>Supplier</div>
                  <div style={val}>{supp ? supp.name : "--"}</div>
                </div>
                <div>
                  <div style={lbl}>Order Date</div>
                  <div style={val}>{fmtDate(viewing.date)}</div>
                </div>
                <div>
                  <div style={lbl}>Expected</div>
                  <div style={val}>
                    {viewing.expectedDate ? fmtDate(viewing.expectedDate) : "--"}
                  </div>
                </div>
                {viewing.receivedDate && (
                  <div>
                    <div style={lbl}>Received</div>
                    <div style={val}>{fmtDate(viewing.receivedDate)}</div>
                  </div>
                )}
              </div>

              {viewing.notes && (
                <div style={{ marginBottom: 14 }}>
                  <div style={lbl}>Notes</div>
                  <div style={{ fontSize: 13, color: "#374151" }}>{viewing.notes}</div>
                </div>
              )}

              {/* Landed cost summary */}
              {(landedEntries.length > 0 || viewing.landedTotal > 0) && (
                <div
                  style={{
                    background: "#F5F3FF",
                    border: "1px solid #DDD6FE",
                    borderRadius: 8,
                    padding: "8px 12px",
                    marginBottom: 14,
                    fontSize: 12,
                    color: "#5B21B6",
                  }}
                >
                  <strong>Landed costs:</strong>{" "}
                  {landedEntries
                    .map(
                      (c) =>
                        `${landedLabel[c.type] || c.type} ${fmt(parseFloat(c.amount) || 0)}`,
                    )
                    .join(" · ")}
                  {landedEntries.length > 0 ? " -- " : ""}
                  total <strong>{fmt(viewing.landedTotal || 0)}</strong> allocated across
                  received units
                </div>
              )}

              {/* Line items */}
              <Table
                headers={[
                  "SKU",
                  "Product",
                  "Ordered",
                  "Received",
                  "Remaining",
                  "Unit Cost",
                  "Landed Unit",
                  "Ext",
                ]}
                empty={rows.length === 0 ? "No line items on this PO." : null}
              >
                {rows.map((r, i) => (
                  <TR key={i} i={i}>
                    <TD mono>{r.sku}</TD>
                    <TD>{r.name}</TD>
                    <TD mono>{fmtNum(r.ordered)}</TD>
                    <TD mono>{fmtNum(r.received)}</TD>
                    <TD mono>{fmtNum(r.remaining)}</TD>
                    <TD mono>{fmt(r.cost)}</TD>
                    <TD mono>{r.landed != null ? fmt(r.landed) : "--"}</TD>
                    <TD mono>{fmt(r.ext)}</TD>
                  </TR>
                ))}
                {rows.length > 0 && (
                  <TR i={rows.length}>
                    <TD s={{ fontWeight: 700, color: "#0F172A" }}>Totals</TD>
                    <TD />
                    <TD mono s={{ fontWeight: 700, color: "#0F172A" }}>
                      {fmtNum(totals.ordered)}
                    </TD>
                    <TD mono s={{ fontWeight: 700, color: "#0F172A" }}>
                      {fmtNum(totals.received)}
                    </TD>
                    <TD mono s={{ fontWeight: 700, color: "#0F172A" }}>
                      {fmtNum(totals.remaining)}
                    </TD>
                    <TD />
                    <TD />
                    <TD mono s={{ fontWeight: 700, color: "#0F172A" }}>
                      {fmt(totals.ext)}
                    </TD>
                  </TR>
                )}
              </Table>

              {/* Footer */}
              <div
                style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}
              >
                <button style={BS} onClick={() => setViewing(null)}>
                  Close
                </button>
                {canReceive && (
                  <button
                    style={BG}
                    onClick={() => {
                      setViewing(null);
                      receivePO(viewing);
                    }}
                  >
                    Receive Items
                  </button>
                )}
              </div>
            </Modal>
          );
        })()}

      {/* Supplier PO Import */}
      {showImport && (
        <SupplierPOImport
          data={data}
          setData={setData}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* Receiving Modal */}
      {receiving && (
        <ReceivingModal
          po={receiving}
          data={data}
          setData={setData}
          onClose={() => setReceiving(null)}
          onResult={(msg) => setAllocResult(msg)}
        />
      )}
    </div>
  );
}
