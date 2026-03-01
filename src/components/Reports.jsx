import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { STAGES, STAGE_LABEL, LOCKING } from "../lib/constants";
import { computeInventory } from "../lib/inventory";
import { fmt, fmtNum } from "../lib/utils";

export default function Reports({ data }) {
  const { products, salesOrders } = data;
  const cp = useMemo(
    () => computeInventory(products, salesOrders),
    [products, salesOrders],
  );
  const shipped = salesOrders.filter((o) => o.fulfillmentStage === "shipped");
  const revenue = shipped.reduce(
    (s, o) => s + o.lines.reduce((ls, l) => ls + l.qty * l.price, 0),
    0,
  );
  const cogs = shipped.reduce(
    (s, o) =>
      s +
      o.lines.reduce((ls, l) => {
        const p = products.find((p) => p.id === l.productId);
        return ls + l.qty * ((p && p.costPrice) || 0);
      }, 0),
    0,
  );
  const pipelineVal = salesOrders
    .filter((o) => LOCKING.has(o.fulfillmentStage))
    .reduce(
      (s, o) =>
        s +
        o.lines.reduce(
          (ls, l) => ls + (l.qtyFilled != null ? l.qtyFilled : l.qty) * l.price,
          0,
        ),
      0,
    );
  const boVal = salesOrders
    .filter((o) => LOCKING.has(o.fulfillmentStage))
    .reduce(
      (s, o) =>
        s +
        o.lines.reduce(
          (ls, l) => ls + (l.qtyBackordered != null ? l.qtyBackordered : 0) * l.price,
          0,
        ),
      0,
    );
  const byMonth = useMemo(() => {
    const m = {};
    shipped.forEach((o) => {
      const mo = o.date.slice(0, 7);
      m[mo] = (m[mo] || 0) + o.lines.reduce((s, l) => s + l.qty * l.price, 0);
    });
    return Object.entries(m)
      .sort()
      .map(([month, rev]) => ({ month, rev: +rev.toFixed(2) }));
  }, [shipped]);
  const topProds = useMemo(() => {
    const m = {};
    shipped.forEach((o) =>
      o.lines.forEach((l) => {
        m[l.productId] = (m[l.productId] || 0) + l.qty * l.price;
      }),
    );
    return Object.entries(m)
      .map(([id, rev]) => {
        const found = products.find((p) => p.id === id);
        return { name: found ? found.name : id, rev: +rev.toFixed(2) };
      })
      .sort((a, b) => b.rev - a.rev)
      .slice(0, 6);
  }, [shipped, products]);
  const stockPie = [
    { name: "Available", value: cp.filter((p) => p.available > p.reorderPoint).length },
    {
      name: "Low Available",
      value: cp.filter((p) => p.available > 0 && p.available <= p.reorderPoint).length,
    },
    { name: "Zero Available", value: cp.filter((p) => p.available === 0).length },
  ];
  const PIE_COLORS = ["#10B981", "#EAB308", "#EF4444"];

  const CC = ({ title, children }) => (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E8F0",
        borderRadius: 12,
        padding: 20,
      }}
    >
      <div style={{ fontWeight: 700, color: "#0F172A", marginBottom: 16, fontSize: 14 }}>
        {title}
      </div>
      {children}
    </div>
  );

  const MetricCard = ({ value, label, accent }) => (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E8F0",
        borderRadius: 12,
        padding: "13px 15px",
        borderTop: `3px solid ${accent}`,
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 800, color: "#0F172A" }}>{value}</div>
      <div
        style={{
          fontSize: 10,
          color: "#94A3B8",
          marginTop: 4,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>
          Reports &amp; Analytics
        </h2>
        <p style={{ color: "#94A3B8", margin: "4px 0 0", fontSize: 13 }}>
          Revenue = shipped orders only &middot; Pipeline value = locked but not yet shipped
        </p>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(138px,1fr))",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <MetricCard value={fmt(revenue)} label="Revenue (Shipped)" accent="#10B981" />
        <MetricCard value={fmt(cogs)} label="COGS" accent="#EF4444" />
        <MetricCard value={fmt(revenue - cogs)} label="Gross Profit" accent="#7C3AED" />
        <MetricCard
          value={revenue > 0 ? ((1 - cogs / revenue) * 100).toFixed(1) + "%" : "--"}
          label="Margin"
          accent="#06B6D4"
        />
        <MetricCard value={fmt(pipelineVal)} label="Pipeline Value" accent="#EAB308" />
        <MetricCard value={fmt(boVal)} label="Backorder Value" accent="#F97316" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <CC title="Monthly Revenue (Shipped)">
          {byMonth.length === 0 ? (
            <div style={{ color: "#94A3B8", fontSize: 13, textAlign: "center", padding: "30px 0" }}>
              No shipped orders yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byMonth}>
                <XAxis dataKey="month" tick={{ fill: "#94A3B8", fontSize: 10 }} />
                <YAxis tick={{ fill: "#94A3B8", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    background: "#FFFFFF",
                    border: "1px solid #CBD5E1",
                    borderRadius: 8,
                    color: "#0F172A",
                  }}
                  formatter={(v) => fmt(v)}
                />
                <Bar dataKey="rev" fill="#7C3AED" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CC>
        <CC title="Top Products by Revenue">
          {topProds.length === 0 ? (
            <div style={{ color: "#94A3B8", fontSize: 13, textAlign: "center", padding: "30px 0" }}>
              No data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topProds} layout="vertical">
                <XAxis type="number" tick={{ fill: "#94A3B8", fontSize: 10 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: "#9B9BBF", fontSize: 10 }}
                  width={130}
                />
                <Tooltip
                  contentStyle={{
                    background: "#FFFFFF",
                    border: "1px solid #CBD5E1",
                    borderRadius: 8,
                    color: "#0F172A",
                  }}
                  formatter={(v) => fmt(v)}
                />
                <Bar dataKey="rev" fill="#06B6D4" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CC>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <CC title="Available Stock Health">
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie
                  data={stockPie}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={65}
                  dataKey="value"
                >
                  {stockPie.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ flex: 1 }}>
              {stockPie.map((s, i) => (
                <div
                  key={s.name}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "5px 0",
                    borderBottom: "1px solid #F1F5F9",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: PIE_COLORS[i],
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 12, color: "#64748B" }}>{s.name}</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </CC>
        <CC title="Pipeline Breakdown">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {STAGES.map((s) => {
              const col = { confirmed: "#3B82F6", picked: "#EAB308", booked: "#06B6D4", shipped: "#10B981" }[s];
              const ords = salesOrders.filter((o) => o.fulfillmentStage === s);
              const val = ords.reduce(
                (sum, o) =>
                  sum +
                  o.lines.reduce(
                    (ls, l) => ls + (l.qtyFilled != null ? l.qtyFilled : l.qty) * l.price,
                    0,
                  ),
                0,
              );
              return (
                <div
                  key={s}
                  style={{
                    background: "#F8FAFC",
                    borderRadius: 10,
                    padding: "10px 12px",
                    borderLeft: `3px solid ${col}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: col,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {STAGE_LABEL[s]}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#0F172A", marginTop: 4 }}>
                    {ords.length} orders
                  </div>
                  <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>{fmt(val)}</div>
                </div>
              );
            })}
          </div>
        </CC>
      </div>
    </div>
  );
}
