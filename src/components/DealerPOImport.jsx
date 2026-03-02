import { useState, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import { LOCKING, COL_ALIASES } from "../lib/constants";
import { computeInventory } from "../lib/inventory";
import { uid, fmt, fmtNum, fmtDate, nowIso, todayIso, toCSV, dlCSV, parseCSV, detectCol } from "../lib/utils";
import { parseAccOrderWriter, detectAccFormat } from "../lib/parseAccOrderWriter";
import { Modal, Field, Badge, IS, SS, BP, BS, BG } from "./ui";

// --- Local StepTab component -------------------------------------------------
function StepTab({ steps, current }) {
  return (
    <div style={{ display: "flex", gap: 0, marginBottom: 20 }}>
      {steps.map((s, i) => {
        const active = s.key === current;
        const done = steps.findIndex((st) => st.key === current) > i;
        return (
          <div
            key={s.key}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "10px 6px",
              fontSize: 12,
              fontWeight: 700,
              color: active ? "#4F46E5" : done ? "#15803D" : "#94A3B8",
              borderBottom: `3px solid ${active ? "#4F46E5" : done ? "#BBF7D0" : "#E2E8F0"}`,
              background: active ? "#EEF2FF" : "transparent",
              transition: "all 0.15s",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: active ? "#4F46E5" : done ? "#15803D" : "#E2E8F0",
                color: active || done ? "#fff" : "#94A3B8",
                fontSize: 11,
                fontWeight: 800,
                marginRight: 6,
              }}
            >
              {done ? "\u2713" : i + 1}
            </span>
            {s.label}
          </div>
        );
      })}
    </div>
  );
}

// --- Wizard steps definition -------------------------------------------------
const STEPS = [
  { key: "upload", label: "Upload File" },
  { key: "map", label: "Map Columns" },
  { key: "review", label: "Review & Import" },
  { key: "done", label: "Done" },
];

const ACC_STEPS = [
  { key: "upload", label: "Upload File" },
  { key: "acc-preview", label: "Review Order" },
  { key: "review", label: "Confirm & Import" },
  { key: "done", label: "Done" },
];

