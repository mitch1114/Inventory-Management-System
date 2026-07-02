import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { STAGES, STAGE_LABEL, STAGE_NEXT, STAGE_BTN, LOCKING } from "../lib/constants";
import { computeInventory, advanceStage } from "../lib/inventory";
import { fmt, fmtNum, fmtDate, todayIso, uid, nowIso } from "../lib/utils";
import { Badge, Modal, Field, IS, BP, BS, BD } from "./ui";
import { pushOrder, syncShipments } from "../lib/shipstation";
import HelpPanel from "./HelpPanel";

const PICK_VERIFY_HELP = [
  {
    heading: "Start the scanner",
    body: "Click \"Start Scanner\" to open your device camera. Point it at the barcode on each product as you pull it from the shelf. Each successful scan adds +1 to that item's picked quantity.",
  },
  {
    heading: "Mispick detection",
    body: "If you scan an item that isn't on the order, it's immediately flagged as a mispick with a red alert. Put that item back and grab the correct one. All mispicks are logged in the Audit Log so you can track error rates over time.",
  },
  {
    heading: "Manual adjustments",
    body: "You can still type quantities directly into the \"Qty Filled\" fields or use the +/- buttons. This is useful for bulk items or cases where scanning isn't practical.",
  },
  {
    heading: "Over-pick warnings",
    body: "If you scan more units than the order calls for, you'll see a warning. This prevents shipping extra product accidentally.",
  },
  {
    heading: "Confirm and advance",
    body: "Once all items are picked, click the advance button to move the order to \"Picked & Packed\". Any line where the filled quantity is less than ordered will automatically be placed on backorder.",
  },
];

