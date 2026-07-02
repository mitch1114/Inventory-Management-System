import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { autoAllocate } from "../lib/inventory";
import { uid, fmt, fmtNum, nowIso } from "../lib/utils";
import { buildScanIndex, matchScan, SCANNER_CONFIG, CAMERA_CONSTRAINTS, waitForElement } from "../lib/scan";
import { Modal, Field, Badge, IS, SS, BP, BS, BD, BG } from "./ui";

// --- Reason codes for variances ------------------------------------------------
const REASONS = [
  "",
  "Short shipment",
  "Damaged",
  "Wrong item",
  "Over shipment",
  "Other",
];

// --- Styles --------------------------------------------------------------------
const cellStyle = {
  padding: "10px 12px",
  fontSize: 13,
  borderBottom: "1px solid #F1F5F9",
  verticalAlign: "middle",
};
const monoCell = { ...cellStyle, fontFamily: "monospace", fontWeight: 600 };
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

// --- Component -----------------------------------------------------------------
export default function ReceivingModal({ po, data, setData, onClose, onResult }) {
  const prodMap = useMemo(
    () => Object.fromEntries(data.products.map((p) => [p.id, p])),
    [data.products],
  );
  const suppMap = useMemo(
    () => Object.fromEntries(data.suppliers.map((s) => [s.id, s])),
    [data.suppliers],
  );

  // Scannable code (SKU or UPC barcode) -> productId lookup
  const skuMap = useMemo(() => buildScanIndex(data.products), [data.products]);

  // Line-by-line receiving state: { receivedQty, reason }
  const [lines, setLines] = useState(() =>
    po.lines
      .filter((l) => l.productId)
      .map((l) => ({
        productId: l.productId,
        expectedQty: l.qty,
        cost: l.cost,
        receivedQty: 0,
        reason: "",
      })),
  );

  // Scanner state
  const [scanning, setScanning] = useState(false);
  const [scannerReady, setScannerReady] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [scanError, setScanError] = useState(null);
  const scannerRef = useRef(null);
  const scannerDivId = "receiving-scanner";
  // The scan callback is registered once at scanner start; route it through a
  // ref so it always sees the latest handler, and debounce repeat reads (the
  // camera decodes the same barcode ~10x/second while it stays in frame).
  const scanHandlerRef = useRef(null);
  const lastReadRef = useRef({ code: null, ts: 0 });

  // Cleanup scanner on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, []);

  // --- Scanner controls --------------------------------------------------------
  const startScanner = useCallback(async () => {
    if (scannerRef.current) return; // already running
    setScanError(null);
    setScanning(true);
    await waitForElement(scannerDivId);

    const scanner = new Html5Qrcode(scannerDivId);
    scannerRef.current = scanner;

    try {
      await scanner.start(
        CAMERA_CONSTRAINTS,
        SCANNER_CONFIG,
        (decodedText) => {
          const now = Date.now();
          const last = lastReadRef.current;
          if (decodedText === last.code && now - last.ts < 1500) return;
          lastReadRef.current = { code: decodedText, ts: now };
          if (scanHandlerRef.current) scanHandlerRef.current(decodedText);
        },
        () => {}, // ignore errors during scanning
      );
      setScannerReady(true);
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
      try {
        await scannerRef.current.stop();
      } catch (_) {}
      scannerRef.current = null;
    }
    setScanning(false);
    setScannerReady(false);
  }, []);

  // --- Barcode handler ---------------------------------------------------------
  const handleBarcodeScan = useCallback(
    (code) => {
      const productId = matchScan(skuMap, code);

      if (!productId) {
        setLastScan({ code, matched: false });
        return;
      }

      const lineIdx = lines.findIndex((l) => l.productId === productId);
      if (lineIdx === -1) {
        setLastScan({ code, matched: false, reason: "Not on this PO" });
        return;
      }

      const prod = prodMap[productId];
      setLines((prev) =>
        prev.map((l, i) =>
          i === lineIdx ? { ...l, receivedQty: l.receivedQty + 1 } : l,
        ),
      );
      setLastScan({ code, matched: true, sku: prod?.sku, name: prod?.name });
    },
    [lines, skuMap, prodMap],
  );

  // Keep the scanner callback pointed at the latest handler.
  useEffect(() => {
    scanHandlerRef.current = handleBarcodeScan;
  }, [handleBarcodeScan]);

  // --- Line helpers ------------------------------------------------------------
  const setLineField = (idx, field, value) =>
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)),
    );

  const resetAllToZero = () =>
    setLines((prev) => prev.map((l) => ({ ...l, receivedQty: 0, reason: "" })));

  const resetAllToExpected = () =>
    setLines((prev) =>
      prev.map((l) => ({ ...l, receivedQty: l.expectedQty, reason: "" })),
    );

  // --- Summary stats -----------------------------------------------------------
  const totalExpected = lines.reduce((s, l) => s + l.expectedQty, 0);
  const totalReceived = lines.reduce((s, l) => s + l.receivedQty, 0);
  const totalVariance = totalReceived - totalExpected;
  const hasVariance = lines.some((l) => l.receivedQty !== l.expectedQty);
  const linesWithVariance = lines.filter((l) => l.receivedQty !== l.expectedQty);
  const missingReasons = linesWithVariance.filter((l) => !l.reason);

  // --- Confirm receipt ---------------------------------------------------------
  const confirmReceipt = async () => {
    await stopScanner();

    const receivedLines = lines
      .filter((l) => l.receivedQty > 0)
      .map((l) => ({ productId: l.productId, qty: l.receivedQty }));

    // Add received quantities to on-hand
    const updatedProducts = data.products.map((p) => {
      const incoming = receivedLines
        .filter((rl) => rl.productId === p.id)
        .reduce((s, rl) => s + rl.qty, 0);
      return incoming > 0 ? { ...p, onHand: p.onHand + incoming } : p;
    });

    // Determine PO status: fully received or partial
    const allFullyReceived = lines.every(
      (l) => l.receivedQty >= l.expectedQty,
    );
    const nothingReceived = lines.every((l) => l.receivedQty === 0);
    const newStatus = nothingReceived
      ? "ordered"
      : allFullyReceived
        ? "received"
        : "partial";

    // Update PO with received quantities
    const updatedPOs = data.purchaseOrders.map((p) => {
      if (p.id !== po.id) return p;
      return {
        ...p,
        status: newStatus,
        lines: p.lines.map((pl) => {
          const match = lines.find((l) => l.productId === pl.productId);
          if (!match) return pl;
          return { ...pl, qtyReceived: match.receivedQty };
        }),
        receivedDate: newStatus !== "ordered" ? nowIso().slice(0, 10) : undefined,
      };
    });

    // Build audit log entries
    const logEntries = [];

    // Main receiving log
    const varianceNote = hasVariance
      ? ` -- ${linesWithVariance.length} line${linesWithVariance.length > 1 ? "s" : ""} with variance`
      : "";
    logEntries.push({
      id: uid(),
      ts: nowIso(),
      type: "received",
      entity: po.orderNum,
      description: `Received ${po.orderNum} -- ${fmtNum(totalReceived)}/${fmtNum(totalExpected)} units from ${suppMap[po.supplierId]?.name || "Unknown"}${varianceNote}`,
    });

    // Log individual variances
    for (const line of linesWithVariance) {
      const prod = prodMap[line.productId];
      const diff = line.receivedQty - line.expectedQty;
      logEntries.push({
        id: uid(),
        ts: nowIso(),
        type: "receiving-variance",
        entity: po.orderNum,
        description: `${prod?.sku || "?"} -- expected ${fmtNum(line.expectedQty)}, received ${fmtNum(line.receivedQty)} (${diff > 0 ? "+" : ""}${diff})${line.reason ? " -- " + line.reason : ""}`,
      });
    }

    let next = {
      ...data,
      products: updatedProducts,
      purchaseOrders: updatedPOs,
      auditLog: [...(data.auditLog || []), ...logEntries],
    };

    // Auto-allocate backorders if anything was received
    if (receivedLines.length > 0) {
      const before = (next.auditLog || []).length;
      next = autoAllocate(next, receivedLines);
      const after = (next.auditLog || []).length;
      const filled = after - before;

      setData(next);
      onResult(
        filled > 0
          ? `Received ${po.orderNum}: ${fmtNum(totalReceived)}/${fmtNum(totalExpected)} units. Auto-filled ${filled} backorder${filled > 1 ? "s" : ""}.${hasVariance ? ` ${linesWithVariance.length} variance${linesWithVariance.length > 1 ? "s" : ""} logged.` : ""}`
          : `Received ${po.orderNum}: ${fmtNum(totalReceived)}/${fmtNum(totalExpected)} units.${hasVariance ? ` ${linesWithVariance.length} variance${linesWithVariance.length > 1 ? "s" : ""} logged.` : ""}`,
      );
    } else {
      setData(next);
      onResult(`${po.orderNum}: Nothing received.`);
    }

    onClose();
  };

  // --- Render ------------------------------------------------------------------
  const supplier = suppMap[po.supplierId];

  return (
    <Modal
      title={`Receive ${po.orderNum}`}
      onClose={async () => {
        await stopScanner();
        onClose();
      }}
      width={920}
    >
      {/* PO Summary Header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Supplier
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginTop: 2 }}>
            {supplier?.name || "--"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Expected Date
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginTop: 2 }}>
            {po.expectedDate || "--"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Line Items
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", marginTop: 2 }}>
            {lines.length} item{lines.length !== 1 ? "s" : ""} &middot; {fmtNum(totalExpected)} units expected
          </div>
        </div>
      </div>

      {/* Barcode Scanner Section */}
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
              Scan product barcodes to count items as they arrive
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
              Point your camera at a product barcode. Scanned SKUs are matched to PO lines and counts increment automatically.
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

      {/* Quick Actions */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button
          style={{ ...BS, padding: "6px 12px", fontSize: 11 }}
          onClick={resetAllToExpected}
        >
          Set All to Expected
        </button>
        <button
          style={{ ...BS, padding: "6px 12px", fontSize: 11 }}
          onClick={resetAllToZero}
        >
          Reset All to 0
        </button>
      </div>

      {/* Line Items Table */}
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
              <th style={{ ...headerCell, textAlign: "center" }}>Expected</th>
              <th style={{ ...headerCell, textAlign: "center", minWidth: 100 }}>Received</th>
              <th style={{ ...headerCell, textAlign: "center" }}>Variance</th>
              <th style={{ ...headerCell, minWidth: 140 }}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => {
              const prod = prodMap[line.productId];
              const variance = line.receivedQty - line.expectedQty;
              const hasLineVariance = variance !== 0;
              return (
                <tr
                  key={line.productId}
                  style={{
                    background: hasLineVariance
                      ? variance < 0
                        ? "#FFFBEB"
                        : "#F0FDF4"
                      : idx % 2 === 0
                        ? "transparent"
                        : "#FAFAFA",
                    borderBottom: "1px solid #F1F5F9",
                  }}
                >
                  <td style={{ ...monoCell, color: "#6D28D9" }}>
                    {prod?.sku || "--"}
                  </td>
                  <td style={cellStyle}>
                    {prod?.name || "--"}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "center", fontWeight: 600 }}>
                    {fmtNum(line.expectedQty)}
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
                          setLineField(idx, "receivedQty", Math.max(0, line.receivedQty - 1))
                        }
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={line.receivedQty}
                        onChange={(e) =>
                          setLineField(idx, "receivedQty", Math.max(0, parseInt(e.target.value) || 0))
                        }
                        style={{
                          ...IS,
                          width: 60,
                          textAlign: "center",
                          padding: "5px 4px",
                          fontWeight: 700,
                          fontSize: 14,
                          border: hasLineVariance
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
                        onClick={() =>
                          setLineField(idx, "receivedQty", line.receivedQty + 1)
                        }
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
                      color: !hasLineVariance
                        ? "#15803D"
                        : variance < 0
                          ? "#D97706"
                          : "#0EA5E9",
                    }}
                  >
                    {!hasLineVariance
                      ? "Match"
                      : `${variance > 0 ? "+" : ""}${variance}`}
                  </td>
                  <td style={cellStyle}>
                    {hasLineVariance ? (
                      <select
                        style={{ ...SS, fontSize: 12, padding: "5px 8px" }}
                        value={line.reason}
                        onChange={(e) =>
                          setLineField(idx, "reason", e.target.value)
                        }
                      >
                        {REASONS.map((r) => (
                          <option key={r} value={r}>
                            {r || "-- reason --"}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ fontSize: 12, color: "#94A3B8" }}>--</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary Bar */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            background: "#F8FAFC",
            border: "1px solid #E2E8F0",
            borderRadius: 10,
            padding: "14px 16px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600, textTransform: "uppercase" }}>
            Expected
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginTop: 2 }}>
            {fmtNum(totalExpected)}
          </div>
        </div>
        <div
          style={{
            background: totalReceived === totalExpected ? "#F0FDF4" : "#FFFBEB",
            border: totalReceived === totalExpected ? "1px solid #BBF7D0" : "1px solid #FDE68A",
            borderRadius: 10,
            padding: "14px 16px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600, textTransform: "uppercase" }}>
            Received
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: totalReceived === totalExpected ? "#15803D" : "#D97706",
              marginTop: 2,
            }}
          >
            {fmtNum(totalReceived)}
          </div>
        </div>
        <div
          style={{
            background: totalVariance === 0 ? "#F0FDF4" : totalVariance < 0 ? "#FEF2F2" : "#EFF6FF",
            border:
              totalVariance === 0
                ? "1px solid #BBF7D0"
                : totalVariance < 0
                  ? "1px solid #FECACA"
                  : "1px solid #BFDBFE",
            borderRadius: 10,
            padding: "14px 16px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600, textTransform: "uppercase" }}>
            Variance
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: totalVariance === 0 ? "#15803D" : totalVariance < 0 ? "#DC2626" : "#2563EB",
              marginTop: 2,
            }}
          >
            {totalVariance === 0 ? "0" : `${totalVariance > 0 ? "+" : ""}${totalVariance}`}
          </div>
        </div>
      </div>

      {/* Variance warning */}
      {hasVariance && missingReasons.length > 0 && (
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
          {missingReasons.length} line{missingReasons.length > 1 ? "s" : ""} with
          variance missing a reason. Consider adding reasons before confirming.
        </div>
      )}

      {/* Footer Actions */}
      <div
        style={{
          display: "flex",
          gap: 10,
          justifyContent: "flex-end",
          borderTop: "1px solid #E2E8F0",
          paddingTop: 18,
        }}
      >
        <button
          style={BS}
          onClick={async () => {
            await stopScanner();
            onClose();
          }}
        >
          Cancel
        </button>
        <button style={BG} onClick={confirmReceipt}>
          Confirm Receipt ({fmtNum(totalReceived)} units)
        </button>
      </div>
    </Modal>
  );
}
