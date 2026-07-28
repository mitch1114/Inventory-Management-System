import { useState, useMemo, useRef } from "react";
import { LOCKING } from "../lib/constants";
import { computeInventory } from "../lib/inventory";
import { uid, fmt, fmtNum, fmtDate, nowIso, toCSV, dlCSV, parseCSV } from "../lib/utils";
import { Badge, Modal, Field, Table, TR, TD, IS, SS, BP, BS, BD } from "./ui";

// =============================================================================
// AdjPreview -- shows the live preview of a stock adjustment before applying
// =============================================================================
function AdjPreview({ adjQty, adjMode, onHand }) {
  const qty = Math.abs(adjQty) || 0;
  if (qty === 0) return null;

  const after =
    adjMode === "set"
      ? qty
      : adjMode === "remove"
        ? Math.max(0, onHand - qty)
        : onHand + qty;

  const delta = after - onHand;
  const color = delta > 0 ? "#15803D" : delta < 0 ? "#DC2626" : "#64748B";

  return (
    <div
      style={{
        background: "#F8FAFC",
        border: "1px solid #E2E8F0",
        borderRadius: 10,
        padding: "10px 14px",
        marginTop: 10,
      }}
    >
      <div style={{ fontSize: 11, color: "#64748B", fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Preview
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div>
          <span style={{ fontSize: 13, color: "#64748B" }}>Current: </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>{fmtNum(onHand)}</span>
        </div>
        <span style={{ color: "#94A3B8" }}>&rarr;</span>
        <div>
          <span style={{ fontSize: 13, color: "#64748B" }}>After: </span>
          <span style={{ fontSize: 14, fontWeight: 700, color }}>{fmtNum(after)}</span>
        </div>
        <div style={{ fontSize: 12, color, fontWeight: 600 }}>
          ({delta >= 0 ? "+" : ""}{fmtNum(delta)})
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// SkuDrawer -- detail panel for a single product / SKU
// =============================================================================
function SkuDrawer({ product, data, setData, onClose, onEdit }) {
  const [tab, setTab] = useState("stock");
  const [adjQty, setAdjQty] = useState(0);
  const [adjMode, setAdjMode] = useState("add"); // add | remove | set
  const [adjReason, setAdjReason] = useState("");

  // Compute live inventory for this product
  const computed = useMemo(
    () => computeInventory(data.products, data.salesOrders).find((p) => p.id === product.id) || product,
    [data.products, data.salesOrders, product.id],
  );

  // Orders that reference this SKU
  const relatedOrders = useMemo(
    () =>
      data.salesOrders.filter((o) =>
        o.lines.some((l) => l.productId === product.id),
      ),
    [data.salesOrders, product.id],
  );

  // Locked orders (confirmed/picked/booked)
  const lockedOrders = relatedOrders.filter((o) => LOCKING.has(o.fulfillmentStage));

  // Audit history for this product
  const history = useMemo(
    () =>
      (data.auditLog || [])
        .filter(
          (a) =>
            (a.entity || "").includes(product.sku) ||
            (a.description || "").includes(product.sku) ||
            (a.description || "").includes(product.name),
        )
        .reverse(),
    [data.auditLog, product.sku, product.name],
  );

  // Apply stock adjustment
  const applyAdj = () => {
    const qty = Math.abs(adjQty) || 0;
    if (qty === 0) return;

    const newOnHand =
      adjMode === "set"
        ? qty
        : adjMode === "remove"
          ? Math.max(0, product.onHand - qty)
          : product.onHand + qty;

    const delta = newOnHand - product.onHand;
    const desc = `Stock adjustment on ${product.sku}: ${product.onHand} -> ${newOnHand} (${delta >= 0 ? "+" : ""}${delta}) ${adjReason ? "-- " + adjReason : ""}`.trim();

    setData((d) => ({
      ...d,
      products: d.products.map((p) =>
        p.id === product.id ? { ...p, onHand: newOnHand } : p,
      ),
      auditLog: [
        ...(d.auditLog || []),
        {
          id: uid(),
          ts: nowIso(),
          type: "adjustment",
          entity: product.sku,
          description: desc,
        },
      ],
    }));

    setAdjQty(0);
    setAdjReason("");
  };

  const tabStyle = (t) => ({
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    color: tab === t ? "#6D28D9" : "#64748B",
    background: tab === t ? "#F5F3FF" : "transparent",
    border: tab === t ? "1px solid #DDD6FE" : "1px solid transparent",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: "inherit",
  });

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: 520,
        height: "100vh",
        background: "#FFFFFF",
        borderLeft: "1px solid #E2E8F0",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.08)",
        zIndex: 999,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
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
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ fontSize: 11, fontFamily: "monospace", color: "#6D28D9", fontWeight: 700 }}>
            {product.sku}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", marginTop: 2 }}>
            {product.name}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ ...BS, padding: "6px 14px", fontSize: 12 }} onClick={onEdit}>
            Edit
          </button>
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
      </div>

      {/* Inventory summary strip */}
      <div
        style={{
          padding: "14px 22px",
          background: "#F8FAFC",
          borderBottom: "1px solid #E2E8F0",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 8,
          flexShrink: 0,
        }}
      >
        {[
          { label: "On Hand", value: fmtNum(computed.onHand), color: "#0F172A" },
          { label: "Locked", value: computed.locked > 0 ? `-${fmtNum(computed.locked)}` : "--", color: computed.locked > 0 ? "#EAB308" : "#94A3B8" },
          { label: "Backordered", value: computed.backordered > 0 ? fmtNum(computed.backordered) : "--", color: computed.backordered > 0 ? "#F97316" : "#94A3B8" },
          { label: "Available", value: fmtNum(computed.available), color: computed.available === 0 ? "#DC2626" : computed.available <= product.reorderPoint ? "#854D0E" : "#15803D" },
        ].map((s) => (
          <div key={s.label}>
            <div style={{ fontSize: 10, color: "#64748B", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {s.label}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: s.color, marginTop: 2 }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ padding: "10px 22px 0", display: "flex", gap: 6, flexShrink: 0 }}>
        <button style={tabStyle("stock")} onClick={() => setTab("stock")}>
          Stock
        </button>
        <button style={tabStyle("orders")} onClick={() => setTab("orders")}>
          Orders ({relatedOrders.length})
        </button>
        <button style={tabStyle("history")} onClick={() => setTab("history")}>
          History
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 22px" }}>
        {/* ----- STOCK TAB ----- */}
        {tab === "stock" && (
          <div>
            {/* Product details */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 18,
              }}
            >
              <div>
                <div style={{ fontSize: 10, color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>Category</div>
                <div style={{ fontSize: 13, color: "#0F172A", marginTop: 2 }}>{product.category || "--"}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>Supplier</div>
                <div style={{ fontSize: 13, color: "#0F172A", marginTop: 2 }}>
                  {(data.suppliers.find((s) => s.id === product.supplier) || {}).name || "--"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>Cost Price</div>
                <div style={{ fontSize: 13, color: "#0F172A", marginTop: 2 }}>{fmt(product.costPrice)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>Sell Price</div>
                <div style={{ fontSize: 13, color: "#0F172A", marginTop: 2 }}>{fmt(product.sellPrice)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>Reorder Point</div>
                <div style={{ fontSize: 13, color: "#0F172A", marginTop: 2 }}>{fmtNum(product.reorderPoint)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>Reorder Qty</div>
                <div style={{ fontSize: 13, color: "#0F172A", marginTop: 2 }}>{fmtNum(product.reorderQty)}</div>
              </div>
            </div>

            {/* Lock stock info */}
            {lockedOrders.length > 0 && (
              <div
                style={{
                  background: "#FEFCE8",
                  border: "1px solid #FDE68A",
                  borderRadius: 10,
                  padding: "10px 14px",
                  marginBottom: 14,
                  fontSize: 12,
                  color: "#854D0E",
                }}
              >
                <strong>{fmtNum(computed.locked)} units locked</strong> across{" "}
                {lockedOrders.length} order{lockedOrders.length !== 1 ? "s" : ""} in pipeline
                {lockedOrders.map((o) => (
                  <div key={o.id} style={{ marginTop: 4, fontSize: 11 }}>
                    {o.orderNum} &middot; {o.customer} &middot;{" "}
                    <Badge status={o.fulfillmentStage} label={o.fulfillmentStage} />
                    {" "}&middot; {o.lines.filter((l) => l.productId === product.id).reduce((s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty), 0)} units
                  </div>
                ))}
              </div>
            )}

            {/* Stock adjustment */}
            <div
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                borderRadius: 12,
                padding: "14px 16px",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Stock Adjustment
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Mode">
                  <select
                    style={SS}
                    value={adjMode}
                    onChange={(e) => setAdjMode(e.target.value)}
                  >
                    <option value="add">Add</option>
                    <option value="remove">Remove</option>
                    <option value="set">Set to</option>
                  </select>
                </Field>
                <Field label="Quantity">
                  <input
                    style={IS}
                    type="number"
                    min="0"
                    value={adjQty}
                    onChange={(e) => setAdjQty(Math.max(0, +e.target.value || 0))}
                  />
                </Field>
              </div>
              <Field label="Reason (optional)">
                <input
                  style={IS}
                  placeholder="e.g. Cycle count, damage, receiving..."
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                />
              </Field>
              <AdjPreview adjQty={adjQty} adjMode={adjMode} onHand={product.onHand} />
              <div style={{ marginTop: 12, textAlign: "right" }}>
                <button
                  style={{ ...BP, opacity: adjQty > 0 ? 1 : 0.5 }}
                  disabled={!adjQty}
                  onClick={applyAdj}
                >
                  Apply Adjustment
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ----- ORDERS TAB ----- */}
        {tab === "orders" && (
          <div>
            {relatedOrders.length === 0 ? (
              <div style={{ color: "#94A3B8", fontSize: 13, textAlign: "center", padding: 30 }}>
                No orders reference this SKU.
              </div>
            ) : (
              relatedOrders.map((o) => {
                const lines = o.lines.filter((l) => l.productId === product.id);
                const totalQty = lines.reduce((s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty), 0);
                const totalBO = lines.reduce((s, l) => s + (l.qtyBackordered != null ? l.qtyBackordered : 0), 0);
                return (
                  <div
                    key={o.id}
                    style={{
                      background: "#FFFFFF",
                      border: "1px solid #E2E8F0",
                      borderRadius: 10,
                      padding: "12px 14px",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#6D28D9", fontFamily: "monospace" }}>
                        {o.orderNum}
                      </span>
                      <Badge status={o.fulfillmentStage} label={o.fulfillmentStage} />
                    </div>
                    <div style={{ fontSize: 13, color: "#0F172A", fontWeight: 600 }}>{o.customer}</div>
                    <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
                      {fmtDate(o.date)} &middot; {fmtNum(totalQty)} units
                      {totalBO > 0 && (
                        <span style={{ color: "#F97316" }}> &middot; {fmtNum(totalBO)} backordered</span>
                      )}
                      {LOCKING.has(o.fulfillmentStage) && (
                        <span style={{ color: "#EAB308" }}> &middot; locked</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ----- HISTORY TAB ----- */}
        {tab === "history" && (
          <div>
            {history.length === 0 ? (
              <div style={{ color: "#94A3B8", fontSize: 13, textAlign: "center", padding: 30 }}>
                No audit history for this SKU.
              </div>
            ) : (
              history.map((a) => (
                <div
                  key={a.id}
                  style={{
                    padding: "8px 0",
                    borderBottom: "1px solid #F1F5F9",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "#475569", flex: 1 }}>{a.description}</span>
                    <Badge status={a.type} label={a.type.replace(/-/g, " ")} />
                  </div>
                  <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 2 }}>
                    {new Date(a.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Products -- main Products & Inventory page
// =============================================================================
const blankProduct = () => ({
  sku: "",
  upc: "",
  name: "",
  category: "",
  costPrice: 0,
  landedCost: 0,
  sellPrice: 0,
  onHand: 0,
  reorderPoint: 0,
  reorderQty: 0,
  supplier: "",
});

export default function Products({ data, setData }) {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [editing, setEditing] = useState(null); // null | "new" | product object
  const [form, setForm] = useState(blankProduct());
  const [drawerProduct, setDrawerProduct] = useState(null);
  const [importModal, setImportModal] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const fileRef = useRef(null);

  // Compute inventory
  const computedProds = useMemo(
    () => computeInventory(data.products, data.salesOrders),
    [data.products, data.salesOrders],
  );

  // productId -> earliest expected arrival date from open supplier POs
  const onOrderDates = useMemo(() => {
    const m = {};
    (data.purchaseOrders || []).forEach((po) => {
      if (po.status !== "ordered" && po.status !== "partial") return;
      (po.lines || []).forEach((l) => {
        if (!l.productId) return;
        const remaining = l.qty - (l.qtyReceived || 0);
        if (remaining <= 0) return;
        const d = po.expectedDate || "";
        if (!m[l.productId] || (d && d < m[l.productId])) m[l.productId] = d || m[l.productId] || "";
      });
    });
    return m;
  }, [data.purchaseOrders]);

  // Category list
  const categories = useMemo(
    () => [...new Set(data.products.map((p) => p.category).filter(Boolean))].sort(),
    [data.products],
  );

  // Filtered + searched products
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return computedProds.filter((p) => {
      if (catFilter && p.category !== catFilter) return false;
      if (!q) return true;
      return [p.sku, p.name, p.category].some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [computedProds, search, catFilter]);

  // Product map for lookups
  const prodMap = useMemo(
    () => Object.fromEntries(data.products.map((p) => [p.id, p])),
    [data.products],
  );

  // --- CRUD ------------------------------------------------------------------
  const openNew = () => {
    setForm(blankProduct());
    setEditing("new");
  };

  const openEdit = (p) => {
    setForm({
      sku: p.sku,
      upc: p.upc || "",
      name: p.name,
      category: p.category || "",
      costPrice: p.costPrice || 0,
      landedCost: p.landedCost || 0,
      sellPrice: p.sellPrice || 0,
      onHand: p.onHand || 0,
      reorderPoint: p.reorderPoint || 0,
      reorderQty: p.reorderQty || 0,
      supplier: p.supplier || "",
    });
    setEditing(p);
  };

  const save = () => {
    if (editing === "new") {
      const prod = { id: uid(), ...form };
      setData((d) => ({
        ...d,
        products: [...d.products, prod],
        auditLog: [
          ...(d.auditLog || []),
          {
            id: uid(),
            ts: nowIso(),
            type: "adjustment",
            entity: form.sku,
            description: `Created product ${form.sku} -- ${form.name}`,
          },
        ],
      }));
    } else {
      setData((d) => ({
        ...d,
        products: d.products.map((p) => (p.id === editing.id ? { ...p, ...form } : p)),
        auditLog: [
          ...(d.auditLog || []),
          {
            id: uid(),
            ts: nowIso(),
            type: "adjustment",
            entity: form.sku,
            description: `Updated product ${form.sku}`,
          },
        ],
      }));
      // If drawer is open for this product, refresh it
      if (drawerProduct && drawerProduct.id === editing.id) {
        setDrawerProduct({ ...editing, ...form });
      }
    }
    setEditing(null);
  };

  const deleteProduct = (p) => {
    if (!confirm(`Delete ${p.sku} -- ${p.name}?`)) return;
    setData((d) => ({
      ...d,
      products: d.products.filter((pr) => pr.id !== p.id),
      auditLog: [
        ...(d.auditLog || []),
        {
          id: uid(),
          ts: nowIso(),
          type: "adjustment",
          entity: p.sku,
          description: `Deleted product ${p.sku} -- ${p.name}`,
        },
      ],
    }));
    if (drawerProduct && drawerProduct.id === p.id) setDrawerProduct(null);
  };

  // --- CSV Export -------------------------------------------------------------
  const exportCSV = () => {
    const rows = computedProds.map((p) => ({
      sku: p.sku,
      upc: p.upc || "",
      name: p.name,
      category: p.category,
      costPrice: p.costPrice,
      sellPrice: p.sellPrice,
      onHand: p.onHand,
      locked: p.locked,
      available: p.available,
      backordered: p.backordered,
      reorderPoint: p.reorderPoint,
      reorderQty: p.reorderQty,
    }));
    const csv = toCSV(rows, [
      "sku",
      "upc",
      "name",
      "category",
      "costPrice",
      "sellPrice",
      "onHand",
      "locked",
      "available",
      "backordered",
      "reorderPoint",
      "reorderQty",
    ]);
    dlCSV(csv, "products_inventory.csv");
  };

  // --- CSV Import ------------------------------------------------------------
  const handleImportFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCSV(ev.target.result);
      setImportRows(rows);
      setImportModal(true);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const applyImport = () => {
    if (importRows.length === 0) return;

    const existingBySku = Object.fromEntries(data.products.map((p) => [p.sku.toLowerCase(), p]));
    let created = 0;
    let updated = 0;
    const newProducts = [...data.products];

    for (const row of importRows) {
      const sku = (row.sku || row.SKU || row["Product Code"] || "").trim();
      if (!sku) continue;

      const upc = (row.upc || row.UPC || row.Upc || "").trim();
      const name = row.name || row.Name || row.description || row.Description || "";
      const category = row.category || row.Category || "";
      const costPrice = parseFloat(row.costPrice || row["Cost Price"] || row.cost || 0) || 0;
      const sellPrice = parseFloat(row.sellPrice || row["Sell Price"] || row.price || 0) || 0;
      const onHand = parseInt(row.onHand || row["On Hand"] || row.qty || 0) || 0;
      const reorderPoint = parseInt(row.reorderPoint || row["Reorder Point"] || 0) || 0;
      const reorderQty = parseInt(row.reorderQty || row["Reorder Qty"] || 0) || 0;

      const existing = existingBySku[sku.toLowerCase()];
      if (existing) {
        const idx = newProducts.findIndex((p) => p.id === existing.id);
        if (idx >= 0) {
          newProducts[idx] = {
            ...newProducts[idx],
            // Only overwrite UPC when the CSV cell is non-empty
            upc: upc || newProducts[idx].upc,
            name: name || newProducts[idx].name,
            category: category || newProducts[idx].category,
            costPrice: costPrice != null && costPrice !== "" ? costPrice : newProducts[idx].costPrice,
            sellPrice: sellPrice != null && sellPrice !== "" ? sellPrice : newProducts[idx].sellPrice,
            onHand: onHand != null && onHand !== "" ? onHand : newProducts[idx].onHand,
            reorderPoint: reorderPoint || newProducts[idx].reorderPoint,
            reorderQty: reorderQty || newProducts[idx].reorderQty,
          };
          updated++;
        }
      } else {
        newProducts.push({
          id: uid(),
          sku,
          upc,
          name,
          category,
          costPrice,
          sellPrice,
          onHand,
          reorderPoint,
          reorderQty,
          supplier: "",
        });
        created++;
      }
    }

    setData((d) => ({
      ...d,
      products: newProducts,
      auditLog: [
        ...(d.auditLog || []),
        {
          id: uid(),
          ts: nowIso(),
          type: "adjustment",
          entity: "CSV Import",
          description: `CSV import: ${created} created, ${updated} updated (${importRows.length} rows)`,
        },
      ],
    }));

    setImportModal(false);
    setImportRows([]);
  };

  // Keep drawer product reference fresh
  const drawerProd = drawerProduct
    ? data.products.find((p) => p.id === drawerProduct.id) || null
    : null;

  // --- Render ----------------------------------------------------------------
  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>
            Products &amp; Inventory
          </h2>
          <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 13 }}>
            {data.products.length} product{data.products.length !== 1 ? "s" : ""} &middot;{" "}
            {fmtNum(computedProds.reduce((s, p) => s + p.onHand, 0))} total on hand &middot;{" "}
            {fmtNum(computedProds.reduce((s, p) => s + p.available, 0))} available
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            style={{ ...IS, width: 220 }}
            placeholder="Search SKU, name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            style={{ ...SS, width: 160 }}
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button style={BS} onClick={exportCSV}>
            Export CSV
          </button>
          <button
            style={BS}
            onClick={() => fileRef.current && fileRef.current.click()}
          >
            Import CSV
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={handleImportFile}
          />
          <button style={BP} onClick={openNew}>
            + New Product
          </button>
        </div>
      </div>

      {/* Product Table */}
      <Table
        headers={["SKU", "UPC", "Product", "Category", "Cost", "Landed", "Sell", "On Hand", "Locked", "Available", "Status", "Actions"]}
        empty={filtered.length === 0 ? "No products found." : null}
      >
        {filtered.map((p, i) => {
          // Out-of-stock items with an open supplier PO show as On Order with
          // the (earliest) expected arrival date instead of a dead end.
          const incomingDate = onOrderDates[p.id];
          const status =
            p.available === 0
              ? incomingDate
                ? "booked"
                : "cancelled"
              : p.available <= p.reorderPoint
                ? "partial"
                : "confirmed";
          const statusLabel =
            p.available === 0
              ? incomingDate
                ? `On Order · arrives ${fmtDate(incomingDate)}`
                : "Out of Stock"
              : p.available <= p.reorderPoint
                ? "Low Stock"
                : "In Stock";
          return (
            <TR key={p.id} i={i}>
              <TD mono accent="#6D28D9">
                <span
                  style={{ cursor: "pointer", textDecoration: "underline", textDecorationColor: "#DDD6FE" }}
                  onClick={() => setDrawerProduct(p)}
                >
                  {p.sku}
                </span>
              </TD>
              <TD mono>{p.upc || "--"}</TD>
              <TD>
                <span
                  style={{ cursor: "pointer" }}
                  onClick={() => setDrawerProduct(p)}
                >
                  {p.name}
                </span>
              </TD>
              <TD>{p.category || "--"}</TD>
              <TD mono>{fmt(p.costPrice)}</TD>
              <TD mono accent={p.landedCost ? "#7C3AED" : undefined}>
                {p.landedCost ? fmt(p.landedCost) : "--"}
              </TD>
              <TD mono>{fmt(p.sellPrice)}</TD>
              <TD mono>{fmtNum(p.onHand)}</TD>
              <TD mono accent={p.locked > 0 ? "#EAB308" : undefined}>
                {p.locked > 0 ? `-${fmtNum(p.locked)}` : "--"}
              </TD>
              <TD>
                <span
                  style={{
                    background:
                      p.available === 0
                        ? "#FEF2F2"
                        : p.available <= p.reorderPoint
                          ? "#FEFCE8"
                          : "#F0FDF4",
                    color:
                      p.available === 0
                        ? "#B91C1C"
                        : p.available <= p.reorderPoint
                          ? "#854D0E"
                          : "#15803D",
                    border: `1px solid ${
                      p.available === 0
                        ? "#FECACA"
                        : p.available <= p.reorderPoint
                          ? "#FDE68A"
                          : "#BBF7D0"
                    }`,
                    borderRadius: 20,
                    padding: "2px 12px",
                    fontSize: 13,
                    fontWeight: 800,
                    display: "inline-block",
                  }}
                >
                  {fmtNum(p.available)}
                </span>
              </TD>
              <TD>
                <Badge status={status} label={statusLabel} />
              </TD>
              <TD>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    style={{ ...BS, padding: "5px 10px", fontSize: 11 }}
                    onClick={() => setDrawerProduct(p)}
                  >
                    View
                  </button>
                  <button
                    style={{ ...BS, padding: "5px 10px", fontSize: 11 }}
                    onClick={() => openEdit(p)}
                  >
                    Edit
                  </button>
                  <button
                    style={{ ...BD, padding: "5px 10px", fontSize: 11 }}
                    onClick={() => deleteProduct(p)}
                  >
                    Delete
                  </button>
                </div>
              </TD>
            </TR>
          );
        })}
      </Table>

      {/* SKU Drawer */}
      {drawerProd && (
        <SkuDrawer
          product={drawerProd}
          data={data}
          setData={setData}
          onClose={() => setDrawerProduct(null)}
          onEdit={() => {
            openEdit(drawerProd);
            setDrawerProduct(null);
          }}
        />
      )}

      {/* Create / Edit Modal */}
      {editing && (
        <Modal
          title={editing === "new" ? "New Product" : `Edit ${editing.sku}`}
          onClose={() => setEditing(null)}
          width={640}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
            <Field label="SKU">
              <input
                style={IS}
                value={form.sku}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                placeholder="e.g. LX-1000-S-SLVR-BX"
              />
            </Field>
            <Field label="Category">
              <input
                style={IS}
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="e.g. Spinning Reels"
                list="category-list"
              />
              <datalist id="category-list">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="UPC">
              <input
                style={IS}
                value={form.upc}
                onChange={(e) => setForm((f) => ({ ...f, upc: e.target.value }))}
                placeholder="e.g. 850012345678"
              />
            </Field>
          </div>
          <Field label="Product Name">
            <input
              style={IS}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Full product name"
            />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
            <Field label="Cost Price">
              <input
                style={IS}
                type="number"
                step="0.01"
                min="0"
                value={form.costPrice}
                onChange={(e) => setForm((f) => ({ ...f, costPrice: +e.target.value || 0 }))}
              />
            </Field>
            <Field label="Landed Cost (auto-set at receiving)">
              <input
                style={IS}
                type="number"
                step="0.01"
                min="0"
                value={form.landedCost}
                onChange={(e) => setForm((f) => ({ ...f, landedCost: +e.target.value || 0 }))}
              />
            </Field>
            <Field label="Sell Price">
              <input
                style={IS}
                type="number"
                step="0.01"
                min="0"
                value={form.sellPrice}
                onChange={(e) => setForm((f) => ({ ...f, sellPrice: +e.target.value || 0 }))}
              />
            </Field>
            <Field label="On Hand">
              <input
                style={IS}
                type="number"
                min="0"
                value={form.onHand}
                onChange={(e) => setForm((f) => ({ ...f, onHand: Math.max(0, +e.target.value || 0) }))}
              />
            </Field>
            <Field label="Supplier">
              <select
                style={SS}
                value={form.supplier}
                onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
              >
                <option value="">-- select --</option>
                {data.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reorder Point">
              <input
                style={IS}
                type="number"
                min="0"
                value={form.reorderPoint}
                onChange={(e) => setForm((f) => ({ ...f, reorderPoint: Math.max(0, +e.target.value || 0) }))}
              />
            </Field>
            <Field label="Reorder Qty">
              <input
                style={IS}
                type="number"
                min="0"
                value={form.reorderQty}
                onChange={(e) => setForm((f) => ({ ...f, reorderQty: Math.max(0, +e.target.value || 0) }))}
              />
            </Field>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
            <button style={BS} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button style={BP} onClick={save} disabled={!form.sku || !form.name}>
              {editing === "new" ? "Create Product" : "Save Changes"}
            </button>
          </div>
        </Modal>
      )}

      {/* Import CSV Modal */}
      {importModal && (
        <Modal
          title="Import Products from CSV"
          onClose={() => {
            setImportModal(false);
            setImportRows([]);
          }}
          width={700}
        >
          <div style={{ marginBottom: 14, fontSize: 13, color: "#475569" }}>
            Found <strong>{importRows.length}</strong> row{importRows.length !== 1 ? "s" : ""} in CSV.
            Products with matching SKUs will be updated; new SKUs will be created.
          </div>
          {importRows.length > 0 && (
            <div
              style={{
                maxHeight: 320,
                overflow: "auto",
                border: "1px solid #E2E8F0",
                borderRadius: 10,
                marginBottom: 16,
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#F8FAFC" }}>
                    {Object.keys(importRows[0]).slice(0, 6).map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "8px 10px",
                          textAlign: "left",
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#94A3B8",
                          textTransform: "uppercase",
                          borderBottom: "1px solid #E2E8F0",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importRows.slice(0, 50).map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #F1F5F9" }}>
                      {Object.keys(importRows[0]).slice(0, 6).map((h) => (
                        <td key={h} style={{ padding: "6px 10px", fontSize: 12, color: "#374151" }}>
                          {row[h] || ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {importRows.length > 50 && (
                <div style={{ padding: 10, textAlign: "center", fontSize: 12, color: "#94A3B8" }}>
                  ... and {importRows.length - 50} more rows
                </div>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              style={BS}
              onClick={() => {
                setImportModal(false);
                setImportRows([]);
              }}
            >
              Cancel
            </button>
            <button style={BP} onClick={applyImport} disabled={importRows.length === 0}>
              Import {importRows.length} Row{importRows.length !== 1 ? "s" : ""}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
