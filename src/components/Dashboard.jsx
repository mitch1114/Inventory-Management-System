import { useMemo } from "react";
import { STAGES, STAGE_LABEL, LOCKING } from "../lib/constants";
import { computeInventory } from "../lib/inventory";
import { fmt, fmtNum, fmtTs } from "../lib/utils";
import { Badge } from "./ui";

export default function Dashboard({ data }) {
  const computedProds = useMemo(
    () => computeInventory(data.products, data.salesOrders),
    [data.products, data.salesOrders],
  );
  const { salesOrders, auditLog } = data;
  const pipeline = useMemo(() => {
    const r = {};
    STAGES.forEach((s) => {
      r[s] = salesOrders.filter((o) => o.fulfillmentStage === s).length;
    });
    return r;
  }, [salesOrders]);
  const totalLocked = computedProds.reduce((s, p) => s + p.locked * p.costPrice, 0);
  const totalAvail = computedProds.reduce((s, p) => s + p.available * p.costPrice, 0);
  const totalBO = computedProds.reduce((s, p) => s + p.backordered, 0);

  // Fill rate & revenue lost -- across all active (locking) orders
  const fillStats = useMemo(() => {
    let totalOrdered = 0;
    let totalFilled = 0;
    let revenueLost = 0;
    const prodMap = Object.fromEntries(data.products.map((p) => [p.id, p]));
    salesOrders.forEach((o) => {
      if (!LOCKING.has(o.fulfillmentStage)) return;
      o.lines.forEach((l) => {
        totalOrdered += l.qty;
        totalFilled += l.qtyFilled != null ? l.qtyFilled : l.qty;
        const bo = l.qtyBackordered != null ? l.qtyBackordered : 0;
        if (bo > 0) {
          revenueLost += bo * l.price;
        }
      });
    });
    const fillRate = totalOrdered > 0 ? (totalFilled / totalOrdered) * 100 : 100;
    return { fillRate, revenueLost, totalOrdered, totalFilled };
  }, [salesOrders, data.products]);
  const revenue = salesOrders
    .filter((o) => o.fulfillmentStage === "shipped")
    .reduce(
      (s, o) =>
        s + o.lines.reduce((ls, l) => ls + (l.qtyFilled != null ? l.qtyFilled : l.qty) * l.price, 0),
      0,
    );
  const alertProds = computedProds.filter((p) => p.available <= p.reorderPoint);
  const recent = [...(auditLog || [])].reverse().slice(0, 7);

  const Stat = ({ label, value, sub, accent, warn }) => (
    <div
      style={{
        background: "#FFFFFF",
        border: `1px solid ${warn ? "#FED7AA" : "#E2E8F0"}`,
        borderRadius: 12,
        padding: "15px 17px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 3,
          height: "100%",
          background: accent,
        }}
      />
      <div style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", lineHeight: 1.1 }}>
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "#64748B",
          marginTop: 5,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      {sub && <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>Overview</h2>
        <p style={{ color: "#94A3B8", margin: "4px 0 0", fontSize: 13 }}>
          Available = On Hand - Pipeline Locked &middot; OnHand only decrements at Shipped
        </p>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))",
          gap: 10,
          marginBottom: 18,
        }}
      >
        <Stat label="Available to Sell" value={fmt(totalAvail)} sub="at cost" accent="#10B981" />
        <Stat label="Locked in Pipeline" value={fmt(totalLocked)} sub="confirmed->booked" accent="#EAB308" warn />
        <Stat label="Backordered Units" value={fmtNum(totalBO)} accent="#F97316" warn={totalBO > 0} />
        <Stat
          label="Fill Rate"
          value={`${fillStats.fillRate.toFixed(1)}%`}
          sub={`${fmtNum(fillStats.totalFilled)} of ${fmtNum(fillStats.totalOrdered)} units`}
          accent={fillStats.fillRate >= 95 ? "#10B981" : fillStats.fillRate >= 80 ? "#EAB308" : "#EF4444"}
          warn={fillStats.fillRate < 95}
        />
        <Stat
          label="Revenue at Risk"
          value={fmt(fillStats.revenueLost)}
          sub="unfilled backorders"
          accent="#EF4444"
          warn={fillStats.revenueLost > 0}
        />
        <Stat
          label="Active in Pipeline"
          value={pipeline.confirmed + (pipeline.picked || 0) + (pipeline.booked || 0)}
          sub="confirmed+picked+booked"
          accent="#3B82F6"
        />
        <Stat label="Shipped" value={pipeline.shipped || 0} accent="#10B981" />
        <Stat label="Revenue (Shipped)" value={fmt(revenue)} accent="#7C3AED" />
      </div>
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontWeight: 700, color: "#334155", fontSize: 13 }}>
            Pipeline Status
          </div>
          <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600 }}>Last 7 Days</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
          {STAGES.map((s) => {
            const col = { confirmed: "#3B82F6", picked: "#EAB308", booked: "#06B6D4", shipped: "#10B981" }[s];
            const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
            const orders = salesOrders.filter((o) => o.fulfillmentStage === s && o.date >= cutoff);
            const units = orders.reduce(
              (sum, o) =>
                sum + o.lines.reduce((ls, l) => ls + (l.qtyFilled != null ? l.qtyFilled : l.qty), 0),
              0,
            );
            return (
              <div
                key={s}
                style={{
                  background: "#F8FAFC",
                  borderRadius: 10,
                  padding: "11px 13px",
                  borderTop: `3px solid ${col}`,
                }}
              >
                <div style={{ fontSize: 20, fontWeight: 800, color: "#0F172A" }}>
                  {orders.length}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#64748B",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    marginTop: 2,
                  }}
                >
                  {STAGE_LABEL[s]}
                </div>
                <div style={{ fontSize: 11, color: col, marginTop: 2 }}>
                  {fmtNum(units)} units{LOCKING.has(s) ? " (locked)" : ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E2E8F0",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 700, color: "#334155", marginBottom: 12, fontSize: 13 }}>
            Available Stock Alerts
          </div>
          {alertProds.length === 0 ? (
            <div style={{ color: "#94A3B8", fontSize: 13 }}>
              All products have adequate available stock.
            </div>
          ) : (
            alertProds.map((p, i) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                  borderBottom: i < alertProds.length - 1 ? "1px solid #F1F5F9" : "none",
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "#94A3B8" }}>
                    {fmtNum(p.onHand)} on hand &middot; {fmtNum(p.locked)} locked &middot;{" "}
                    <span style={{ color: p.available === 0 ? "#FCA5A5" : "#FDE68A" }}>
                      {fmtNum(p.available)} available
                    </span>
                  </div>
                </div>
                <Badge
                  status={p.available === 0 ? "cancelled" : "partial"}
                  label={p.available === 0 ? "0 Avail" : `${fmtNum(p.available)} left`}
                />
              </div>
            ))
          )}
        </div>
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E2E8F0",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 700, color: "#334155", marginBottom: 12, fontSize: 13 }}>
            Recent Activity
          </div>
          {recent.map((a, i) => (
            <div
              key={a.id}
              style={{
                padding: "7px 0",
                borderBottom: i < recent.length - 1 ? "1px solid #F1F5F9" : "none",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: "#475569",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span style={{ flex: 1 }}>{a.description}</span>
                <Badge status={a.type} label={a.type.replace(/-/g, " ")} />
              </div>
              <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 2 }}>{fmtTs(a.ts)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
