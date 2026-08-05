import { useMemo, useState } from "react";
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
import { historyRevenue } from "../lib/historyImport";
import { fmt, fmtNum, fmtDate, toCSV, dlCSV } from "../lib/utils";
import { Badge, Table, TR, TD, SS, BS } from "./ui";

const PIE_COLORS = ["#10B981", "#EAB308", "#EF4444"];

// Filled quantity basis: what actually went out the door on a line
const filledQty = (l) => (l.qtyFilled != null ? l.qtyFilled : l.qty);

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

const MetricCard = ({ value, label, sub, accent }) => (
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
    {sub && <div style={{ fontSize: 9, color: "#94A3B8", marginTop: 2 }}>{sub}</div>}
  </div>
);

// --- Customer report timeframes (all computed in LOCAL time) -------------------
const TIMEFRAMES = [
  { id: "thisMonth", label: "This Month" },
  { id: "lastMonth", label: "Last Month" },
  { id: "thisQuarter", label: "This Quarter" },
  { id: "lastQuarter", label: "Last Quarter" },
  { id: "last6Months", label: "Last 6 Months" },
  { id: "ytd", label: "YTD" },
  { id: "allTime", label: "All Time (incl. history)" },
];

const localDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

function timeframeRange(id) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const q = Math.floor(m / 3);
  let start;
  let end;
  switch (id) {
    case "allTime":
      start = new Date(2000, 0, 1);
      end = now;
      break;
    case "lastMonth":
      start = new Date(y, m - 1, 1);
      end = new Date(y, m, 0);
      break;
    case "thisQuarter":
      start = new Date(y, q * 3, 1);
      end = new Date(y, q * 3 + 3, 0);
      break;
    case "lastQuarter":
      start = new Date(y, q * 3 - 3, 1);
      end = new Date(y, q * 3, 0);
      break;
    case "last6Months":
      start = new Date(y, m - 5, 1);
      end = now;
      break;
    case "ytd":
      start = new Date(y, 0, 1);
      end = now;
      break;
    case "thisMonth":
    default:
      start = new Date(y, m, 1);
      end = new Date(y, m + 1, 0);
      break;
  }
  return [localDateStr(start), localDateStr(end)];
}