// =============================================================================
// DealerPOImport component
// =============================================================================
export default function DealerPOImport({ data, setData, onClose }) {
  const [step, setStep] = useState("upload");
  const [rawRows, setRawRows] = useState([]);
  const [fileHeaders, setFileHeaders] = useState([]);
  const [colMap, setColMap] = useState({});
  const [parsedMeta, setParsedMeta] = useState(null);
  const [dealerInfo, setDealerInfo] = useState({
    customer: "",
    poRef: "",
    date: todayIso(),
    notes: "",
  });
  const [lines, setLines] = useState([]);
  const [error, setError] = useState("");
  const [importMode, setImportMode] = useState(""); // "csv" | "acc"
  const fileRef = useRef();

  const computedProds = useMemo(
    () => computeInventory(data.products, data.salesOrders),
    [data.products, data.salesOrders],
  );

  // --- Product lookup by SKU (case-insensitive, trimmed) ---------------------
  const skuMap = useMemo(() => {
    const m = {};
    data.products.forEach((p) => {
      m[p.sku.toLowerCase().trim()] = p;
    });
    return m;
  }, [data.products]);

  const findProduct = (sku) => {
    if (!sku) return null;
    return skuMap[String(sku).toLowerCase().trim()] || null;
  };

  // --- File upload handler ---------------------------------------------------
  const handleFile = (file) => {
    setError("");
    if (!file) return;

    const ext = file.name.split(".").pop().toLowerCase();

    if (ext === "csv") {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const rows = parseCSV(e.target.result);
          if (rows.length === 0) {
            setError("CSV file is empty or has no data rows.");
            return;
          }
          const headers = Object.keys(rows[0]);
          setRawRows(rows);
          setFileHeaders(headers);

          // Auto-detect columns
          const autoMap = {};
          autoMap.sku = detectCol(headers, COL_ALIASES.sku) || "";
          autoMap.qty = detectCol(headers, COL_ALIASES.qty) || "";
          autoMap.price = detectCol(headers, COL_ALIASES.price) || "";
          autoMap.name = detectCol(headers, COL_ALIASES.name) || "";
          autoMap.poRef = detectCol(headers, COL_ALIASES.poRef) || "";
          setColMap(autoMap);

          // Auto-detect PO ref from first row if mapped
          if (autoMap.poRef && rows[0][autoMap.poRef]) {
            setDealerInfo((d) => ({ ...d, poRef: String(rows[0][autoMap.poRef]).trim() }));
          }

          setImportMode("csv");
          setStep("map");
        } catch (err) {
          setError("Failed to parse CSV: " + err.message);
        }
      };
      reader.readAsText(file);
    } else if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: "array", cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const sheetData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

          // Check if this is the ACC Order Writer format
          if (detectAccFormat(sheetData)) {
            const meta = parseAccOrderWriter(sheetData);
            if (!meta) {
              setError("Recognized ACC Order Writer format but failed to parse product rows.");
              return;
            }
            setParsedMeta(meta);
            setDealerInfo({
              customer: meta.customerName || "",
              poRef: meta.poNumber || "",
              date: meta.orderDate || todayIso(),
              notes: [
                meta.buyerName ? `Buyer: ${meta.buyerName}` : "",
                meta.buyerEmail ? meta.buyerEmail : "",
                meta.shipToAddr ? `Ship To: ${meta.shipToAddr}` : "",
              ]
                .filter(Boolean)
                .join(" | "),
            });

            // Pre-match ordered products to inventory
            const matched = meta.orderedProducts.map((p) => {
              const prod = findProduct(p.sku);
              const cp = prod ? computedProds.find((c) => c.id === prod.id) : null;
              return {
                ...p,
                productId: prod ? prod.id : "",
                productName: prod ? prod.name : "",
                available: cp ? cp.available : 0,
                sellPrice: prod ? prod.sellPrice : p.msrp,
                matched: !!prod,
              };
            });
            setLines(matched);
            setImportMode("acc");
            setStep("acc-preview");
            return;
          }

          // Generic XLSX -- treat as flat table (first row = headers)
          const jsonRows = XLSX.utils.sheet_to_json(ws, { defval: "" });
          if (jsonRows.length === 0) {
            setError("Spreadsheet has no data rows.");
            return;
          }
          const headers = Object.keys(jsonRows[0]);
          setRawRows(jsonRows);
          setFileHeaders(headers);

          const autoMap = {};
          autoMap.sku = detectCol(headers, COL_ALIASES.sku) || "";
          autoMap.qty = detectCol(headers, COL_ALIASES.qty) || "";
          autoMap.price = detectCol(headers, COL_ALIASES.price) || "";
          autoMap.name = detectCol(headers, COL_ALIASES.name) || "";
          autoMap.poRef = detectCol(headers, COL_ALIASES.poRef) || "";
          setColMap(autoMap);

          if (autoMap.poRef && jsonRows[0][autoMap.poRef]) {
            setDealerInfo((d) => ({ ...d, poRef: String(jsonRows[0][autoMap.poRef]).trim() }));
          }

          setImportMode("csv");
          setStep("map");
        } catch (err) {
          setError("Failed to parse spreadsheet: " + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      setError("Unsupported file type. Please upload a .csv or .xlsx file.");
    }
  };

  // --- Build lines from CSV column mapping -----------------------------------
  const buildLinesFromMap = () => {
    if (!colMap.sku || !colMap.qty) {
      setError("SKU and Quantity columns are required.");
      return;
    }
    const built = rawRows
      .map((row) => {
        const sku = String(row[colMap.sku] || "").trim();
        const qty = parseInt(String(row[colMap.qty] || "0").replace(/\s/g, "")) || 0;
        const price = colMap.price ? parseFloat(row[colMap.price]) || 0 : 0;
        const name = colMap.name ? String(row[colMap.name] || "").trim() : "";
        if (!sku || qty <= 0) return null;
        const prod = findProduct(sku);
        const cp = prod ? computedProds.find((c) => c.id === prod.id) : null;
        return {
          sku,
          qty,
          cost: price,
          msrp: 0,
          desc: name || (prod ? prod.name : ""),
          productId: prod ? prod.id : "",
          productName: prod ? prod.name : "",
          available: cp ? cp.available : 0,
          sellPrice: prod ? prod.sellPrice : price,
          matched: !!prod,
        };
      })
      .filter(Boolean);

    if (built.length === 0) {
      setError("No valid lines found. Check that SKU and Qty columns are correctly mapped.");
      return;
    }
    setLines(built);
    setError("");
    setStep("review");
  };

  // --- Create the sales order ------------------------------------------------
  const doImport = () => {
    const validLines = lines.filter((l) => l.matched && l.qty > 0);
    if (validLines.length === 0) {
      setError("No matched products to import.");
      return;
    }

    const num = (data.counters.so || 0) + 1;
    const orderNum = `SO-${String(num).padStart(4, "0")}`;

    const orderLines = validLines.map((l) => {
      const cp = computedProds.find((c) => c.id === l.productId);
      const avail = cp ? cp.available : 0;
      const filled = Math.min(l.qty, avail);
      const bo = l.qty - filled;
      return {
        productId: l.productId,
        qty: l.qty,
        price: l.sellPrice || l.cost || 0,
        qtyFilled: filled,
        qtyBackordered: bo,
      };
    });

    const totalUnits = orderLines.reduce((s, l) => s + l.qty, 0);
    const totalBO = orderLines.reduce((s, l) => s + l.qtyBackordered, 0);
    const totalCost = validLines.reduce((s, l) => s + l.qty * (l.cost || 0), 0);

    const order = {
      id: uid(),
      orderNum,
      customer: dealerInfo.customer || "Unknown Dealer",
      date: dealerInfo.date || todayIso(),
      fulfillmentStage: "confirmed",
      type: parsedMeta ? parsedMeta.fileType : "dealer",
      dealerPORef: dealerInfo.poRef || "",
      lines: orderLines,
      shipment: {},
      notes: dealerInfo.notes || "",
    };

    const desc = parsedMeta
      ? `Imported PO ${dealerInfo.poRef || "?"} from ${dealerInfo.customer} -- ${validLines.length} lines * ${fmtNum(totalUnits)} units * ${fmt(totalCost)} ${parsedMeta.fileType} cost${parsedMeta.buyerName ? " * Buyer: " + parsedMeta.buyerName : ""}`
      : `Imported ${dealerInfo.poRef || "dealer PO"} from ${dealerInfo.customer} -- ${fmtNum(totalUnits)} units`;

    setData((d) => ({
      ...d,
      salesOrders: [...d.salesOrders, order],
      counters: { ...d.counters, so: num },
      auditLog: [
        ...(d.auditLog || []),
        {
          id: uid(),
          ts: nowIso(),
          type: "dealer-import",
          entity: orderNum,
          description: desc,
        },
      ],
    }));

    setStep("done");
  };

  // --- Reset -----------------------------------------------------------------
  const reset = () => {
    setStep("upload");
    setRawRows([]);
    setFileHeaders([]);
    setColMap({});
    setParsedMeta(null);
    setDealerInfo({ customer: "", poRef: "", date: todayIso(), notes: "" });
    setLines([]);
    setError("");
    setImportMode("");
  };

  // --- Active step set for rendering -----------------------------------------
  const activeSteps = importMode === "acc" ? ACC_STEPS : STEPS;

  // --- Stats for review step -------------------------------------------------
  const matchedLines = lines.filter((l) => l.matched);
  const unmatchedLines = lines.filter((l) => !l.matched);
  const totalUnits = matchedLines.reduce((s, l) => s + l.qty, 0);
  const totalCost = matchedLines.reduce((s, l) => s + l.qty * (l.cost || 0), 0);

  // ===========================================================================
  // RENDER
  // ===========================================================================
  return (
    <Modal title="Import New Dealer / Distributor PO" onClose={onClose} width={820}>
      <StepTab steps={activeSteps} current={step} />

      {error && (
        <div
          style={{
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 13,
            color: "#B91C1C",
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      {/* ================================================================== */}
      {/* STEP: UPLOAD                                                       */}
      {/* ================================================================== */}
      {step === "upload" && (
        <div>
          <div
            style={{
              border: "2px dashed #CBD5E1",
              borderRadius: 12,
              padding: "48px 24px",
              textAlign: "center",
              cursor: "pointer",
              background: "#F8FAFC",
              transition: "border-color 0.15s",
            }}
            onClick={() => fileRef.current && fileRef.current.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.style.borderColor = "#6D28D9";
            }}
            onDragLeave={(e) => {
              e.currentTarget.style.borderColor = "#CBD5E1";
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.style.borderColor = "#CBD5E1";
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 8 }}>&#128194;</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>
              Drop a file here or click to browse
            </div>
            <div style={{ fontSize: 12, color: "#64748B" }}>
              Supports: ACC Order Writer (.xlsx), generic CSV, or Excel spreadsheet
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files[0];
                if (f) handleFile(f);
              }}
            />
          </div>

          <div
            style={{
              marginTop: 20,
              background: "#F0F9FF",
              border: "1px solid #BAE6FD",
              borderRadius: 10,
              padding: "14px 18px",
              fontSize: 12,
              color: "#0369A1",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Supported formats:</div>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
              <li>
                <strong>ACC Order Writer</strong> -- auto-detected. Reads customer info, PO#,
                buyer details, and all product lines with pricing.
              </li>
              <li>
                <strong>CSV / Excel</strong> -- map columns for SKU and Quantity. Price and
                description are optional.
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* STEP: MAP (generic CSV / XLSX)                                     */}
      {/* ================================================================== */}
      {step === "map" && (
        <div>
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E8F0",
              borderRadius: 10,
              padding: "16px 20px",
              marginBottom: 18,
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#0F172A",
                marginBottom: 12,
              }}
            >
              Map Columns
            </div>
            <div style={{ fontSize: 12, color: "#64748B", marginBottom: 14 }}>
              Found <strong>{rawRows.length}</strong> rows with{" "}
              <strong>{fileHeaders.length}</strong> columns. Map the required columns below.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
              <Field label="SKU Column *">
                <select
                  style={SS}
                  value={colMap.sku || ""}
                  onChange={(e) => setColMap((m) => ({ ...m, sku: e.target.value }))}
                >
                  <option value="">-- select --</option>
                  {fileHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Quantity Column *">
                <select
                  style={SS}
                  value={colMap.qty || ""}
                  onChange={(e) => setColMap((m) => ({ ...m, qty: e.target.value }))}
                >
                  <option value="">-- select --</option>
                  {fileHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Price Column">
                <select
                  style={SS}
                  value={colMap.price || ""}
                  onChange={(e) => setColMap((m) => ({ ...m, price: e.target.value }))}
                >
                  <option value="">-- none --</option>
                  {fileHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Description Column">
                <select
                  style={SS}
                  value={colMap.name || ""}
                  onChange={(e) => setColMap((m) => ({ ...m, name: e.target.value }))}
                >
                  <option value="">-- none --</option>
                  {fileHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          {/* Dealer info */}
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E8F0",
              borderRadius: 10,
              padding: "16px 20px",
              marginBottom: 18,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>
              Order Info
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
              <Field label="Customer / Dealer Name *">
                <input
                  style={IS}
                  value={dealerInfo.customer}
                  onChange={(e) => setDealerInfo((d) => ({ ...d, customer: e.target.value }))}
                  placeholder="e.g. Bass Pro Shops"
                />
              </Field>
              <Field label="Dealer PO Reference">
                <input
                  style={IS}
                  value={dealerInfo.poRef}
                  onChange={(e) => setDealerInfo((d) => ({ ...d, poRef: e.target.value }))}
                  placeholder="e.g. BPS-55021"
                />
              </Field>
              <Field label="Order Date">
                <input
                  style={IS}
                  type="date"
                  value={dealerInfo.date}
                  onChange={(e) => setDealerInfo((d) => ({ ...d, date: e.target.value }))}
                />
              </Field>
              <Field label="Notes">
                <input
                  style={IS}
                  value={dealerInfo.notes}
                  onChange={(e) => setDealerInfo((d) => ({ ...d, notes: e.target.value }))}
                  placeholder="Optional"
                />
              </Field>
            </div>
          </div>

          {/* Preview */}
          {colMap.sku && colMap.qty && (
            <div
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                borderRadius: 10,
                padding: "16px 20px",
                marginBottom: 18,
                maxHeight: 260,
                overflow: "auto",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "#64748B", marginBottom: 8 }}>
                Preview (first 10 rows)
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#F1F5F9" }}>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748B" }}>SKU</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748B" }}>Qty</th>
                    {colMap.price && (
                      <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748B" }}>Price</th>
                    )}
                    {colMap.name && (
                      <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748B" }}>
                        Description
                      </th>
                    )}
                    <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748B" }}>Match</th>
                  </tr>
                </thead>
                <tbody>
                  {rawRows.slice(0, 10).map((row, i) => {
                    const sku = String(row[colMap.sku] || "").trim();
                    const prod = findProduct(sku);
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid #F1F5F9" }}>
                        <td
                          style={{
                            padding: "6px 10px",
                            fontFamily: "monospace",
                            fontSize: 11,
                          }}
                        >
                          {sku}
                        </td>
                        <td style={{ padding: "6px 10px" }}>{row[colMap.qty]}</td>
                        {colMap.price && (
                          <td style={{ padding: "6px 10px" }}>{row[colMap.price]}</td>
                        )}
                        {colMap.name && (
                          <td style={{ padding: "6px 10px" }}>{row[colMap.name]}</td>
                        )}
                        <td style={{ padding: "6px 10px" }}>
                          {prod ? (
                            <Badge status="confirmed" label="Matched" />
                          ) : (
                            <Badge status="cancelled" label="No match" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button style={BS} onClick={reset}>
              Back
            </button>
            <button
              style={BP}
              onClick={buildLinesFromMap}
              disabled={!colMap.sku || !colMap.qty}
            >
              Continue to Review
            </button>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* STEP: ACC-PREVIEW (ACC Order Writer format)                        */}
      {/* ================================================================== */}
      {step === "acc-preview" && parsedMeta && (
        <div>
          {/* Order metadata */}
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E8F0",
              borderRadius: 10,
              padding: "16px 20px",
              marginBottom: 18,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                ACC Order Writer -- {parsedMeta.fileType === "distributor" ? "Distributor" : "Dealer"} PO
              </div>
              <Badge
                status={parsedMeta.fileType === "distributor" ? "distributor" : "dealer"}
                label={parsedMeta.fileType === "distributor" ? "Distributor" : "Dealer"}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
              <Field label="Customer Name">
                <input
                  style={IS}
                  value={dealerInfo.customer}
                  onChange={(e) => setDealerInfo((d) => ({ ...d, customer: e.target.value }))}
                />
              </Field>
              <Field label="PO Number">
                <input
                  style={IS}
                  value={dealerInfo.poRef}
                  onChange={(e) => setDealerInfo((d) => ({ ...d, poRef: e.target.value }))}
                />
              </Field>
              <Field label="Order Date">
                <input
                  style={IS}
                  type="date"
                  value={dealerInfo.date}
                  onChange={(e) => setDealerInfo((d) => ({ ...d, date: e.target.value }))}
                />
              </Field>
              <Field label="Ship Date">
                <input style={{ ...IS, background: "#F8FAFC" }} value={parsedMeta.shipDate || "--"} readOnly />
              </Field>
            </div>

            {/* Buyer info */}
            {(parsedMeta.buyerName || parsedMeta.buyerEmail) && (
              <div
                style={{
                  background: "#F8FAFC",
                  borderRadius: 8,
                  padding: "10px 14px",
                  marginTop: 4,
                  fontSize: 12,
                  color: "#475569",
                }}
              >
                <strong>Buyer:</strong> {parsedMeta.buyerName || "--"}
                {parsedMeta.buyerEmail && ` | ${parsedMeta.buyerEmail}`}
                {parsedMeta.shipToAddr && (
                  <>
                    <br />
                    <strong>Ship To:</strong> {parsedMeta.shipToAddr}
                  </>
                )}
              </div>
            )}

            <Field label="Notes">
              <textarea
                style={{ ...IS, minHeight: 40, resize: "vertical", marginTop: 4 }}
                value={dealerInfo.notes}
                onChange={(e) => setDealerInfo((d) => ({ ...d, notes: e.target.value }))}
              />
            </Field>
          </div>

          {/* Product lines preview table */}
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E8F0",
              borderRadius: 10,
              overflow: "hidden",
              marginBottom: 18,
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid #E2E8F0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>
                Ordered Products ({lines.length})
              </div>
              <div style={{ fontSize: 12, color: "#64748B" }}>
                {matchedLines.length} matched &middot;{" "}
                {unmatchedLines.length > 0 && (
                  <span style={{ color: "#DC2626" }}>{unmatchedLines.length} unmatched</span>
                )}
                {unmatchedLines.length === 0 && (
                  <span style={{ color: "#15803D" }}>all matched</span>
                )}
              </div>
            </div>

            <div style={{ maxHeight: 340, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#F1F5F9" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                      SKU
                    </th>
                    <th style={{ padding: "8px 12px", textAlign: "left", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                      Description
                    </th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                      Qty
                    </th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                      Cost
                    </th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                      MSRP
                    </th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                      Ext
                    </th>
                    <th style={{ padding: "8px 12px", textAlign: "center", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                      Match
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr
                      key={i}
                      style={{
                        borderBottom: "1px solid #F1F5F9",
                        background: l.matched ? "transparent" : "#FEF2F2",
                      }}
                    >
                      <td
                        style={{
                          padding: "7px 12px",
                          fontFamily: "monospace",
                          fontSize: 11,
                          fontWeight: 600,
                          color: l.matched ? "#6D28D9" : "#DC2626",
                        }}
                      >
                        {l.sku}
                      </td>
                      <td style={{ padding: "7px 12px", color: "#374151" }}>{l.desc}</td>
                      <td
                        style={{
                          padding: "7px 12px",
                          textAlign: "right",
                          fontWeight: 700,
                          color: "#0F172A",
                        }}
                      >
                        {l.qty}
                      </td>
                      <td style={{ padding: "7px 12px", textAlign: "right", color: "#475569" }}>
                        {fmt(l.cost)}
                      </td>
                      <td style={{ padding: "7px 12px", textAlign: "right", color: "#475569" }}>
                        {fmt(l.msrp)}
                      </td>
                      <td
                        style={{
                          padding: "7px 12px",
                          textAlign: "right",
                          fontWeight: 600,
                          color: "#0F172A",
                        }}
                      >
                        {fmt(l.qty * l.cost)}
                      </td>
                      <td style={{ padding: "7px 12px", textAlign: "center" }}>
                        {l.matched ? (
                          <Badge status="confirmed" label="OK" />
                        ) : (
                          <Badge status="cancelled" label="No match" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div
              style={{
                padding: "10px 16px",
                borderTop: "1px solid #E2E8F0",
                background: "#F8FAFC",
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              <span style={{ color: "#64748B" }}>
                {fmtNum(totalUnits)} units across {matchedLines.length} matched lines
              </span>
              <span style={{ color: "#0F172A" }}>
                {parsedMeta.fileType === "distributor" ? "Dist" : "Dealer"} Total: {fmt(totalCost)}
              </span>
            </div>
          </div>

          {/* Unmatched warning */}
          {unmatchedLines.length > 0 && (
            <div
              style={{
                background: "#FFF7ED",
                border: "1px solid #FED7AA",
                borderRadius: 10,
                padding: "12px 16px",
                marginBottom: 18,
                fontSize: 12,
                color: "#9A3412",
              }}
            >
              <strong>{unmatchedLines.length} SKU{unmatchedLines.length !== 1 ? "s" : ""}</strong>{" "}
              not found in inventory and will be skipped:{" "}
              {unmatchedLines.map((l) => l.sku).join(", ")}
            </div>
          )}

          {/* Footer */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button style={BS} onClick={reset}>
              Back
            </button>
            <button style={BP} onClick={() => setStep("review")}>
              Continue to Import
            </button>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* STEP: REVIEW (final confirmation before import)                    */}
      {/* ================================================================== */}
      {step === "review" && (
        <div>
          {/* Summary card */}
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E8F0",
              borderRadius: 10,
              padding: "16px 20px",
              marginBottom: 18,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>
              Import Summary
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ fontSize: 12, color: "#64748B" }}>
                <strong>Customer:</strong> {dealerInfo.customer || "--"}
              </div>
              <div style={{ fontSize: 12, color: "#64748B" }}>
                <strong>PO Ref:</strong> {dealerInfo.poRef || "--"}
              </div>
              <div style={{ fontSize: 12, color: "#64748B" }}>
                <strong>Date:</strong> {fmtDate(dealerInfo.date)}
              </div>
              <div style={{ fontSize: 12, color: "#64748B" }}>
                <strong>Type:</strong>{" "}
                <Badge
                  status={parsedMeta ? parsedMeta.fileType : "dealer"}
                  label={parsedMeta ? parsedMeta.fileType : "Dealer"}
                />
              </div>
            </div>
            {dealerInfo.notes && (
              <div
                style={{
                  fontSize: 12,
                  color: "#64748B",
                  marginTop: 8,
                  background: "#F8FAFC",
                  padding: "8px 12px",
                  borderRadius: 6,
                }}
              >
                <strong>Notes:</strong> {dealerInfo.notes}
              </div>
            )}
          </div>

          {/* Line items with availability check */}
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E8F0",
              borderRadius: 10,
              overflow: "hidden",
              marginBottom: 18,
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid #E2E8F0",
                fontSize: 13,
                fontWeight: 700,
                color: "#0F172A",
              }}
            >
              Line Items ({matchedLines.length} matched)
            </div>
            <div style={{ maxHeight: 300, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#F1F5F9" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                      SKU
                    </th>
                    <th style={{ padding: "8px 12px", textAlign: "left", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                      Product
                    </th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                      Ordered
                    </th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                      Available
                    </th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                      Filled
                    </th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                      Backorder
                    </th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                      Price
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matchedLines.map((l, i) => {
                    const cp = computedProds.find((c) => c.id === l.productId);
                    const avail = cp ? cp.available : 0;
                    const filled = Math.min(l.qty, avail);
                    const bo = l.qty - filled;
                    return (
                      <tr
                        key={i}
                        style={{
                          borderBottom: "1px solid #F1F5F9",
                          background: bo > 0 ? "#FFF7ED" : "transparent",
                        }}
                      >
                        <td
                          style={{
                            padding: "7px 12px",
                            fontFamily: "monospace",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#6D28D9",
                          }}
                        >
                          {l.sku}
                        </td>
                        <td style={{ padding: "7px 12px", color: "#374151" }}>
                          {l.productName || l.desc}
                        </td>
                        <td
                          style={{
                            padding: "7px 12px",
                            textAlign: "right",
                            fontWeight: 700,
                            color: "#0F172A",
                          }}
                        >
                          {l.qty}
                        </td>
                        <td style={{ padding: "7px 12px", textAlign: "right", color: "#64748B" }}>
                          {fmtNum(avail)}
                        </td>
                        <td
                          style={{
                            padding: "7px 12px",
                            textAlign: "right",
                            fontWeight: 700,
                            color: "#15803D",
                          }}
                        >
                          {filled}
                        </td>
                        <td
                          style={{
                            padding: "7px 12px",
                            textAlign: "right",
                            fontWeight: bo > 0 ? 700 : 400,
                            color: bo > 0 ? "#DC2626" : "#64748B",
                          }}
                        >
                          {bo > 0 ? bo : "--"}
                        </td>
                        <td style={{ padding: "7px 12px", textAlign: "right", color: "#475569" }}>
                          {fmt(l.sellPrice || l.cost || 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals bar */}
            <div
              style={{
                padding: "10px 16px",
                borderTop: "1px solid #E2E8F0",
                background: "#F8FAFC",
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              <span style={{ color: "#64748B" }}>
                {fmtNum(totalUnits)} units &middot; {matchedLines.length} lines
              </span>
              <span style={{ color: "#0F172A" }}>{fmt(totalCost)}</span>
            </div>
          </div>

          {/* Backorder warning */}
          {matchedLines.some((l) => {
            const cp = computedProds.find((c) => c.id === l.productId);
            return l.qty > (cp ? cp.available : 0);
          }) && (
            <div
              style={{
                background: "#FFF7ED",
                border: "1px solid #FED7AA",
                borderRadius: 10,
                padding: "12px 16px",
                marginBottom: 18,
                fontSize: 12,
                color: "#9A3412",
              }}
            >
              <strong>Some items exceed available inventory.</strong> These will be partially filled
              and the remainder placed on backorder. Backorders are auto-filled when inventory is
              received via Purchase Orders.
            </div>
          )}

          {/* Unmatched lines summary */}
          {unmatchedLines.length > 0 && (
            <div
              style={{
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 10,
                padding: "12px 16px",
                marginBottom: 18,
                fontSize: 12,
                color: "#B91C1C",
              }}
            >
              <strong>{unmatchedLines.length} SKU{unmatchedLines.length !== 1 ? "s" : ""}</strong>{" "}
              could not be matched and will be skipped:{" "}
              {unmatchedLines.map((l) => l.sku).join(", ")}
            </div>
          )}

          {/* Footer */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              style={BS}
              onClick={() => setStep(importMode === "acc" ? "acc-preview" : "map")}
            >
              Back
            </button>
            <button
              style={{
                ...BG,
                background: "linear-gradient(135deg,#15803D,#16A34A)",
                color: "#fff",
                border: "none",
              }}
              onClick={doImport}
              disabled={matchedLines.length === 0}
            >
              Import as Sales Order
            </button>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* STEP: DONE                                                         */}
      {/* ================================================================== */}
      {step === "done" && (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "#F0FDF4",
              border: "2px solid #BBF7D0",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              marginBottom: 14,
            }}
          >
            &#10003;
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0F172A", marginBottom: 6 }}>
            Import Complete
          </div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 8 }}>
            Created sales order for <strong>{dealerInfo.customer}</strong>
            {dealerInfo.poRef && (
              <>
                {" "}
                (PO: <span style={{ fontFamily: "monospace", color: "#6D28D9" }}>{dealerInfo.poRef}</span>)
              </>
            )}
          </div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 24 }}>
            {fmtNum(totalUnits)} units across {matchedLines.length} lines &middot;{" "}
            {fmt(totalCost)}
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button style={BS} onClick={onClose}>
              Close
            </button>
            <button style={BP} onClick={reset}>
              Import Another
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
