import { useState, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import { COL_ALIASES } from "../lib/constants";
import { uid, fmt, fmtNum, fmtDate, nowIso, todayIso, parseCSV, detectCol } from "../lib/utils";
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

// --- Wizard steps ------------------------------------------------------------
const STEPS = [
  { key: "upload", label: "Upload File" },
  { key: "map", label: "Map Columns" },
  { key: "review", label: "Review & Import" },
  { key: "done", label: "Done" },
];

// --- Supplier format definitions ---------------------------------------------
// Each defines how to parse proforma invoices from that supplier.
const SUPPLIER_FORMATS = {
  pokee: {
    name: "Pokee Fishing Tackle Co., Ltd.",
    detect: (sheetData) => {
      // Pokee invoices have "PROFORMA INVOICE" near top and column "Barcode No."
      const flat = sheetData.slice(0, 15).map((r) => r.join(" ").toLowerCase());
      return flat.some((r) => r.includes("pokee")) ||
        (flat.some((r) => r.includes("proforma invoice")) && flat.some((r) => r.includes("barcode")));
    },
    parse: (sheetData) => {
      // Find header row containing "Item No." or "QTY"
      let headerIdx = -1;
      for (let i = 0; i < Math.min(sheetData.length, 25); i++) {
        const row = sheetData[i].map((c) => String(c || "").toLowerCase().trim());
        if (row.some((c) => c.includes("item no")) && row.some((c) => c === "qty" || c === "quantity")) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx < 0) return null;

      const headers = sheetData[headerIdx].map((c) => String(c || "").trim());

      // Find PI number from rows above header
      let piNumber = "";
      let piDate = "";
      for (let i = 0; i < headerIdx; i++) {
        const row = sheetData[i].map((c) => String(c || "").trim());
        const joined = row.join(" ");
        const piMatch = joined.match(/PI\s*(?:NO\.?|#|Number)?\s*:?\s*([A-Z0-9]+)/i);
        if (piMatch) piNumber = piMatch[1];
        const dateMatch = joined.match(/Date\s*:?\s*([\d/.-]+\s*\w*\s*\d{4}|\d{4}[-/]\d{2}[-/]\d{2})/i);
        if (dateMatch) piDate = dateMatch[1];
      }

      // Map column indices
      const colIdx = {};
      headers.forEach((h, i) => {
        const lc = h.toLowerCase();
        if (lc.includes("item no")) colIdx.sku = i;
        else if (lc === "description" || lc.includes("description")) colIdx.desc = i;
        else if (lc === "qty" || lc === "quantity") colIdx.qty = i;
        else if (lc.includes("fob") || lc.includes("unit price") || lc.includes("price")) colIdx.cost = i;
        else if (lc === "color" || lc.includes("color")) colIdx.color = i;
        else if (lc.includes("amount")) colIdx.amount = i;
      });

      if (colIdx.sku == null || colIdx.qty == null) return null;

      const products = [];
      for (let i = headerIdx + 1; i < sheetData.length; i++) {
        const row = sheetData[i];
        if (!row || row.length === 0) continue;
        const sku = String(row[colIdx.sku] || "").trim();
        const qty = parseInt(String(row[colIdx.qty] || "0").replace(/[^0-9.-]/g, "")) || 0;
        if (!sku || qty <= 0) continue;
        // Check for total row
        if (sku.toLowerCase().includes("total")) break;

        const cost = colIdx.cost != null ? parseFloat(String(row[colIdx.cost] || "0").replace(/[^0-9.-]/g, "")) || 0 : 0;
        const desc = colIdx.desc != null ? String(row[colIdx.desc] || "").trim() : "";
        const color = colIdx.color != null ? String(row[colIdx.color] || "").trim() : "";
        const fullDesc = [desc, color].filter(Boolean).join(" - ");

        products.push({ sku, desc: fullDesc, qty, cost, ext: qty * cost });
      }

      return {
        supplierHint: "Pokee Fishing Tackle Co., Ltd.",
        poRef: piNumber,
        date: piDate,
        products,
      };
    },
  },
  fishingCapital: {
    name: "Fishing Capital Company Limited",
    detect: (sheetData) => {
      const flat = sheetData.slice(0, 15).map((r) => r.join(" ").toLowerCase());
      return flat.some((r) => r.includes("fishing capital"));
    },
    parse: (sheetData) => {
      let headerIdx = -1;
      for (let i = 0; i < Math.min(sheetData.length, 25); i++) {
        const row = sheetData[i].map((c) => String(c || "").toLowerCase().trim());
        if (row.some((c) => c.includes("cust_item") || c.includes("cust item")) && row.some((c) => c === "quantity" || c === "qty")) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx < 0) {
        // Fallback: look for "Description" + "Quantity"
        for (let i = 0; i < Math.min(sheetData.length, 25); i++) {
          const row = sheetData[i].map((c) => String(c || "").toLowerCase().trim());
          if (row.some((c) => c === "description") && row.some((c) => c === "quantity")) {
            headerIdx = i;
            break;
          }
        }
      }
      if (headerIdx < 0) return null;

      const headers = sheetData[headerIdx].map((c) => String(c || "").trim());

      let scNumber = "";
      let scDate = "";
      for (let i = 0; i < headerIdx; i++) {
        const row = sheetData[i].map((c) => String(c || "").trim());
        const joined = row.join(" ");
        const scMatch = joined.match(/S\/C\s*(?:NO\.?|#|Number)?\s*:?\s*([A-Z0-9]+)/i) ||
          joined.match(/PI\s*(?:NO\.?|#|Number)?\s*:?\s*([A-Z0-9]+)/i) ||
          joined.match(/Contract\s*(?:NO\.?|#)?\s*:?\s*([A-Z0-9]+)/i);
        if (scMatch) scNumber = scMatch[1];
        const dateMatch = joined.match(/Date\s*:?\s*([\d/.-]+\s*\w*\.?\s*\d{4}|\d{4}[-/]\d{2}[-/]\d{2})/i);
        if (dateMatch) scDate = dateMatch[1];
      }

      const colIdx = {};
      headers.forEach((h, i) => {
        const lc = h.toLowerCase();
        if (lc.includes("cust_item") || lc.includes("cust item") || lc.includes("item")) colIdx.sku = i;
        if (lc === "description" || lc.includes("description")) colIdx.desc = i;
        if (lc === "quantity" || lc === "qty") colIdx.qty = i;
        if (lc.includes("unit price") || lc.includes("price")) colIdx.cost = i;
        if (lc === "amount" || lc.includes("amount")) colIdx.amount = i;
      });

      if (colIdx.qty == null) return null;
      // Use desc as fallback for sku if no sku column
      if (colIdx.sku == null && colIdx.desc != null) colIdx.sku = colIdx.desc;

      const products = [];
      for (let i = headerIdx + 1; i < sheetData.length; i++) {
        const row = sheetData[i];
        if (!row || row.length === 0) continue;
        const sku = String(row[colIdx.sku] || "").trim();
        const qty = parseInt(String(row[colIdx.qty] || "0").replace(/[^0-9.-]/g, "")) || 0;
        if (!sku || qty <= 0) continue;
        if (sku.toLowerCase().includes("total")) break;

        const cost = colIdx.cost != null ? parseFloat(String(row[colIdx.cost] || "0").replace(/[^0-9.-]/g, "")) || 0 : 0;
        const desc = colIdx.desc != null && colIdx.desc !== colIdx.sku ? String(row[colIdx.desc] || "").trim() : "";

        products.push({ sku, desc: desc || sku, qty, cost, ext: qty * cost });
      }

      return {
        supplierHint: "Fishing Capital Company Limited",
        poRef: scNumber,
        date: scDate,
        products,
      };
    },
  },
  techAngler: {
    name: "Tech Angler Company Limited",
    detect: (sheetData) => {
      const flat = sheetData.slice(0, 15).map((r) => r.join(" ").toLowerCase());
      return flat.some((r) => r.includes("tech angler"));
    },
    parse: (sheetData) => {
      let headerIdx = -1;
      for (let i = 0; i < Math.min(sheetData.length, 25); i++) {
        const row = sheetData[i].map((c) => String(c || "").toLowerCase().trim());
        if (
          (row.some((c) => c.includes("commodity") || c.includes("specification")) &&
            row.some((c) => c === "quantity" || c === "qty")) ||
          (row.some((c) => c.includes("size")) && row.some((c) => c === "quantity"))
        ) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx < 0) return null;

      const headers = sheetData[headerIdx].map((c) => String(c || "").trim());

      let purchaseNum = "";
      let purchaseDate = "";
      for (let i = 0; i < headerIdx; i++) {
        const row = sheetData[i].map((c) => String(c || "").trim());
        const joined = row.join(" ");
        const pnMatch = joined.match(/Purchase\s*(?:Number|No\.?|#)\s*:?\s*([A-Z0-9]+)/i);
        if (pnMatch) purchaseNum = pnMatch[1];
        const dateMatch = joined.match(/Date\s*:?\s*([\d/.-]+\s*\w*\.?\s*\d{4}|\d{4}[-/]\d{2}[-/]\d{2})/i);
        if (dateMatch) purchaseDate = dateMatch[1];
      }

      const colIdx = {};
      headers.forEach((h, i) => {
        const lc = h.toLowerCase();
        if (lc.includes("commodity") || lc.includes("specification")) colIdx.desc = i;
        // Tech Angler has dual "SIZE" columns -- item code and color name
        if (lc === "size" || lc.includes("item code")) {
          if (colIdx.sku == null) colIdx.sku = i;
          else colIdx.color = i;
        }
        if (lc === "quantity" || lc === "qty") colIdx.qty = i;
        if (lc.includes("unit price") || lc.includes("price")) colIdx.cost = i;
        if (lc === "amount" || lc.includes("amount")) colIdx.amount = i;
      });

      if (colIdx.qty == null) return null;
      if (colIdx.sku == null && colIdx.desc != null) colIdx.sku = colIdx.desc;

      const products = [];
      let currentDesc = "";
      for (let i = headerIdx + 1; i < sheetData.length; i++) {
        const row = sheetData[i];
        if (!row || row.length === 0) continue;

        // Tech Angler uses merged cells for category description
        const descVal = colIdx.desc != null ? String(row[colIdx.desc] || "").trim() : "";
        if (descVal && descVal.length > 0) currentDesc = descVal;

        const sku = colIdx.sku != null ? String(row[colIdx.sku] || "").trim() : "";
        const qty = parseInt(String(row[colIdx.qty] || "0").replace(/[^0-9.-]/g, "")) || 0;
        if (!sku || qty <= 0) continue;
        if (sku.toLowerCase().includes("total")) break;

        const cost = colIdx.cost != null ? parseFloat(String(row[colIdx.cost] || "0").replace(/[^0-9.-]/g, "")) || 0 : 0;
        const color = colIdx.color != null ? String(row[colIdx.color] || "").trim() : "";
        const fullDesc = [currentDesc, color].filter(Boolean).join(" - ");

        products.push({ sku, desc: fullDesc || sku, qty, cost, ext: qty * cost });
      }

      return {
        supplierHint: "Tech Angler Company Limited",
        poRef: purchaseNum,
        date: purchaseDate,
        products,
      };
    },
  },
};

// =============================================================================
// SupplierPOImport component
// =============================================================================
export default function SupplierPOImport({ data, setData, onClose }) {
  const [step, setStep] = useState("upload");
  const [rawRows, setRawRows] = useState([]);
  const [fileHeaders, setFileHeaders] = useState([]);
  const [colMap, setColMap] = useState({});
  const [parsedMeta, setParsedMeta] = useState(null); // result of supplier-specific parser
  const [supplierId, setSupplierId] = useState("");
  const [poInfo, setPoInfo] = useState({
    poRef: "",
    date: todayIso(),
    expectedDate: "",
    notes: "",
  });
  const [lines, setLines] = useState([]);
  const [error, setError] = useState("");
  const [importMode, setImportMode] = useState(""); // "csv" | "supplier"
  const [parsing, setParsing] = useState(false); // true while AI reads a PDF
  const fileRef = useRef();

  // --- Product lookup by SKU ---
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

  const suppMap = useMemo(
    () => Object.fromEntries(data.suppliers.map((s) => [s.id, s])),
    [data.suppliers],
  );

  // --- Try to match supplier by name hint ---
  const matchSupplier = (hint) => {
    if (!hint) return "";
    const lc = hint.toLowerCase();
    const match = data.suppliers.find((s) => lc.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(lc));
    return match ? match.id : "";
  };

  // --- File upload handler ---
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
          setColMap(autoMap);

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

          // Try each supplier-specific format
          for (const [, format] of Object.entries(SUPPLIER_FORMATS)) {
            if (format.detect(sheetData)) {
              const meta = format.parse(sheetData);
              if (meta && meta.products.length > 0) {
                setParsedMeta(meta);
                const sid = matchSupplier(meta.supplierHint);
                if (sid) setSupplierId(sid);
                setPoInfo((p) => ({
                  ...p,
                  poRef: meta.poRef || "",
                  date: meta.date || todayIso(),
                }));

                // Pre-match products
                const matched = meta.products.map((prod) => {
                  const found = findProduct(prod.sku);
                  return {
                    ...prod,
                    productId: found ? found.id : "",
                    productName: found ? found.name : "",
                    matched: !!found,
                  };
                });
                setLines(matched);
                setImportMode("supplier");
                setStep("review");
                return;
              }
            }
          }

          // Fallback: generic XLSX table
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
          setColMap(autoMap);

          setImportMode("csv");
          setStep("map");
        } catch (err) {
          setError("Failed to parse spreadsheet: " + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (ext === "pdf") {
      const reader = new FileReader();
      reader.onload = async (e) => {
        setParsing(true);
        try {
          // e.target.result is a data: URL -- strip the prefix to get raw base64
          const pdfBase64 = String(e.target.result).replace(/^data:.*?;base64,/, "");

          const resp = await fetch("/api/parse-po", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pdfBase64, filename: file.name }),
          });
          const result = await resp.json();

          if (!result.success || !result.parsed || !Array.isArray(result.parsed.lines)) {
            setError(
              result.reason === "not-configured"
                ? "AI parsing not configured. Couldn't read this PDF automatically. Export it as CSV/XLSX or enter the PO manually."
                : "Couldn't read this PDF automatically. Export it as CSV/XLSX or enter the PO manually.",
            );
            return;
          }

          const parsed = result.parsed;
          const products = parsed.lines
            .map((l) => {
              const sku = String(l.sku || "").trim();
              const desc = String(l.description || "").trim();
              const qty = parseInt(String(l.qty ?? "0").replace(/[^0-9.-]/g, "")) || 0;
              const cost = parseFloat(String(l.unitCost ?? "0").replace(/[^0-9.-]/g, "")) || 0;
              return { sku, desc: desc || sku, qty, cost, ext: qty * cost };
            })
            .filter((p) => p.sku && p.qty > 0);

          if (products.length === 0) {
            setError("Couldn't read this PDF automatically. Export it as CSV/XLSX or enter the PO manually.");
            return;
          }

          const meta = {
            supplierHint: String(parsed.supplier || "").trim(),
            poRef: String(parsed.poRef || "").trim(),
            date: String(parsed.date || "").trim(),
            products,
          };
          setParsedMeta(meta);
          const sid = matchSupplier(meta.supplierHint);
          if (sid) setSupplierId(sid);
          setPoInfo((p) => ({
            ...p,
            poRef: meta.poRef || "",
            date: meta.date || todayIso(),
          }));

          // Pre-match products (same as the supplier-specific XLSX parsers)
          const matched = meta.products.map((prod) => {
            const found = findProduct(prod.sku);
            return {
              ...prod,
              productId: found ? found.id : "",
              productName: found ? found.name : "",
              matched: !!found,
            };
          });
          setLines(matched);
          setImportMode("supplier");
          setStep("review");
        } catch (err) {
          setError("Couldn't read this PDF automatically. Export it as CSV/XLSX or enter the PO manually.");
        } finally {
          setParsing(false);
        }
      };
      reader.readAsDataURL(file);
    } else {
      setError("Unsupported file type. Please upload a .csv, .xlsx, or .pdf file.");
    }
  };

  // --- Build lines from CSV column mapping ---
  const buildLinesFromMap = () => {
    if (!colMap.sku || !colMap.qty) {
      setError("SKU and Quantity columns are required.");
      return;
    }
    const built = rawRows
      .map((row) => {
        const sku = String(row[colMap.sku] || "").trim();
        const qty = parseInt(String(row[colMap.qty] || "0").replace(/\s/g, "")) || 0;
        const cost = colMap.price ? parseFloat(row[colMap.price]) || 0 : 0;
        const name = colMap.name ? String(row[colMap.name] || "").trim() : "";
        if (!sku || qty <= 0) return null;
        const prod = findProduct(sku);
        return {
          sku,
          qty,
          cost,
          desc: name || (prod ? prod.name : ""),
          productId: prod ? prod.id : "",
          productName: prod ? prod.name : "",
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

  // --- Create the purchase order ---
  const doImport = () => {
    const validLines = lines.filter((l) => l.qty > 0);
    if (validLines.length === 0) {
      setError("No lines to import.");
      return;
    }
    if (!supplierId) {
      setError("Please select a supplier.");
      return;
    }

    const num = (data.counters.po || 0) + 1;
    const orderNum = `PO-${String(num).padStart(4, "0")}`;

    const poLines = validLines.map((l) => ({
      productId: l.productId || "",
      qty: l.qty,
      cost: l.cost || 0,
    }));

    const totalUnits = poLines.reduce((s, l) => s + l.qty, 0);
    const totalCost = poLines.reduce((s, l) => s + l.qty * l.cost, 0);
    const supplierName = suppMap[supplierId]?.name || "Unknown";

    const po = {
      id: uid(),
      orderNum,
      supplierId,
      date: poInfo.date || todayIso(),
      expectedDate: poInfo.expectedDate || "",
      status: "ordered",
      lines: poLines.filter((l) => l.productId),
      notes: poInfo.notes || (poInfo.poRef ? `Supplier Ref: ${poInfo.poRef}` : ""),
    };

    const desc = `Imported supplier PO from ${supplierName} -- ${validLines.length} lines * ${fmtNum(totalUnits)} units * ${fmt(totalCost)}${poInfo.poRef ? ` * Ref: ${poInfo.poRef}` : ""}`;

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
          entity: orderNum,
          description: desc,
        },
      ],
    }));

    setStep("done");
  };

  // --- Reset ---
  const reset = () => {
    setStep("upload");
    setRawRows([]);
    setFileHeaders([]);
    setColMap({});
    setParsedMeta(null);
    setSupplierId("");
    setPoInfo({ poRef: "", date: todayIso(), expectedDate: "", notes: "" });
    setLines([]);
    setError("");
    setImportMode("");
  };

  // --- Stats ---
  // Manually map an unmatched supplier item code to one of our products (or
  // clear a manual mapping by passing an empty productId).
  const remapLine = (idx, productId) => {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        if (!productId) return { ...l, productId: "", productName: "", matched: false, remapped: false };
        const prod = data.products.find((p) => p.id === productId);
        return {
          ...l,
          productId,
          productName: prod ? prod.name : "",
          matched: true,
          remapped: true,
        };
      }),
    );
  };
  const productOptions = useMemo(
    () => [...data.products].sort((a, b) => a.sku.localeCompare(b.sku)),
    [data.products],
  );

  const matchedLines = lines.filter((l) => l.matched);
  const unmatchedLines = lines.filter((l) => !l.matched);
  const totalUnits = lines.reduce((s, l) => s + l.qty, 0);
  const totalCost = lines.reduce((s, l) => s + l.qty * (l.cost || 0), 0);

  // ===========================================================================
  // RENDER
  // ===========================================================================
  return (
    <Modal title="Import Supplier PO" onClose={onClose} width={820}>
      <StepTab steps={STEPS} current={step} />

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
              cursor: parsing ? "wait" : "pointer",
              background: "#F8FAFC",
              opacity: parsing ? 0.7 : 1,
              transition: "border-color 0.15s",
            }}
            onClick={() => !parsing && fileRef.current && fileRef.current.click()}
            onDragOver={(e) => {
              e.preventDefault();
              if (!parsing) e.currentTarget.style.borderColor = "#6D28D9";
            }}
            onDragLeave={(e) => {
              e.currentTarget.style.borderColor = "#CBD5E1";
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.style.borderColor = "#CBD5E1";
              if (parsing) return;
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
          >
            {parsing ? (
              <>
                <div style={{ fontSize: 36, marginBottom: 8 }}>&#129302;</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>
                  Reading PDF with AI &mdash; usually 10-20 seconds...
                </div>
                <div style={{ fontSize: 12, color: "#64748B" }}>
                  Extracting supplier, PO number, and line items from the document.
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 36, marginBottom: 8 }}>&#128194;</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 4 }}>
                  Drop a supplier PO file here or click to browse
                </div>
                <div style={{ fontSize: 12, color: "#64748B" }}>
                  Supports: Pokee, Fishing Capital, Tech Angler proforma invoices (.xlsx), any supplier PDF, or generic CSV
                </div>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls,.pdf"
              style={{ display: "none" }}
              disabled={parsing}
              onChange={(e) => {
                const f = e.target.files[0];
                if (f) handleFile(f);
                e.target.value = "";
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
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Supported supplier formats:</div>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
              <li>
                <strong>Pokee Fishing Tackle</strong> -- Proforma invoice with Item No., QTY, FOB Price columns.
              </li>
              <li>
                <strong>Fishing Capital</strong> -- Sales confirmation with Cust_Item, Quantity, Unit Price columns.
              </li>
              <li>
                <strong>Tech Angler</strong> -- Purchase order with Commodity/Specification, SIZE, Quantity columns.
              </li>
              <li>
                <strong>PDF</strong> -- any supplier proforma/PO, extracted automatically with AI.
              </li>
              <li>
                <strong>CSV / Generic Excel</strong> -- Map columns for SKU and Quantity manually.
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
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", marginBottom: 12 }}>
              Map Columns
            </div>
            <div style={{ fontSize: 12, color: "#64748B", marginBottom: 14 }}>
              Found <strong>{rawRows.length}</strong> rows with{" "}
              <strong>{fileHeaders.length}</strong> columns. Map the required columns below.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
              <Field label="SKU / Item Column *">
                <select
                  style={SS}
                  value={colMap.sku || ""}
                  onChange={(e) => setColMap((m) => ({ ...m, sku: e.target.value }))}
                >
                  <option value="">-- select --</option>
                  {fileHeaders.map((h) => (
                    <option key={h} value={h}>{h}</option>
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
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </Field>
              <Field label="Unit Cost Column">
                <select
                  style={SS}
                  value={colMap.price || ""}
                  onChange={(e) => setColMap((m) => ({ ...m, price: e.target.value }))}
                >
                  <option value="">-- none --</option>
                  {fileHeaders.map((h) => (
                    <option key={h} value={h}>{h}</option>
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
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          {/* PO info */}
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
              PO Info
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
              <Field label="Supplier *">
                <select
                  style={SS}
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">-- select --</option>
                  {data.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Supplier Reference #">
                <input
                  style={IS}
                  value={poInfo.poRef}
                  onChange={(e) => setPoInfo((p) => ({ ...p, poRef: e.target.value }))}
                  placeholder="e.g. PI2507035"
                />
              </Field>
              <Field label="Order Date">
                <input
                  style={IS}
                  type="date"
                  value={poInfo.date}
                  onChange={(e) => setPoInfo((p) => ({ ...p, date: e.target.value }))}
                />
              </Field>
              <Field label="Expected Delivery">
                <input
                  style={IS}
                  type="date"
                  value={poInfo.expectedDate}
                  onChange={(e) => setPoInfo((p) => ({ ...p, expectedDate: e.target.value }))}
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
                      <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748B" }}>Cost</th>
                    )}
                    {colMap.name && (
                      <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748B" }}>Description</th>
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
                        <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 11 }}>
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
      {/* STEP: REVIEW                                                       */}
      {/* ================================================================== */}
      {step === "review" && (
        <div>
          {/* PO info card */}
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
              {parsedMeta ? `Auto-detected: ${parsedMeta.supplierHint}` : "Supplier PO Details"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
              <Field label="Supplier *">
                <select
                  style={SS}
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">-- select --</option>
                  {data.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Supplier Reference #">
                <input
                  style={IS}
                  value={poInfo.poRef}
                  onChange={(e) => setPoInfo((p) => ({ ...p, poRef: e.target.value }))}
                  placeholder="e.g. ACC20250731"
                />
              </Field>
              <Field label="Order Date">
                <input
                  style={IS}
                  type="date"
                  value={poInfo.date}
                  onChange={(e) => setPoInfo((p) => ({ ...p, date: e.target.value }))}
                />
              </Field>
              <Field label="Expected Delivery">
                <input
                  style={IS}
                  type="date"
                  value={poInfo.expectedDate}
                  onChange={(e) => setPoInfo((p) => ({ ...p, expectedDate: e.target.value }))}
                />
              </Field>
            </div>
            <Field label="Notes">
              <textarea
                style={{ ...IS, minHeight: 40, resize: "vertical" }}
                value={poInfo.notes}
                onChange={(e) => setPoInfo((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Optional notes"
              />
            </Field>
          </div>

          {/* Line items table */}
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
                Line Items ({lines.length})
              </div>
              <div style={{ fontSize: 12, color: "#64748B" }}>
                {matchedLines.length} matched &middot;{" "}
                {unmatchedLines.length > 0 ? (
                  <span style={{ color: "#DC2626" }}>{unmatchedLines.length} unmatched</span>
                ) : (
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
                      Unit Cost
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
                      <td style={{ padding: "7px 12px", textAlign: "right", color: "#475569" }}>
                        {fmt(l.cost)}
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
                        {l.matched && !l.remapped ? (
                          <Badge status="confirmed" label="OK" />
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
                            {l.remapped && <Badge status="confirmed" label="Mapped" />}
                            <select
                              style={{ ...SS, maxWidth: 200, fontSize: 11 }}
                              value={l.remapped ? l.productId : ""}
                              onChange={(e) => remapLine(i, e.target.value)}
                            >
                              <option value="">
                                {l.remapped ? "-- clear mapping --" : "-- map to product --"}
                              </option>
                              {productOptions.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.sku} — {p.name.slice(0, 40)}
                                </option>
                              ))}
                            </select>
                          </div>
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
                {fmtNum(totalUnits)} units across {lines.length} lines
              </span>
              <span style={{ color: "#0F172A" }}>Total: {fmt(totalCost)}</span>
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
              not found in inventory. Unmatched lines will be skipped.{" "}
              {unmatchedLines.map((l) => l.sku).join(", ")}
            </div>
          )}

          {/* Footer */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              style={BS}
              onClick={() => {
                if (importMode === "supplier") reset();
                else setStep("map");
              }}
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
              disabled={lines.filter((l) => l.qty > 0).length === 0 || !supplierId}
            >
              Import as Supplier PO
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
            Created supplier PO for{" "}
            <strong>{suppMap[supplierId]?.name || "Unknown"}</strong>
            {poInfo.poRef && (
              <>
                {" "}
                (Ref: <span style={{ fontFamily: "monospace", color: "#6D28D9" }}>{poInfo.poRef}</span>)
              </>
            )}
          </div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 24 }}>
            {fmtNum(totalUnits)} units across {lines.length} lines &middot; {fmt(totalCost)}
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
