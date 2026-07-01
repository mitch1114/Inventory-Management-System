import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { uid, fmtNum, nowIso, toCSV, dlCSV } from "../lib/utils";
import { Modal, Field, Table, TR, TD, IS, SS, BP, BS, BD, BG, BAq } from "./ui";
import HelpPanel from "./HelpPanel";

const CYCLE_COUNT_HELP = [
  {
    heading: "Choose a count scope",
    body: "Select \"All Products\" or a specific category from the dropdown, then click Start Count. Narrowing by category is great for weekly rotations -- count rods one week, reels the next.",
  },
  {
    heading: "Scan or type counts",
    body: "Use the barcode scanner (click \"Start Scanner\" to open your camera) to scan each unit on the shelf -- every scan adds +1 to that product. You can also type quantities directly into the number fields or use the +/- buttons.",
  },
  {
    heading: "Quick actions",
    body: "\"Set All to System Qty\" pre-fills every line with the current system quantity -- useful when most items are correct and you only need to adjust the exceptions. \"Reset All Counts\" clears everything back to uncounted.",
  },
  {
    heading: "Filter and search",
    body: "Use the filter chips to show only uncounted items or items with variances. The search bar filters by SKU or product name to quickly find specific items.",
  },
  {
    heading: "Review and apply",
    body: "Click \"Finish Count\" to see a summary of all variances. Review the differences, then click \"Apply Adjustments\" to update system inventory. Each adjustment is logged in the Audit Log with the old and new quantities. You can also export a CSV variance report before applying.",
  },
];

// --- Styles --------------------------------------------------------------------
const headerCell = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 10,
  fontWeight: 700,
  color: "#94A3B8",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  borderBottom: "1px solid #E2E8F0",
  whiteSpace: "nowrap",
  background: "#F8FAFC",
};
const cellStyle = {
  padding: "10px 12px",
  fontSize: 13,
  borderBottom: "1px solid #F1F5F9",
  verticalAlign: "middle",
};
const monoCell = { ...cellStyle, fontFamily: "monospace", fontWeight: 600 };

const KPI = ({ label, value, color, bg, border }) => (
  <div
    style={{
      background: bg || "#F8FAFC",
      border: `1px solid ${border || "#E2E8F0"}`,
      borderRadius: 10,
      padding: "14px 16px",
      textAlign: "center",
    }}
  >
    <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600, textTransform: "uppercase" }}>
      {label}
    </div>
    <div style={{ fontSize: 22, fontWeight: 800, color: color || "#0F172A", marginTop: 2 }}>
      {value}
    </div>
  </div>
);