export default function PipelineView({ data, setData }) {
  const [advModal, setAdvModal] = useState(null);
  const [showInventory, setShowInventory] = useState(false); // live-inventory table collapsed by default
  const [shipForm, setShipForm] = useState({ carrier: "", trackingNum: "", shipDate: todayIso() });
  const [pickQtys, setPickQtys] = useState([]); // [{productId, qtyFilled}] for pick confirmation
  const [ssPushing, setSsPushing] = useState(false); // ShipStation push in progress
  const [ssSyncing, setSsSyncing] = useState(false); // ShipStation sync in progress
  const [ssStatus, setSsStatus] = useState(""); // status message
  // Pick scanner state
  const [pickScanning, setPickScanning] = useState(false);
  const [pickLastScan, setPickLastScan] = useState(null);
  const [pickScanError, setPickScanError] = useState(null);
  const [mispicks, setMispicks] = useState([]); // [{ code, timestamp }]
  const pickScannerRef = useRef(null);
  const pickScannerDivId = "pick-verify-scanner";

  const computedProds = useMemo(
    () => computeInventory(data.products, data.salesOrders),
    [data.products, data.salesOrders],
  );
  const prodMap = useMemo(
    () => Object.fromEntries(data.products.map((p) => [p.id, p])),
    [data.products],
  );
  const skuToProdId = useMemo(() => {
    const m = {};
    data.products.forEach((p) => {
      m[p.sku.toLowerCase()] = p.id;
      m[p.sku.toLowerCase().replace(/[-\s]/g, "")] = p.id;
    });
    return m;
  }, [data.products]);
  const stageOrders = useMemo(() => {
    const m = {};
    STAGES.forEach((s) => {
      m[s] = [];
    });
    data.salesOrders.forEach((o) => {
      if (m[o.fulfillmentStage]) m[o.fulfillmentStage].push(o);
    });
    return m;
  }, [data.salesOrders]);
  const SCOL = { confirmed: "#3B82F6", picked: "#EAB308", booked: "#06B6D4", shipped: "#10B981" };

  // Cleanup scanner on unmount
  useEffect(() => {
    return () => {
      if (pickScannerRef.current) {
        pickScannerRef.current.stop().catch(() => {});
        pickScannerRef.current = null;
      }
    };
  }, []);

  const stopPickScanner = useCallback(async () => {
    if (pickScannerRef.current) {
      try { await pickScannerRef.current.stop(); } catch (_) {}
      pickScannerRef.current = null;
    }
    setPickScanning(false);
  }, []);

  const startPickScanner = useCallback(async () => {
    setPickScanError(null);
    setPickScanning(true);
    await new Promise((r) => setTimeout(r, 100));

    const scanner = new Html5Qrcode(pickScannerDivId);
    pickScannerRef.current = scanner;

    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 280, height: 100 }, aspectRatio: 2.0 },
        (decodedText) => {
          // Look up the scanned barcode
          const normalized = decodedText.toLowerCase().replace(/[-\s]/g, "");
          const productId = skuToProdId[decodedText.toLowerCase()] || skuToProdId[normalized];

          if (!productId) {
            setPickLastScan({ code: decodedText, matched: false, reason: "Unknown product" });
            setMispicks((prev) => [...prev, { code: decodedText, ts: new Date().toISOString() }]);
            return;
          }

          // Check if this product is on the current order
          setPickQtys((prev) => {
            const lineIdx = prev.findIndex((l) => l.productId === productId);
            if (lineIdx === -1) {
              const prod = prodMap[productId];
              setPickLastScan({
                code: decodedText,
                matched: false,
                reason: `${prod?.sku || decodedText} is not on this order`,
              });
              setMispicks((mp) => [...mp, { code: decodedText, sku: prod?.sku, ts: new Date().toISOString() }]);
              return prev;
            }

            const prod = prodMap[productId];
            // Find the ordered qty for this line from the modal order
            const orderLine = advModal?.lines[lineIdx];
            const maxQty = orderLine ? orderLine.qty : Infinity;
            const current = prev[lineIdx].qtyFilled;

            if (current >= maxQty) {
              setPickLastScan({
                code: decodedText,
                matched: true,
                warning: true,
                sku: prod?.sku,
                name: prod?.name,
                reason: "Already fully picked",
              });
              return prev;
            }

            setPickLastScan({
              code: decodedText,
              matched: true,
              sku: prod?.sku,
              name: prod?.name,
            });

            return prev.map((l, i) =>
              i === lineIdx ? { ...l, qtyFilled: Math.min(maxQty, l.qtyFilled + 1) } : l,
            );
          });
        },
        () => {},
      );
    } catch (err) {
      setPickScanError(
        err.toString().includes("NotAllowedError")
          ? "Camera access denied. Please allow camera permissions."
          : "Could not start camera.",
      );
      setPickScanning(false);
    }
  }, [skuToProdId, prodMap, advModal]);

  // Open the advance modal -- initialize pickQtys for confirmed->picked transition
  const openAdvance = (o) => {
    setAdvModal(o);
    setShipForm({
      carrier: (o.shipment && o.shipment.carrier) || "",
      trackingNum: (o.shipment && o.shipment.trackingNum) || "",
      shipDate: todayIso(),
    });
    // Pre-fill pick quantities with current qtyFilled values
    setPickQtys(
      o.lines.map((l) => ({
        productId: l.productId,
        qtyFilled: l.qtyFilled != null ? l.qtyFilled : l.qty,
      })),
    );
    // Reset scanner state
    setPickLastScan(null);
    setPickScanError(null);
    setMispicks([]);
  };

  const doAdvance = async () => {
    const o = advModal;
    const next = STAGE_NEXT[o.fulfillmentStage];
    if (!next) return;
    await stopPickScanner();
    // Pass adjusted lines when moving to "picked" (confirmed -> picked)
    const adjusted = next === "picked" ? pickQtys : null;
    setData((d) => {
      let result = advanceStage(d, o.id, next, next === "shipped" ? shipForm : null, adjusted);
      // Log mispicks if any occurred during picking
      if (next === "picked" && mispicks.length > 0) {
        result = {
          ...result,
          auditLog: [
            ...(result.auditLog || []),
            {
              id: uid(),
              ts: nowIso(),
              type: "mispick",
              entity: o.orderNum,
              description: `${mispicks.length} mispick${mispicks.length !== 1 ? "s" : ""} during picking of ${o.orderNum}: ${mispicks.map((m) => m.sku || m.code).join(", ")}`,
            },
          ],
        };
      }
      return result;
    });
    setAdvModal(null);

    // Auto-push to ShipStation when order reaches "booked"
    if (next === "booked") {
      setSsPushing(true);
      setSsStatus("");
      try {
        const result = await pushOrder(o, data.products);
        if (result.success) {
          setSsStatus(`Pushed ${o.orderNum} to ShipStation`);
          // Store ShipStation order ID on the order
          setData((d) => ({
            ...d,
            salesOrders: d.salesOrders.map((so) =>
              so.id === o.id
                ? { ...so, shipstationOrderId: result.shipstationOrderId }
                : so,
            ),
            auditLog: [
              ...(d.auditLog || []),
              {
                id: uid(),
                ts: nowIso(),
                type: "shipstation-push",
                entity: o.orderNum,
                description: `Pushed ${o.orderNum} to ShipStation (ID: ${result.shipstationOrderId})`,
              },
            ],
          }));
        } else {
          setSsStatus(`ShipStation push failed: ${result.error || "Unknown error"}`);
        }
      } catch (err) {
        setSsStatus(`ShipStation push failed: ${err.message}`);
      }
      setSsPushing(false);
      setTimeout(() => setSsStatus(""), 6000);
    }
  };

  // Sync shipments from ShipStation -- checks booked orders for tracking updates
  const doSyncShipments = useCallback(async () => {
    const bookedOrders = data.salesOrders.filter((o) => o.fulfillmentStage === "booked");
    if (bookedOrders.length === 0) {
      setSsStatus("No booked orders to sync");
      setTimeout(() => setSsStatus(""), 3000);
      return;
    }
    setSsSyncing(true);
    setSsStatus("Syncing with ShipStation...");
    try {
      const orderNums = bookedOrders.map((o) => o.orderNum);
      const result = await syncShipments(orderNums);
      if (result.success && result.shipments && result.shipments.length > 0) {
        // Auto-advance shipped orders and apply tracking info
        setData((d) => {
          let updated = { ...d };
          const logs = [];
          for (const s of result.shipments) {
            const order = updated.salesOrders.find((o) => o.orderNum === s.orderNumber && o.fulfillmentStage === "booked");
            if (!order) continue;
            const shipInfo = {
              carrier: s.carrier || "",
              trackingNum: s.trackingNum || "",
              shipDate: s.shipDate || todayIso(),
            };
            updated = advanceStage(updated, order.id, "shipped", shipInfo);
            logs.push({
              id: uid(),
              ts: nowIso(),
              type: "shipstation-sync",
              entity: order.orderNum,
              description: `Auto-shipped ${order.orderNum} from ShipStation -- ${s.carrier} ${s.trackingNum}`,
            });
          }
          return {
            ...updated,
            auditLog: [...(updated.auditLog || []), ...logs],
          };
        });
        setSsStatus(`Synced ${result.shipments.length} shipment${result.shipments.length !== 1 ? "s" : ""} from ShipStation`);
      } else if (result.success) {
        setSsStatus("No new shipments found");
      } else {
        setSsStatus(`Sync failed: ${result.error || "Unknown error"}`);
      }
    } catch (err) {
      setSsStatus(`Sync failed: ${err.message}`);
    }
    setSsSyncing(false);
    setTimeout(() => setSsStatus(""), 6000);
  }, [data.salesOrders, data.products, setData]);

  // Pick modal stats
  const pickTotalOrdered = advModal ? advModal.lines.reduce((s, l) => s + l.qty, 0) : 0;
  const pickTotalFilled = pickQtys.reduce((s, l) => s + l.qtyFilled, 0);
  const pickTotalBO = pickTotalOrdered - pickTotalFilled;
  const pickFillRate = pickTotalOrdered > 0 ? (pickTotalFilled / pickTotalOrdered) * 100 : 100;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>
          Fulfillment Pipeline
        </h2>
        <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 13 }}>
          Inventory is locked at <strong style={{ color: "#93C5FD" }}>Confirmed</strong> and stays
          locked until <strong style={{ color: "#15803D" }}>Shipped</strong>. OnHand only decrements
          at shipment.
        </p>
      </div>

      {/* ShipStation status bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
          padding: "8px 14px",
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 10,
          fontSize: 12,
        }}
      >
        <span style={{ fontWeight: 700, color: "#0F172A", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          ShipStation
        </span>
        <button
          onClick={doSyncShipments}
          disabled={ssSyncing || ssPushing}
          style={{
            padding: "4px 12px",
            borderRadius: 6,
            border: "1px solid #06B6D455",
            background: ssSyncing ? "#F0F9FF" : "#ECFEFF",
            color: "#0891B2",
            fontWeight: 700,
            fontSize: 11,
            cursor: ssSyncing ? "default" : "pointer",
            fontFamily: "inherit",
            opacity: ssSyncing || ssPushing ? 0.6 : 1,
          }}
        >
          {ssSyncing ? "Syncing..." : "Sync Shipments"}
        </button>
        {ssPushing && (
          <span style={{ color: "#6D28D9", fontWeight: 600, fontSize: 11 }}>
            Pushing to ShipStation...
          </span>
        )}
        {ssStatus && (
          <span
            style={{
              color: ssStatus.includes("failed") || ssStatus.includes("error") ? "#DC2626" : "#15803D",
              fontWeight: 600,
              fontSize: 11,
            }}
          >
            {ssStatus}
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#94A3B8" }}>
          Orders auto-push at Booked
        </span>
      </div>

      {/* Kanban columns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {STAGES.map((stage) => {
          const col = SCOL[stage];
          const orders = stageOrders[stage] || [];
          const units = orders.reduce(
            (s, o) => s + o.lines.reduce((ls, l) => ls + (l.qtyFilled != null ? l.qtyFilled : l.qty), 0),
            0,
          );
          const value = orders.reduce(
            (s, o) =>
              s + o.lines.reduce((ls, l) => ls + (l.qtyFilled != null ? l.qtyFilled : l.qty) * l.price, 0),
            0,
          );
          return (
            <div
              key={stage}
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: "#F8FAFC",
                  borderBottom: "1px solid #E2E8F0",
                  padding: "12px 14px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: col, flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, color: "#0F172A", fontSize: 13 }}>
                    {STAGE_LABEL[stage]}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      background: col + "22",
                      color: col,
                      border: `1px solid ${col}44`,
                      borderRadius: 10,
                      padding: "1px 8px",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {orders.length}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#64748B" }}>
                  {fmtNum(units)} units &middot; {fmt(value)}
                  {LOCKING.has(stage) ? " (locked)" : ""}
                </div>
              </div>
              <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 100 }}>
                {orders.length === 0 && (
                  <div style={{ color: "#94A3B8", fontSize: 12, textAlign: "center", paddingTop: 20 }}>
                    Empty
                  </div>
                )}
                {orders.map((o) => {
                  // Ordered totals (not filled) so fully-backordered orders don't
                  // display as "0 units / $0.00" on the card.
                  const total = o.lines.reduce((s, l) => s + l.qty * l.price, 0);
                  const orderedUnits = o.lines.reduce((s, l) => s + l.qty, 0);
                  const hasBO = o.lines.some(
                    (l) => (l.qtyBackordered != null ? l.qtyBackordered : 0) > 0,
                  );
                  const next = STAGE_NEXT[stage];
                  return (
                    <div
                      key={o.id}
                      style={{
                        background: "#FFFFFF",
                        border: "1px solid #E2E8F0",
                        borderRadius: 10,
                        padding: "10px 12px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: "#6D28D9", fontFamily: "monospace" }}>
                          {o.orderNum}
                        </span>
                        {hasBO && <Badge status="backordered" label="Has BO" />}
                        {o.type === "preorder" && !hasBO && <Badge status="preorder" label="Pre-order" />}
                      </div>
                      <div style={{ fontSize: 13, color: "#0F172A", fontWeight: 600, marginBottom: 2 }}>
                        {o.customer}
                      </div>
                      {o.dealerPORef && (
                        <div style={{ fontSize: 11, fontFamily: "monospace", color: "#64748B", marginBottom: 3 }}>
                          {o.dealerPORef}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: "#64748B", marginBottom: 6 }}>
                        {fmtDate(o.date)} &middot; {orderedUnits} units &middot; {fmt(total)}
                      </div>
                      {LOCKING.has(stage) && (
                        <div
                          style={{
                            background: "#F1F5F9",
                            borderRadius: 6,
                            padding: "3px 8px",
                            marginBottom: 6,
                            fontSize: 11,
                            color: "#854D0E",
                          }}
                        >
                          {o.lines.reduce((s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty), 0)}{" "}
                          units locked
                        </div>
                      )}
                      {o.shipment && o.shipment.carrier && (
                        <div style={{ fontSize: 11, color: "#64748B", marginBottom: 5 }}>
                          {o.shipment.carrier} {o.shipment.trackingNum}
                        </div>
                      )}

                      {/* ShipStation indicator on booked cards */}
                      {stage === "booked" && o.shipstationOrderId && (
                        <div
                          style={{
                            background: "#ECFEFF",
                            border: "1px solid #A5F3FC",
                            borderRadius: 6,
                            padding: "3px 8px",
                            marginBottom: 6,
                            fontSize: 10,
                            color: "#0891B2",
                            fontWeight: 600,
                          }}
                        >
                          SS #{o.shipstationOrderId} -- Awaiting shipment
                        </div>
                      )}

                      {/* Callout on Confirmed cards to verify quantities at pick */}
                      {stage === "confirmed" && next && (
                        <div
                          style={{
                            background: "#FFF7ED",
                            border: "1px solid #FED7AA",
                            borderRadius: 6,
                            padding: "4px 8px",
                            marginBottom: 6,
                            fontSize: 10,
                            color: "#9A3412",
                            fontWeight: 600,
                          }}
                        >
                          Verify actual pick quantities at next step
                        </div>
                      )}

                      {next && (
                        <button
                          onClick={() => openAdvance(o)}
                          style={{
                            width: "100%",
                            padding: "6px",
                            borderRadius: 7,
                            border: `1px solid ${col}55`,
                            background: col + "18",
                            color: col,
                            fontWeight: 700,
                            fontSize: 11,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          {STAGE_BTN[stage]} &rarr;
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Live inventory strip -- collapsed by default so the kanban stays front and center */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          padding: "14px 18px",
          marginTop: 20,
          overflowX: "auto",
        }}
      >
        <button
          onClick={() => setShowInventory((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 11,
            fontWeight: 700,
            color: "#64748B",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          <span>{showInventory ? "▾" : "▸"}</span>
          <span>Live Inventory &mdash; Available to Promise</span>
          <span style={{ marginLeft: "auto", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>
            {computedProds.length} products
          </span>
        </button>
        {showInventory && (
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560, marginTop: 12 }}>
          <thead>
            <tr>
              {["SKU", "Product", "On Hand", "Locked", "Backordered", "Available"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "6px 12px",
                    textAlign: "left",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#64748B",
                    textTransform: "uppercase",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {computedProds.map((p) => (
              <tr key={p.id} style={{ borderTop: "1px solid #F1F5F9" }}>
                <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 11, color: "#64748B" }}>
                  {p.sku}
                </td>
                <td style={{ padding: "8px 12px", fontSize: 13, color: "#334155", fontWeight: 500 }}>
                  {p.name}
                </td>
                <td style={{ padding: "8px 12px", fontSize: 14, color: "#0F172A", fontWeight: 700 }}>
                  {fmtNum(p.onHand)}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    fontSize: 13,
                    color: p.locked > 0 ? "#EAB308" : "#64748B",
                    fontWeight: p.locked > 0 ? 700 : 400,
                  }}
                >
                  {p.locked > 0 ? `-${fmtNum(p.locked)}` : "--"}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    fontSize: 13,
                    color: p.backordered > 0 ? "#F97316" : "#64748B",
                    fontWeight: p.backordered > 0 ? 700 : 400,
                  }}
                >
                  {p.backordered > 0 ? fmtNum(p.backordered) : "--"}
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <span
                    style={{
                      background: p.available === 0 ? "#FEF2F2" : p.available <= p.reorderPoint ? "#FEFCE8" : "#F0FDF4",
                      color: p.available === 0 ? "#B91C1C" : p.available <= p.reorderPoint ? "#854D0E" : "#15803D",
                      border: `1px solid ${p.available === 0 ? "#FECACA" : p.available <= p.reorderPoint ? "#FDE68A" : "#BBF7D0"}`,
                      borderRadius: 20,
                      padding: "3px 14px",
                      fontSize: 14,
                      fontWeight: 800,
                      display: "inline-block",
                    }}
                  >
                    {fmtNum(p.available)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>

      {advModal && (
        <Modal
          title={`Advance ${advModal.orderNum}`}
          onClose={async () => { await stopPickScanner(); setAdvModal(null); }}
          width={STAGE_NEXT[advModal.fulfillmentStage] === "picked" ? 680 : 480}
        >
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #E2E8F0",
              borderRadius: 10,
              padding: "12px 16px",
              marginBottom: 18,
            }}
          >
            <div style={{ fontSize: 13, color: "#64748B" }}>
              Moving <strong style={{ color: "#0F172A" }}>{advModal.orderNum}</strong> &middot;{" "}
              <strong style={{ color: "#0F172A" }}>{advModal.customer}</strong>
            </div>
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 4 }}>
              {STAGE_LABEL[advModal.fulfillmentStage]} &rarr;{" "}
              <span
                style={{
                  color: { confirmed: "#EAB308", picked: "#06B6D4", booked: "#10B981" }[advModal.fulfillmentStage],
                }}
              >
                {STAGE_LABEL[STAGE_NEXT[advModal.fulfillmentStage]]}
              </span>
            </div>
          </div>

          {/* ============================================================= */}
          {/* CONFIRMED -> PICKED: Editable pick quantities                  */}
          {/* ============================================================= */}
          {STAGE_NEXT[advModal.fulfillmentStage] === "picked" && (
            <div>
              {/* Callout reminder */}
              <div
                style={{
                  background: "#FFF7ED",
                  border: "1px solid #FED7AA",
                  borderRadius: 10,
                  padding: "10px 14px",
                  marginBottom: 16,
                  fontSize: 12,
                  color: "#9A3412",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span>
                  <strong>Scan items as you pick them</strong> to verify the right products are pulled,
                  or manually adjust "Qty Filled" below. Any shortfall will be placed on backorder.
                </span>
                <HelpPanel title="Scan-to-Verify Picking Guide" sections={PICK_VERIFY_HELP} buttonLabel="Help" />
              </div>

              {/* Barcode Scanner for pick verification */}
              <div
                style={{
                  background: "#F8FAFC",
                  border: "1px solid #E2E8F0",
                  borderRadius: 10,
                  padding: 14,
                  marginBottom: 16,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: pickScanning ? 10 : 0 }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 13, color: "#0F172A" }}>
                      Scan to Verify
                    </span>
                    <span style={{ fontSize: 11, color: "#64748B", marginLeft: 8 }}>
                      Scan each item as you pull it from the shelf
                    </span>
                  </div>
                  {!pickScanning ? (
                    <button
                      onClick={startPickScanner}
                      style={{
                        background: "linear-gradient(135deg,#6D28D9,#4F46E5)",
                        border: "none",
                        borderRadius: 8,
                        padding: "7px 14px",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: 11,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Start Scanner
                    </button>
                  ) : (
                    <button
                      onClick={stopPickScanner}
                      style={{
                        background: "#FEF2F2",
                        border: "1px solid #FECACA",
                        borderRadius: 8,
                        padding: "7px 14px",
                        color: "#DC2626",
                        fontWeight: 700,
                        fontSize: 11,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Stop Scanner
                    </button>
                  )}
                </div>

                {pickScanning && (
                  <div>
                    <div
                      id={pickScannerDivId}
                      style={{
                        width: "100%",
                        maxWidth: 360,
                        margin: "0 auto",
                        borderRadius: 8,
                        overflow: "hidden",
                      }}
                    />
                    <p style={{ fontSize: 10, color: "#94A3B8", textAlign: "center", margin: "6px 0 0" }}>
                      Each scan adds +1 to that item. Wrong items are flagged as mispicks.
                    </p>
                  </div>
                )}

                {pickScanError && (
                  <div
                    style={{
                      background: "#FEF2F2",
                      border: "1px solid #FECACA",
                      borderRadius: 8,
                      padding: "8px 12px",
                      marginTop: 8,
                      fontSize: 12,
                      color: "#DC2626",
                    }}
                  >
                    {pickScanError}
                  </div>
                )}

                {pickLastScan && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "7px 12px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      background: pickLastScan.matched
                        ? pickLastScan.warning
                          ? "#FFFBEB"
                          : "#F0FDF4"
                        : "#FEF2F2",
                      border: pickLastScan.matched
                        ? pickLastScan.warning
                          ? "1px solid #FDE68A"
                          : "1px solid #BBF7D0"
                        : "1px solid #FECACA",
                      color: pickLastScan.matched
                        ? pickLastScan.warning
                          ? "#92400E"
                          : "#15803D"
                        : "#DC2626",
                    }}
                  >
                    {pickLastScan.matched
                      ? pickLastScan.warning
                        ? `${pickLastScan.sku} -- ${pickLastScan.reason}`
                        : `Verified: ${pickLastScan.sku} -- ${pickLastScan.name}`
                      : `MISPICK: "${pickLastScan.code}"${pickLastScan.reason ? ` (${pickLastScan.reason})` : ""}`}
                  </div>
                )}

                {mispicks.length > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "7px 12px",
                      borderRadius: 8,
                      fontSize: 11,
                      background: "#FEF2F2",
                      border: "1px solid #FECACA",
                      color: "#B91C1C",
                      fontWeight: 600,
                    }}
                  >
                    {mispicks.length} mispick{mispicks.length !== 1 ? "s" : ""} detected: {mispicks.map((m) => m.sku || m.code).join(", ")}
                  </div>
                )}
              </div>

              {/* Editable line-item grid */}
              <div
                style={{
                  background: "#FFFFFF",
                  border: "1px solid #E2E8F0",
                  borderRadius: 10,
                  overflow: "hidden",
                  marginBottom: 16,
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#F1F5F9" }}>
                      <th style={{ padding: "8px 12px", textAlign: "left", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
                        Product
                      </th>
                      <th style={{ padding: "8px 12px", textAlign: "right", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase", width: 70 }}>
                        Ordered
                      </th>
                      <th style={{ padding: "8px 12px", textAlign: "center", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase", width: 100 }}>
                        Qty Filled
                      </th>
                      <th style={{ padding: "8px 12px", textAlign: "right", color: "#64748B", fontSize: 10, fontWeight: 700, textTransform: "uppercase", width: 80 }}>
                        Backorder
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {advModal.lines.map((l, i) => {
                      const prod = prodMap[l.productId];
                      const pq = pickQtys[i] || { qtyFilled: 0 };
                      const bo = l.qty - pq.qtyFilled;
                      return (
                        <tr
                          key={i}
                          style={{
                            borderBottom: "1px solid #F1F5F9",
                            background: bo > 0 ? "#FFF7ED" : "transparent",
                          }}
                        >
                          <td style={{ padding: "8px 12px" }}>
                            <div style={{ fontWeight: 600, color: "#0F172A", fontSize: 12 }}>
                              {prod ? prod.name : l.productId}
                            </div>
                            <div style={{ fontFamily: "monospace", fontSize: 10, color: "#64748B" }}>
                              {prod ? prod.sku : ""}
                            </div>
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "#0F172A" }}>
                            {l.qty}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "center" }}>
                            <input
                              type="number"
                              min="0"
                              max={l.qty}
                              value={pq.qtyFilled}
                              onChange={(e) => {
                                const val = Math.max(0, Math.min(l.qty, parseInt(e.target.value) || 0));
                                setPickQtys((prev) =>
                                  prev.map((p, j) =>
                                    j === i ? { ...p, qtyFilled: val } : p,
                                  ),
                                );
                              }}
                              style={{
                                width: 64,
                                padding: "5px 8px",
                                border: `2px solid ${bo > 0 ? "#F97316" : "#BBF7D0"}`,
                                borderRadius: 6,
                                textAlign: "center",
                                fontSize: 13,
                                fontWeight: 700,
                                color: "#0F172A",
                                outline: "none",
                                fontFamily: "inherit",
                                background: bo > 0 ? "#FFF7ED" : "#F0FDF4",
                              }}
                            />
                          </td>
                          <td
                            style={{
                              padding: "8px 12px",
                              textAlign: "right",
                              fontWeight: bo > 0 ? 700 : 400,
                              color: bo > 0 ? "#DC2626" : "#94A3B8",
                            }}
                          >
                            {bo > 0 ? bo : "--"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Totals bar */}
                <div
                  style={{
                    padding: "10px 16px",
                    borderTop: "1px solid #E2E8F0",
                    background: "#F8FAFC",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  <span style={{ color: "#64748B" }}>
                    {fmtNum(pickTotalFilled)} of {fmtNum(pickTotalOrdered)} units filled
                    {pickTotalBO > 0 && (
                      <span style={{ color: "#DC2626" }}> &middot; {fmtNum(pickTotalBO)} backordered</span>
                    )}
                  </span>
                  <span
                    style={{
                      background: pickFillRate >= 95 ? "#F0FDF4" : pickFillRate >= 80 ? "#FEFCE8" : "#FEF2F2",
                      color: pickFillRate >= 95 ? "#15803D" : pickFillRate >= 80 ? "#854D0E" : "#B91C1C",
                      border: `1px solid ${pickFillRate >= 95 ? "#BBF7D0" : pickFillRate >= 80 ? "#FDE68A" : "#FECACA"}`,
                      borderRadius: 20,
                      padding: "2px 12px",
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  >
                    {pickFillRate.toFixed(0)}% Fill Rate
                  </span>
                </div>
              </div>

              {/* Backorder warning if fill rate < 100% */}
              {pickTotalBO > 0 && (
                <div
                  style={{
                    background: "#FEF2F2",
                    border: "1px solid #FECACA",
                    borderRadius: 10,
                    padding: "10px 14px",
                    marginBottom: 16,
                    fontSize: 12,
                    color: "#B91C1C",
                  }}
                >
                  <strong>{fmtNum(pickTotalBO)} units</strong> will be placed on backorder.
                  These will auto-fill when inventory is received via Supplier POs.
                </div>
              )}
            </div>
          )}

          {/* ============================================================= */}
          {/* PICKED -> BOOKED: Reminder callout                             */}
          {/* ============================================================= */}
          {STAGE_NEXT[advModal.fulfillmentStage] === "booked" && (
            <div>
              <div
                style={{
                  background: "#F0F9FF",
                  border: "1px solid #BAE6FD",
                  borderRadius: 10,
                  padding: "10px 14px",
                  marginBottom: 12,
                  fontSize: 12,
                  color: "#0369A1",
                }}
              >
                <strong>Quantities were confirmed at pick.</strong>{" "}
                {advModal.lines.reduce((s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty), 0)} units
                filled of {advModal.lines.reduce((s, l) => s + l.qty, 0)} ordered.
                {advModal.lines.some((l) => (l.qtyBackordered || 0) > 0) && (
                  <span style={{ color: "#DC2626", fontWeight: 700 }}>
                    {" "}{advModal.lines.reduce((s, l) => s + (l.qtyBackordered || 0), 0)} on backorder.
                  </span>
                )}
              </div>
              <div
                style={{
                  background: "#ECFEFF",
                  border: "1px solid #A5F3FC",
                  borderRadius: 10,
                  padding: "10px 14px",
                  marginBottom: 16,
                  fontSize: 12,
                  color: "#0891B2",
                }}
              >
                This order will be <strong>automatically pushed to ShipStation</strong> for
                label creation and shipment tracking.
              </div>
            </div>
          )}

          {/* ============================================================= */}
          {/* BOOKED -> SHIPPED: Shipping info                               */}
          {/* ============================================================= */}
          {STAGE_NEXT[advModal.fulfillmentStage] === "shipped" && (
            <div>
              <div
                style={{
                  background: "#F0FDF4",
                  border: "1px solid #BBF7D0",
                  borderRadius: 10,
                  padding: "10px 14px",
                  marginBottom: 16,
                  fontSize: 13,
                  color: "#15803D",
                }}
              >
                Marking <strong>Shipped</strong> will permanently deduct{" "}
                {advModal.lines.reduce((s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty), 0)}{" "}
                units from on-hand inventory.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                <Field label="Carrier">
                  <input
                    style={IS}
                    value={shipForm.carrier}
                    onChange={(e) => setShipForm((f) => ({ ...f, carrier: e.target.value }))}
                    placeholder="UPS, FedEx, USPS..."
                  />
                </Field>
                <Field label="Ship Date">
                  <input
                    style={IS}
                    type="date"
                    value={shipForm.shipDate}
                    onChange={(e) => setShipForm((f) => ({ ...f, shipDate: e.target.value }))}
                  />
                </Field>
              </div>
              <Field label="Tracking Number">
                <input
                  style={IS}
                  value={shipForm.trackingNum}
                  onChange={(e) => setShipForm((f) => ({ ...f, trackingNum: e.target.value }))}
                  placeholder="Optional"
                />
              </Field>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button style={BS} onClick={async () => { await stopPickScanner(); setAdvModal(null); }}>
              Cancel
            </button>
            <button style={BP} onClick={doAdvance}>
              {STAGE_BTN[advModal.fulfillmentStage]}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