export default function Reports({ data }) {
  const { products, salesOrders, customers } = data;
  const historicalSales = data.historicalSales || [];
  const [custSel, setCustSel] = useState("all");
  const [timeframe, setTimeframe] = useState("thisMonth");
  const cp = useMemo(
    () => computeInventory(products, salesOrders),
    [products, salesOrders],
  );
  const shipped = useMemo(
    () => salesOrders.filter((o) => o.fulfillmentStage === "shipped"),
    [salesOrders],
  );
  // Shipped revenue: filled qty x price (partially-filled orders count what shipped)
  const revenue = useMemo(
    () =>
      shipped.reduce(
        (s, o) => s + o.lines.reduce((ls, l) => ls + filledQty(l) * l.price, 0),
        0,
      ),
    [shipped],
  );
  // Top line: everything ordered (non-cancelled), regardless of fill or stage
  const allRevenue = useMemo(
    () =>
      salesOrders
        .filter((o) => o.fulfillmentStage !== "cancelled")
        .reduce((s, o) => s + o.lines.reduce((ls, l) => ls + l.qty * l.price, 0), 0),
    [salesOrders],
  );
  // COGS: filled qty x OUR true supplier cost (product.costPrice)
  const cogs = useMemo(
    () =>
      shipped.reduce(
        (s, o) =>
          s +
          o.lines.reduce((ls, l) => {
            const p = products.find((p) => p.id === l.productId);
            // Landed cost (freight/duty/fees included) when a receipt has set
            // it; supplier cost otherwise.
            return ls + filledQty(l) * ((p && (p.landedCost || p.costPrice)) || 0);
          }, 0),
        0,
      ),
    [shipped, products],
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
      m[mo] = (m[mo] || 0) + o.lines.reduce((s, l) => s + filledQty(l) * l.price, 0);
    });
    return Object.entries(m)
      .sort()
      .map(([month, rev]) => ({ month, rev: +rev.toFixed(2) }));
  }, [shipped]);
  const topProds = useMemo(() => {
    const m = {};
    shipped.forEach((o) =>
      o.lines.forEach((l) => {
        m[l.productId] = (m[l.productId] || 0) + filledQty(l) * l.price;
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
  // --- Imported sales history aggregates -----------------------------------------
  const histTotals = useMemo(() => {
    let po = 0;
    let invoiced = 0;
    let poWithInvoice = 0;
    let rev = 0;
    historicalSales.forEach((h) => {
      po += h.poAmount || 0;
      rev += historyRevenue(h);
      if (h.invoiceAmount != null) {
        invoiced += h.invoiceAmount;
        poWithInvoice += h.poAmount || 0;
      }
    });
    return {
      orders: historicalSales.length,
      revenue: rev,
      fillRate: poWithInvoice > 0 ? invoiced / poWithInvoice : null,
    };
  }, [historicalSales]);

  // Combined revenue by year: live shipped orders + imported history
  const byYear = useMemo(() => {
    const m = {};
    shipped.forEach((o) => {
      const y = (o.date || "").slice(0, 4);
      if (!y) return;
      m[y] = m[y] || { year: y, live: 0, history: 0 };
      m[y].live += o.lines.reduce((s, l) => s + filledQty(l) * l.price, 0);
    });
    historicalSales.forEach((h) => {
      const y = (h.date || "").slice(0, 4);
      if (!y) return;
      m[y] = m[y] || { year: y, live: 0, history: 0 };
      m[y].history += historyRevenue(h);
    });
    return Object.values(m)
      .sort((a, b) => a.year.localeCompare(b.year))
      .map((r) => ({ ...r, live: +r.live.toFixed(2), history: +r.history.toFixed(2) }));
  }, [shipped, historicalSales]);

  const stockPie = [
    { name: "Available", value: cp.filter((p) => p.available > p.reorderPoint).length },
    {
      name: "Low Available",
      value: cp.filter((p) => p.available > 0 && p.available <= p.reorderPoint).length,
    },
    { name: "Zero Available", value: cp.filter((p) => p.available === 0).length },
  ];

  // --- Customer report ----------------------------------------------------------
  const customerOptions = useMemo(() => {
    const names = new Set((customers || []).map((c) => c.name));
    salesOrders.forEach((o) => {
      if (o.customer) names.add(o.customer);
    });
    historicalSales.forEach((h) => {
      if (h.customer) names.add(h.customer);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [customers, salesOrders, historicalSales]);

  // Customer report rows: live orders + imported history in one list.
  // kind: "live" rows carry the order; "hist" rows carry the history entry.
  const custRows = useMemo(() => {
    const [start, end] = timeframeRange(timeframe);
    const live = salesOrders
      .filter(
        (o) =>
          o.fulfillmentStage !== "cancelled" &&
          o.date >= start &&
          o.date <= end &&
          (custSel === "all" || o.customer === custSel),
      )
      .map((o) => ({
        kind: "live",
        id: o.id,
        date: o.date,
        order: o,
        units: o.lines.reduce((s, l) => s + l.qty, 0),
        value: o.lines.reduce((s, l) => s + l.qty * l.price, 0),
      }));
    const hist = historicalSales
      .filter(
        (h) =>
          (h.date || "") >= start &&
          (h.date || "") <= end &&
          (custSel === "all" || h.customer === custSel),
      )
      .map((h) => ({
        kind: "hist",
        id: h.id,
        date: h.date || "",
        hist: h,
        units: null,
        value: historyRevenue(h),
      }));
    return [...live, ...hist].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [salesOrders, historicalSales, custSel, timeframe]);

  const custTotals = useMemo(() => {
    const liveRows = custRows.filter((r) => r.kind === "live");
    return {
      units: liveRows.reduce((s, r) => s + r.units, 0),
      value: custRows.reduce((s, r) => s + r.value, 0),
      shippedRev:
        liveRows
          .filter((r) => r.order.fulfillmentStage === "shipped")
          .reduce(
            (s, r) => s + r.order.lines.reduce((ls, l) => ls + filledQty(l) * l.price, 0),
            0,
          ) + custRows.filter((r) => r.kind === "hist").reduce((s, r) => s + r.value, 0),
      backUnits: liveRows
        .filter((r) => LOCKING.has(r.order.fulfillmentStage))
        .reduce(
          (s, r) =>
            s +
            r.order.lines.reduce(
              (ls, l) => ls + (l.qtyBackordered != null ? l.qtyBackordered : 0),
              0,
            ),
          0,
        ),
    };
  }, [custRows]);

  const exportCustCSV = () => {
    const headers = ["Order #", "Customer", "Date", "Stage", "Units", "Value"];
    const rows = custRows.map((r) =>
      r.kind === "live"
        ? {
            "Order #": r.order.orderNum,
            Customer: r.order.customer,
            Date: r.order.date,
            Stage: STAGE_LABEL[r.order.fulfillmentStage] || r.order.fulfillmentStage,
            Units: r.units,
            Value: r.value.toFixed(2),
          }
        : {
            "Order #": r.hist.invoiceNum || r.hist.poRef || "history",
            Customer: r.hist.customer,
            Date: r.hist.date || "",
            Stage: "Historical",
            Units: "",
            Value: r.value.toFixed(2),
          },
    );
    const tfLabel = TIMEFRAMES.find((t) => t.id === timeframe);
    const fn = `customer-report-${custSel === "all" ? "all" : custSel.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${tfLabel ? tfLabel.id : timeframe}.csv`;
    dlCSV(toCSV(rows, headers), fn);
  };

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>
          Reports &amp; Analytics
        </h2>
        <p style={{ color: "#94A3B8", margin: "4px 0 0", fontSize: 13 }}>
          Revenue = shipped orders only &middot; Open order value = locked but not yet shipped
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
        <MetricCard value={fmt(allRevenue)} label="All Revenue (Top Line)" accent="#7C3AED" />
        <MetricCard value={fmt(revenue)} label="Revenue (Shipped)" accent="#10B981" />
        <MetricCard value={fmt(cogs)} label="COGS" sub="landed cost basis" accent="#EF4444" />
        <MetricCard value={fmt(revenue - cogs)} label="Gross Profit" accent="#7C3AED" />
        <MetricCard
          value={revenue > 0 ? ((1 - cogs / revenue) * 100).toFixed(1) + "%" : "--"}
          label="Margin"
          accent="#06B6D4"
        />
        <MetricCard value={fmt(pipelineVal)} label="Open Order Value" accent="#EAB308" />
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
      {/* Imported sales history: all-time revenue by year + summary metrics */}
      {historicalSales.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <MetricCard
              value={fmt(histTotals.revenue)}
              label="Historical Revenue"
              sub="imported sales sheet"
              accent="#64748B"
            />
            <MetricCard
              value={fmtNum(histTotals.orders)}
              label="Historical Orders"
              accent="#64748B"
            />
            <MetricCard
              value={histTotals.fillRate != null ? (histTotals.fillRate * 100).toFixed(1) + "%" : "--"}
              label="Historical Fill Rate"
              sub="invoiced vs PO amount"
              accent="#06B6D4"
            />
          </div>
          <CC title="Revenue by Year — live system + imported history">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byYear}>
                <XAxis dataKey="year" tick={{ fill: "#94A3B8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94A3B8", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    background: "#FFFFFF",
                    border: "1px solid #CBD5E1",
                    borderRadius: 8,
                    color: "#0F172A",
                  }}
                  formatter={(v, name) => [fmt(v), name === "history" ? "Imported history" : "Live system"]}
                />
                <Bar dataKey="history" stackId="rev" fill="#94A3B8" radius={[0, 0, 0, 0]} />
                <Bar dataKey="live" stackId="rev" fill="#7C3AED" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CC>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
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
        <CC title="Open Orders Breakdown">
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
      <CC title="Customer Report">
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <select
            value={custSel}
            onChange={(e) => setCustSel(e.target.value)}
            style={{ ...SS, width: 240 }}
          >
            <option value="all">All Customers</option>
            {customerOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            style={{ ...SS, width: 170 }}
          >
            {TIMEFRAMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
          <button style={BS} onClick={exportCustCSV} disabled={custRows.length === 0}>
            Export CSV
          </button>
        </div>
        {custSel !== "all" && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <div
              style={{
                background: "#F0FDF4",
                border: "1px solid #BBF7D0",
                borderRadius: 10,
                padding: "8px 14px",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#15803D",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Shipped Revenue (In Range)
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0F172A", marginTop: 2 }}>
                {fmt(custTotals.shippedRev)}
              </div>
            </div>
            <div
              style={{
                background: "#FFF7ED",
                border: "1px solid #FED7AA",
                borderRadius: 10,
                padding: "8px 14px",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#9A3412",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Open Backordered Units
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0F172A", marginTop: 2 }}>
                {fmtNum(custTotals.backUnits)}
              </div>
            </div>
          </div>
        )}
        <Table
          headers={["Order #", "Customer", "Date", "Stage", "Units", "Value"]}
          empty={custRows.length === 0 ? "No orders in this timeframe." : null}
        >
          {custRows.map((r, i) =>
            r.kind === "live" ? (
              <TR key={r.id} i={i}>
                <TD mono>{r.order.orderNum}</TD>
                <TD>{r.order.customer}</TD>
                <TD>{fmtDate(r.order.date)}</TD>
                <TD>
                  <Badge
                    status={r.order.fulfillmentStage}
                    label={STAGE_LABEL[r.order.fulfillmentStage] || r.order.fulfillmentStage}
                  />
                </TD>
                <TD>{fmtNum(r.units)}</TD>
                <TD accent="#0F172A" s={{ fontWeight: 600 }}>
                  {fmt(r.value)}
                </TD>
              </TR>
            ) : (
              <TR key={r.id} i={i}>
                <TD mono>{r.hist.invoiceNum || r.hist.poRef || "--"}</TD>
                <TD>{r.hist.customer}</TD>
                <TD>{r.date ? fmtDate(r.date) : "--"}</TD>
                <TD>
                  <Badge status="historical" label="Historical" />
                </TD>
                <TD>--</TD>
                <TD accent="#0F172A" s={{ fontWeight: 600 }}>
                  {fmt(r.value)}
                </TD>
              </TR>
            ),
          )}
          {custRows.length > 0 && (
            <tr style={{ background: "#F8FAFC", borderTop: "2px solid #E2E8F0" }}>
              <TD accent="#0F172A" s={{ fontWeight: 700 }}>
                Total
              </TD>
              <TD s={{ fontWeight: 600 }}>
                {custRows.length} order{custRows.length !== 1 ? "s" : ""}
              </TD>
              <TD>{""}</TD>
              <TD>{""}</TD>
              <TD accent="#0F172A" s={{ fontWeight: 700 }}>
                {fmtNum(custTotals.units)}
              </TD>
              <TD accent="#0F172A" s={{ fontWeight: 700 }}>
                {fmt(custTotals.value)}
              </TD>
            </tr>
          )}
        </Table>
      </CC>
    </div>
  );
}