// --- Component -----------------------------------------------------------------
export default function CycleCount({ data, setData }) {
  const [counting, setCounting] = useState(false); // active count session
  const [lines, setLines] = useState([]); // { productId, sku, name, category, systemQty, countedQty }
  const [countScope, setCountScope] = useState("all"); // "all" | category name
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // "all" | "variance" | "uncounted"

  // Scanner state
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [scanError, setScanError] = useState(null);
  const scannerRef = useRef(null);
  const scannerDivId = "cycle-count-scanner";
  // The html5-qrcode success callback is registered once at scanner start, so it
  // would capture a stale handleBarcodeScan (and stale count lines). Route every
  // scan through this ref, which is refreshed each render with the latest handler.
  const scanHandlerRef = useRef(null);
  // Debounce repeat reads: the camera fires ~10x/sec while a barcode is in frame.
  const lastReadRef = useRef({ code: null, ts: 0 });

  // Review state (after count is complete)
  const [reviewing, setReviewing] = useState(false);

  // Product lookups
  const prodMap = useMemo(
    () => Object.fromEntries(data.products.map((p) => [p.id, p])),
    [data.products],
  );
  const skuMap = useMemo(() => {
    const m = {};
    data.products.forEach((p) => {
      m[p.sku.toLowerCase()] = p.id;
      m[p.sku.toLowerCase().replace(/[-\s]/g, "")] = p.id;
    });
    return m;
  }, [data.products]);

  const categories = useMemo(() => {
    const s = new Set(data.products.map((p) => p.category).filter(Boolean));
    return [...s].sort();
  }, [data.products]);

  // Count history
  const countHistory = useMemo(() => {
    return (data.auditLog || [])
      .filter((a) => a.type === "cycle-count")
      .reverse()
      .slice(0, 20);
  }, [data.auditLog]);

  // Cleanup scanner on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, []);

  // --- Start a new count -------------------------------------------------------
  const startCount = () => {
    const scope =
      countScope === "all"
        ? data.products
        : data.products.filter((p) => p.category === countScope);

    const countLines = scope.map((p) => ({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category || "--",
      systemQty: p.onHand,
      countedQty: null, // null = not yet counted
    }));

    setLines(countLines);
    setCounting(true);
    setReviewing(false);
    setSearch("");
    setFilter("all");
  };

  // --- Scanner controls --------------------------------------------------------
  const startScanner = useCallback(async () => {
    setScanError(null);
    setScanning(true);
    await new Promise((r) => setTimeout(r, 100));

    const scanner = new Html5Qrcode(scannerDivId);
    scannerRef.current = scanner;

    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 280, height: 100 }, aspectRatio: 2.0 },
        (decodedText) => {
          const now = Date.now();
          const last = lastReadRef.current;
          if (decodedText === last.code && now - last.ts < 1500) return;
          lastReadRef.current = { code: decodedText, ts: now };
          if (scanHandlerRef.current) scanHandlerRef.current(decodedText);
        },
        () => {},
      );
    } catch (err) {
      setScanError(
        err.toString().includes("NotAllowedError")
          ? "Camera access denied. Please allow camera permissions and try again."
          : "Could not start camera. Make sure no other app is using it.",
      );
      setScanning(false);
    }
  }, []);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch (_) {}
      scannerRef.current = null;
    }
    setScanning(false);
  }, []);

  // --- Barcode handler ---------------------------------------------------------
  const handleBarcodeScan = useCallback(
    (code) => {
      const normalized = code.toLowerCase().replace(/[-\s]/g, "");
      const productId = skuMap[code.toLowerCase()] || skuMap[normalized];

      if (!productId) {
        setLastScan({ code, matched: false });
        return;
      }

      const lineIdx = lines.findIndex((l) => l.productId === productId);
      if (lineIdx === -1) {
        const prod = prodMap[productId];
        setLastScan({
          code,
          matched: false,
          reason: `${prod?.sku || code} is not in this count scope`,
        });
        return;
      }

      const prod = prodMap[productId];
      setLines((prev) =>
        prev.map((l, i) =>
          i === lineIdx
            ? { ...l, countedQty: (l.countedQty || 0) + 1 }
            : l,
        ),
      );
      setLastScan({ code, matched: true, sku: prod?.sku, name: prod?.name });
    },
    [lines, skuMap, prodMap],
  );

  // Keep the scanner callback pointed at the latest handler (fresh `lines` closure).
  useEffect(() => {
    scanHandlerRef.current = handleBarcodeScan;
  }, [handleBarcodeScan]);

  // --- Line helpers ------------------------------------------------------------
  const setLineQty = (idx, val) =>
    setLines((prev) =>
      prev.map((l, i) =>
        i === idx ? { ...l, countedQty: Math.max(0, val) } : l,
      ),
    );

  const markAllAsSystem = () =>
    setLines((prev) => prev.map((l) => ({ ...l, countedQty: l.systemQty })));

  const resetAllCounts = () =>
    setLines((prev) => prev.map((l) => ({ ...l, countedQty: null })));

  // --- Filtered lines ----------------------------------------------------------
  const filteredLines = useMemo(() => {
    let result = lines;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (l) =>
          l.sku.toLowerCase().includes(q) ||
          l.name.toLowerCase().includes(q) ||
          l.category.toLowerCase().includes(q),
      );
    }
    if (filter === "variance") {
      result = result.filter(
        (l) => l.countedQty !== null && l.countedQty !== l.systemQty,
      );
    } else if (filter === "uncounted") {
      result = result.filter((l) => l.countedQty === null);
    }
    return result;
  }, [lines, search, filter]);

  // --- Summary stats -----------------------------------------------------------
  const totalItems = lines.length;
  const counted = lines.filter((l) => l.countedQty !== null).length;
  const withVariance = lines.filter(
    (l) => l.countedQty !== null && l.countedQty !== l.systemQty,
  );
  const totalSystemQty = lines.reduce((s, l) => s + l.systemQty, 0);
  const totalCountedQty = lines
    .filter((l) => l.countedQty !== null)
    .reduce((s, l) => s + l.countedQty, 0);
  const netVariance = lines
    .filter((l) => l.countedQty !== null)
    .reduce((s, l) => s + (l.countedQty - l.systemQty), 0);

  // --- Finalize count (review step) -------------------------------------------
  const finishCounting = async () => {
    await stopScanner();
    setReviewing(true);
  };

  // --- Apply adjustments -------------------------------------------------------
  const applyAdjustments = () => {
    const adjustments = lines.filter(
      (l) => l.countedQty !== null && l.countedQty !== l.systemQty,
    );

    if (adjustments.length === 0) {
      // No variances -- just log the count
      setData((d) => ({
        ...d,
        auditLog: [
          ...(d.auditLog || []),
          {
            id: uid(),
            ts: nowIso(),
            type: "cycle-count",
            entity: "Cycle Count",
            description: `Cycle count completed -- ${counted}/${totalItems} items counted, no variances found`,
          },
        ],
      }));
    } else {
      // Apply inventory adjustments
      const updatedProducts = data.products.map((p) => {
        const adj = adjustments.find((a) => a.productId === p.id);
        if (!adj) return p;
        return { ...p, onHand: adj.countedQty };
      });

      const logEntries = [
        {
          id: uid(),
          ts: nowIso(),
          type: "cycle-count",
          entity: "Cycle Count",
          description: `Cycle count completed -- ${counted}/${totalItems} items counted, ${adjustments.length} variance${adjustments.length !== 1 ? "s" : ""} adjusted (net ${netVariance >= 0 ? "+" : ""}${netVariance} units)`,
        },
        ...adjustments.map((a) => {
          const diff = a.countedQty - a.systemQty;
          return {
            id: uid(),
            ts: nowIso(),
            type: "cycle-count",
            entity: a.sku,
            description: `${a.sku} adjusted: ${fmtNum(a.systemQty)} -> ${fmtNum(a.countedQty)} (${diff > 0 ? "+" : ""}${diff}) -- Cycle count`,
          };
        }),
      ];

      setData((d) => ({
        ...d,
        products: updatedProducts,
        auditLog: [...(d.auditLog || []), ...logEntries],
      }));
    }

    setCounting(false);
    setReviewing(false);
    setLines([]);
  };

  // --- Discard count -----------------------------------------------------------
  const discardCount = async () => {
    if (!confirm("Discard this count session? All counts will be lost.")) return;
    await stopScanner();
    setCounting(false);
    setReviewing(false);
    setLines([]);
  };

  // --- Export variance report --------------------------------------------------
  const exportVarianceCSV = () => {
    const rows = lines
      .filter((l) => l.countedQty !== null)
      .map((l) => ({
        SKU: l.sku,
        Product: l.name,
        Category: l.category,
        "System Qty": l.systemQty,
        "Counted Qty": l.countedQty,
        Variance: l.countedQty - l.systemQty,
      }));
    const csv = toCSV(rows, ["SKU", "Product", "Category", "System Qty", "Counted Qty", "Variance"]);
    dlCSV(csv, `cycle-count-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // --- Render: Landing (no active count) ---------------------------------------
  if (!counting) {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>
              Cycle Count
            </h2>
            <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 13 }}>
              Verify shelf inventory against system records
            </p>
          </div>
          <HelpPanel title="Cycle Count Guide" sections={CYCLE_COUNT_HELP} buttonLabel="How It Works" />
        </div>

        {/* Start new count card */}
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E2E8F0",
            borderRadius: 12,
            padding: 24,
            marginBottom: 24,
          }}
        >
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", margin: "0 0 16px" }}>
            Start New Count
          </h3>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-end" }}>
            <Field label="Count Scope">
              <select
                style={{ ...SS, width: 260 }}
                value={countScope}
                onChange={(e) => setCountScope(e.target.value)}
              >
                <option value="all">
                  All Products ({data.products.length} items)
                </option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c} ({data.products.filter((p) => p.category === c).length} items)
                  </option>
                ))}
              </select>
            </Field>
            <button style={{ ...BP, marginBottom: 14 }} onClick={startCount}>
              Start Count
            </button>
          </div>
          <p style={{ fontSize: 12, color: "#94A3B8", marginTop: 8, marginBottom: 0 }}>
            Choose to count all products or a specific category. Use the barcode scanner or enter quantities manually.
          </p>
        </div>

        {/* Recent count history */}
        {countHistory.length > 0 && (
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E8F0",
              borderRadius: 12,
              padding: 24,
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", margin: "0 0 12px" }}>
              Recent Counts
            </h3>
            <Table
              headers={["Date", "Details"]}
              empty={null}
            >
              {countHistory.map((entry, i) => (
                <TR key={entry.id} i={i}>
                  <TD>
                    <span style={{ fontSize: 12, color: "#64748B", whiteSpace: "nowrap" }}>
                      {new Date(entry.ts).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </TD>
                  <TD>{entry.description}</TD>
                </TR>
              ))}
            </Table>
          </div>
        )}
      </div>
    );
  }

  // --- Render: Review step -----------------------------------------------------
  if (reviewing) {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>
              Review Count Results
            </h2>
            <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 13 }}>
              Review variances before applying adjustments to inventory
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={BS} onClick={exportVarianceCSV}>
              Export CSV
            </button>
          </div>
        </div>

        {/* Summary KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
          <KPI label="Items Counted" value={`${counted}/${totalItems}`} />
          <KPI
            label="Variances Found"
            value={withVariance.length}
            color={withVariance.length > 0 ? "#D97706" : "#15803D"}
            bg={withVariance.length > 0 ? "#FFFBEB" : "#F0FDF4"}
            border={withVariance.length > 0 ? "#FDE68A" : "#BBF7D0"}
          />
          <KPI label="System Total" value={fmtNum(totalSystemQty)} />
          <KPI
            label="Net Variance"
            value={`${netVariance >= 0 ? "+" : ""}${fmtNum(netVariance)}`}
            color={netVariance === 0 ? "#15803D" : netVariance < 0 ? "#DC2626" : "#2563EB"}
            bg={netVariance === 0 ? "#F0FDF4" : netVariance < 0 ? "#FEF2F2" : "#EFF6FF"}
            border={netVariance === 0 ? "#BBF7D0" : netVariance < 0 ? "#FECACA" : "#BFDBFE"}
          />
        </div>

        {/* Variance table */}
        {withVariance.length > 0 ? (
          <div
            style={{
              border: "1px solid #E2E8F0",
              borderRadius: 10,
              overflow: "hidden",
              marginBottom: 20,
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={headerCell}>SKU</th>
                  <th style={headerCell}>Product</th>
                  <th style={{ ...headerCell, textAlign: "center" }}>System Qty</th>
                  <th style={{ ...headerCell, textAlign: "center" }}>Counted Qty</th>
                  <th style={{ ...headerCell, textAlign: "center" }}>Variance</th>
                </tr>
              </thead>
              <tbody>
                {withVariance.map((line, idx) => {
                  const diff = line.countedQty - line.systemQty;
                  return (
                    <tr
                      key={line.productId}
                      style={{
                        background: diff < 0 ? "#FFFBEB" : "#F0FDF4",
                        borderBottom: "1px solid #F1F5F9",
                      }}
                    >
                      <td style={{ ...monoCell, color: "#6D28D9" }}>{line.sku}</td>
                      <td style={cellStyle}>{line.name}</td>
                      <td style={{ ...cellStyle, textAlign: "center", fontWeight: 600 }}>
                        {fmtNum(line.systemQty)}
                      </td>
                      <td style={{ ...cellStyle, textAlign: "center", fontWeight: 700 }}>
                        {fmtNum(line.countedQty)}
                      </td>
                      <td
                        style={{
                          ...cellStyle,
                          textAlign: "center",
                          fontWeight: 700,
                          color: diff < 0 ? "#D97706" : "#0EA5E9",
                        }}
                      >
                        {diff > 0 ? "+" : ""}{diff}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            style={{
              background: "#F0FDF4",
              border: "1px solid #BBF7D0",
              borderRadius: 10,
              padding: "24px",
              textAlign: "center",
              marginBottom: 20,
              fontSize: 14,
              color: "#15803D",
              fontWeight: 600,
            }}
          >
            No variances found. System inventory matches physical counts.
          </div>
        )}

        {/* Uncounted items warning */}
        {counted < totalItems && (
          <div
            style={{
              background: "#FFFBEB",
              border: "1px solid #FDE68A",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 16,
              fontSize: 13,
              color: "#92400E",
            }}
          >
            {totalItems - counted} item{totalItems - counted !== 1 ? "s were" : " was"} not counted. Uncounted items will keep their current system quantities.
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={BS} onClick={() => setReviewing(false)}>
            Back to Counting
          </button>
          <button style={BD} onClick={discardCount}>
            Discard Count
          </button>
          <button style={BG} onClick={applyAdjustments}>
            {withVariance.length > 0
              ? `Apply ${withVariance.length} Adjustment${withVariance.length !== 1 ? "s" : ""}`
              : "Confirm Count (No Changes)"}
          </button>
        </div>
      </div>
    );
  }

  // --- Render: Active counting session -----------------------------------------
  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>
            Cycle Count
          </h2>
          <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 13 }}>
            {countScope === "all" ? "All products" : countScope} &middot;{" "}
            {counted}/{totalItems} counted
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <HelpPanel title="Cycle Count Guide" sections={CYCLE_COUNT_HELP} buttonLabel="Help" />
          <button style={BD} onClick={discardCount}>
            Discard
          </button>
          <button style={BG} onClick={finishCounting}>
            Finish Count
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div
        style={{
          background: "#E2E8F0",
          borderRadius: 6,
          height: 8,
          marginBottom: 20,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: "linear-gradient(135deg, #6D28D9, #4F46E5)",
            height: "100%",
            borderRadius: 6,
            width: `${totalItems > 0 ? (counted / totalItems) * 100 : 0}%`,
            transition: "width 0.3s ease",
          }}
        />
      </div>

      {/* Barcode Scanner */}
      <div
        style={{
          background: "#F8FAFC",
          border: "1px solid #E2E8F0",
          borderRadius: 10,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: scanning ? 12 : 0 }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 14, color: "#0F172A" }}>
              Barcode Scanner
            </span>
            <span style={{ fontSize: 12, color: "#64748B", marginLeft: 8 }}>
              Scan to count +1 per scan
            </span>
          </div>
          {!scanning ? (
            <button
              style={{ ...BP, padding: "8px 16px", fontSize: 12 }}
              onClick={startScanner}
            >
              Start Scanner
            </button>
          ) : (
            <button
              style={{ ...BD, padding: "8px 16px", fontSize: 12 }}
              onClick={stopScanner}
            >
              Stop Scanner
            </button>
          )}
        </div>

        {scanning && (
          <div>
            <div
              id={scannerDivId}
              style={{
                width: "100%",
                maxWidth: 400,
                margin: "0 auto",
                borderRadius: 8,
                overflow: "hidden",
              }}
            />
            <p style={{ fontSize: 11, color: "#94A3B8", textAlign: "center", margin: "8px 0 0" }}>
              Each scan adds +1 to that product's count. Scan every unit on the shelf.
            </p>
          </div>
        )}

        {scanError && (
          <div
            style={{
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: 8,
              padding: "10px 14px",
              marginTop: 10,
              fontSize: 13,
              color: "#DC2626",
            }}
          >
            {scanError}
          </div>
        )}

        {lastScan && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 14px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              background: lastScan.matched ? "#F0FDF4" : "#FEF2F2",
              border: lastScan.matched ? "1px solid #BBF7D0" : "1px solid #FECACA",
              color: lastScan.matched ? "#15803D" : "#DC2626",
            }}
          >
            {lastScan.matched
              ? `Scanned: ${lastScan.sku} -- ${lastScan.name}`
              : `No match for "${lastScan.code}"${lastScan.reason ? ` (${lastScan.reason})` : ""}`}
          </div>
        )}
      </div>

      {/* Quick Actions + Search */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ ...BS, padding: "6px 12px", fontSize: 11 }} onClick={markAllAsSystem}>
            Set All to System Qty
          </button>
          <button style={{ ...BS, padding: "6px 12px", fontSize: 11 }} onClick={resetAllCounts}>
            Reset All Counts
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Filter chips */}
          {[
            { key: "all", label: "All" },
            { key: "uncounted", label: "Uncounted" },
            { key: "variance", label: "Variances" },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                background: filter === f.key ? "#6D28D9" : "#F8FAFC",
                color: filter === f.key ? "#FFFFFF" : "#475569",
                border: filter === f.key ? "1px solid #6D28D9" : "1px solid #CBD5E1",
                borderRadius: 20,
                padding: "5px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {f.label}
            </button>
          ))}
          <input
            style={{ ...IS, width: 180 }}
            placeholder="Search SKU / name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Count Table */}
      <div
        style={{
          border: "1px solid #E2E8F0",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={headerCell}>SKU</th>
              <th style={headerCell}>Product</th>
              <th style={headerCell}>Category</th>
              <th style={{ ...headerCell, textAlign: "center" }}>System Qty</th>
              <th style={{ ...headerCell, textAlign: "center", minWidth: 120 }}>Counted</th>
              <th style={{ ...headerCell, textAlign: "center" }}>Variance</th>
            </tr>
          </thead>
          <tbody>
            {filteredLines.map((line) => {
              const idx = lines.findIndex((l) => l.productId === line.productId);
              const isCounted = line.countedQty !== null;
              const variance = isCounted ? line.countedQty - line.systemQty : null;
              const hasVariance = variance !== null && variance !== 0;
              return (
                <tr
                  key={line.productId}
                  style={{
                    background: !isCounted
                      ? "#FAFAFA"
                      : hasVariance
                        ? variance < 0
                          ? "#FFFBEB"
                          : "#F0FDF4"
                        : "transparent",
                    borderBottom: "1px solid #F1F5F9",
                  }}
                >
                  <td style={{ ...monoCell, color: "#6D28D9" }}>{line.sku}</td>
                  <td style={cellStyle}>{line.name}</td>
                  <td style={{ ...cellStyle, fontSize: 12, color: "#64748B" }}>{line.category}</td>
                  <td style={{ ...cellStyle, textAlign: "center", fontWeight: 600 }}>
                    {fmtNum(line.systemQty)}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                      <button
                        style={{
                          width: 28,
                          height: 28,
                          border: "1px solid #CBD5E1",
                          borderRadius: 6,
                          background: "#F8FAFC",
                          cursor: "pointer",
                          fontSize: 16,
                          fontWeight: 700,
                          color: "#475569",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        onClick={() =>
                          setLineQty(idx, Math.max(0, (line.countedQty || 0) - 1))
                        }
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={isCounted ? line.countedQty : ""}
                        placeholder="--"
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "") {
                            setLines((prev) =>
                              prev.map((l, i) =>
                                i === idx ? { ...l, countedQty: null } : l,
                              ),
                            );
                          } else {
                            setLineQty(idx, parseInt(v) || 0);
                          }
                        }}
                        style={{
                          ...IS,
                          width: 60,
                          textAlign: "center",
                          padding: "5px 4px",
                          fontWeight: 700,
                          fontSize: 14,
                          border: !isCounted
                            ? "1px dashed #CBD5E1"
                            : hasVariance
                              ? variance < 0
                                ? "2px solid #F59E0B"
                                : "2px solid #22C55E"
                              : "1px solid #CBD5E1",
                        }}
                      />
                      <button
                        style={{
                          width: 28,
                          height: 28,
                          border: "1px solid #CBD5E1",
                          borderRadius: 6,
                          background: "#F8FAFC",
                          cursor: "pointer",
                          fontSize: 16,
                          fontWeight: 700,
                          color: "#475569",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        onClick={() => setLineQty(idx, (line.countedQty || 0) + 1)}
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td
                    style={{
                      ...cellStyle,
                      textAlign: "center",
                      fontWeight: 700,
                      color: !isCounted
                        ? "#94A3B8"
                        : !hasVariance
                          ? "#15803D"
                          : variance < 0
                            ? "#D97706"
                            : "#0EA5E9",
                    }}
                  >
                    {!isCounted
                      ? "--"
                      : !hasVariance
                        ? "Match"
                        : `${variance > 0 ? "+" : ""}${variance}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredLines.length === 0 && (
          <div style={{ padding: 48, textAlign: "center", color: "#94A3B8", fontSize: 14 }}>
            {filter !== "all" ? "No items match this filter." : "No products found."}
          </div>
        )}
      </div>

      {/* Count summary */}
      <div
        style={{
          textAlign: "right",
          fontSize: 12,
          color: "#94A3B8",
          marginTop: 10,
        }}
      >
        Showing {filteredLines.length} of {totalItems} items &middot;{" "}
        {counted} counted, {totalItems - counted} remaining
      </div>
    </div>
  );
}
