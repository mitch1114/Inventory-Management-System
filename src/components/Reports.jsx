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
import { computeInventory, preOrderCoverage } from "../lib/inventory";
import { orderMargin, sumMargins, marginColor, MARGIN_TARGET } from "../lib/orderMargin";
import { historyRevenue } from "../lib/historyImport";
import {
  buildSalesFacts,
  periodMetrics,
  groupMetrics,
  monthlyForYear,
  compareRange,
  pctChange,
  addMonths,
  CHANNEL_LABELS,
  normalizeChannel,
} from "../lib/salesMetrics";
import { fmt, fmtNum, fmtDate, toCSV, dlCSV } from "../lib/utils";
import { Badge, Table, TR, TD, SS, BS } from "./ui";

const PIE_COLORS = ["#10B981", "#EAB308", "#EF4444"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Filled quantity basis: what actually went out the door on a line
const filledQty = (l) => (l.qtyFilled != null ? l.qtyFilled : l.qty);

// Compact currency for chart axes ($12.5k)
const fmtK = (v) =>
  Math.abs(v) >= 1000000
    ? `$${(v / 1000000).toFixed(1)}M`
    : Math.abs(v) >= 1000
      ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
      : `$${Math.round(v)}`;

const tooltipStyle = {
  background: "#FFFFFF",
  border: "1px solid #CBD5E1",
  borderRadius: 8,
  color: "#0F172A",
};

const CC = ({ title, right, children }) => (
  <div
    style={{
      background: "#FFFFFF",
      border: "1px solid #E2E8F0",
      borderRadius: 12,
      padding: 20,
      minWidth: 0,
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        flexWrap: "wrap",
        marginBottom: 16,
      }}
    >
      <div style={{ fontWeight: 700, color: "#0F172A", fontSize: 14 }}>{title}</div>
      {right}
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

// Green up / red down change pill comparing cur with prev. No baseline:
// "new" when there's current activity, "--" when there's none either.
const Delta = ({ cur, prev, small }) => {
  const fs = small ? 10 : 11;
  if (cur == null || prev == null) return <span style={{ fontSize: fs, color: "#94A3B8", fontWeight: 600 }}>--</span>;
  const pct = pctChange(cur, prev);
  if (pct == null)
    return cur > 0 ? (
      <span style={{ fontSize: fs, fontWeight: 800, color: "#1D4ED8", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 20, padding: small ? "0 6px" : "1px 7px" }}>
        new
      </span>
    ) : (
      <span style={{ fontSize: fs, color: "#94A3B8", fontWeight: 600 }}>--</span>
    );
  const up = pct >= 0;
  return (
    <span
      style={{
        fontSize: fs,
        fontWeight: 800,
        color: up ? "#15803D" : "#B91C1C",
        background: up ? "#F0FDF4" : "#FEF2F2",
        border: `1px solid ${up ? "#BBF7D0" : "#FECACA"}`,
        borderRadius: 20,
        padding: small ? "0 6px" : "1px 7px",
        whiteSpace: "nowrap",
      }}
    >
      {up ? "▲" : "▼"} {Math.abs(pct * 100).toFixed(1)}%
    </span>
  );
};

// Headline metric with its comparison-period value and change
const CompareCard = ({ label, sub, accent, value, prev, format, compareOn }) => (
  <div
    style={{
      background: "#FFFFFF",
      border: "1px solid #E2E8F0",
      borderRadius: 12,
      padding: "13px 15px",
      borderTop: `3px solid ${accent}`,
    }}
  >
    <div
      style={{
        fontSize: 10,
        color: "#64748B",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontWeight: 700,
      }}
    >
      {label}
    </div>
    <div style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginTop: 4 }}>
      {value == null ? "--" : format(value)}
    </div>
    {compareOn && (
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
        <Delta cur={value} prev={prev} />
        <span style={{ fontSize: 11, color: "#94A3B8" }}>
          vs {prev == null ? "--" : format(prev)}
        </span>
      </div>
    )}
    {sub && <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4 }}>{sub}</div>}
  </div>
);

const Toggle = ({ value, options, onChange }) => (
  <div style={{ display: "inline-flex", border: "1px solid #E2E8F0", borderRadius: 8, overflow: "hidden" }}>
    {options.map(([id, label]) => (
      <button
        key={id}
        onClick={() => onChange(id)}
        style={{
          padding: "4px 10px",
          border: "none",
          background: value === id ? "#7C3AED" : "#FFFFFF",
          color: value === id ? "#FFFFFF" : "#64748B",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {label}
      </button>
    ))}
  </div>
);

// --- Report timeframes (all computed in LOCAL time) -----------------------------
const TIMEFRAMES = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7", label: "Last 7 Days" },
  { id: "last30", label: "Last 30 Days" },
  { id: "thisMonth", label: "This Month" },
  { id: "lastMonth", label: "Last Month" },
  { id: "thisQuarter", label: "This Quarter" },
  { id: "lastQuarter", label: "Last Quarter" },
  { id: "ytd", label: "YTD" },
  { id: "allTime", label: "All Time (incl. history)" },
];

const COMPARE_MODES = [
  { id: "prev", label: "Previous period" },
  { id: "lastYear", label: "Same period last year" },
  { id: "none", label: "No comparison" },
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
    case "today":
      start = now;
      end = now;
      break;
    case "yesterday":
      start = new Date(y, m, now.getDate() - 1);
      end = new Date(y, m, now.getDate() - 1);
      break;
    case "last7":
      start = new Date(y, m, now.getDate() - 6);
      end = now;
      break;
    case "last30":
      start = new Date(y, m, now.getDate() - 29);
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

const fmtRange = ([s, e]) => {
  const f = (d, withYear) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
    });
  if (s === e) return f(s, true);
  return `${f(s, s.slice(0, 4) !== e.slice(0, 4))} – ${f(e, true)}`;
};

export default function Reports({ data }) {
  const { products, salesOrders, customers } = data;
  const historicalSales = data.historicalSales || [];
  const [custSel, setCustSel] = useState("all");
  const [timeframe, setTimeframe] = useState("thisMonth");
  const [compareMode, setCompareMode] = useState("prev");
  const [prodBasis, setProdBasis] = useState("invoiced"); // invoiced | ordered
  const [prodMetric, setProdMetric] = useState("rev"); // rev | units
  const [yoyMetric, setYoyMetric] = useState("topLine"); // topLine | invoiced
  const [showAllCust, setShowAllCust] = useState(false);
  const [marginBy, setMarginBy] = useState("customer"); // customer | channel | product
  const [showAllMargin, setShowAllMargin] = useState(false);

  // Selected reporting period -- scopes the revenue metrics, charts, and the
  // customer report. Inventory/pipeline cards show CURRENT state (unscoped).
  const [rangeStart, rangeEnd] = useMemo(() => timeframeRange(timeframe), [timeframe]);
  const inRange = (d) => (d || "") >= rangeStart && (d || "") <= rangeEnd;
  // Comparisons run on the period clipped to today, so a partial month is
  // compared with the same days of the comparison month.
  const today = localDateStr(new Date());
  const curRange = useMemo(
    () => [rangeStart, rangeEnd > today ? today : rangeEnd],
    [rangeStart, rangeEnd, today],
  );
  const cmpRange = useMemo(
    () => compareRange(timeframe, compareMode, curRange),
    [timeframe, compareMode, curRange],
  );
  const compareOn = !!cmpRange;

  const cp = useMemo(() => computeInventory(products, salesOrders), [products, salesOrders]);
  const prodMap = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  // --- Revenue (live orders + imported history, see lib/salesMetrics) ----------
  const facts = useMemo(
    () => buildSalesFacts(salesOrders, historicalSales, customers),
    [salesOrders, historicalSales, customers],
  );
  const cur = useMemo(() => periodMetrics(facts, curRange), [facts, curRange]);
  const prev = useMemo(() => (cmpRange ? periodMetrics(facts, cmpRange) : null), [facts, cmpRange]);

  // Live orders invoiced (shipped) in a range -- dated by ship date, the
  // invoice date. Product/COGS figures need SKU lines, so they're live-only.
  const shipDateOf = (o) => (o.shipment && o.shipment.shipDate) || o.date || "";
  const shippedIn = (range) =>
    salesOrders.filter(
      (o) =>
        o.fulfillmentStage === "shipped" && shipDateOf(o) >= range[0] && shipDateOf(o) <= range[1],
    );
  const shipped = useMemo(() => shippedIn(curRange), [salesOrders, curRange]);
  // Gross margin on live orders shipped in the period: line price - landed
  // cost - FET - freight ACC pays (lib/orderMargin; costs locked at shipment)
  const marginOf = (orders) => sumMargins(orders.map((o) => orderMargin(o, prodMap)));
  const mCur = useMemo(() => marginOf(shipped), [shipped, prodMap]);
  const mPrev = useMemo(() => {
    if (!cmpRange) return null;
    const ords = shippedIn(cmpRange);
    return ords.length ? marginOf(ords) : null;
  }, [salesOrders, cmpRange, prodMap]);
  const custTypeByName = useMemo(
    () => Object.fromEntries((customers || []).map((c) => [String(c.name || "").toLowerCase().trim(), c.type])),
    [customers],
  );
  const marginRows = useMemo(() => {
    const m = {};
    const add = (key, label, vals, extra) => {
      const r = (m[key] = m[key] || { key, label, revenue: 0, profit: 0, units: 0, orders: 0, ...extra });
      r.revenue += vals.revenue;
      r.profit += vals.profit;
      r.units += vals.units || 0;
      r.orders += vals.orders || 0;
    };
    shipped.forEach((o) => {
      const om = orderMargin(o, prodMap);
      if (marginBy === "product") {
        om.lines.forEach((l) => {
          if (l.qty <= 0) return;
          add(l.productId, l.sku || "(deleted product)", { revenue: l.revenue, profit: l.profit, units: l.qty }, { name: l.name, incomplete: 0 });
          if (l.costSource === "missing") m[l.productId].incomplete = 1;
        });
        return;
      }
      const key =
        marginBy === "customer"
          ? o.customer || "(unknown)"
          : normalizeChannel(o.channel || custTypeByName[String(o.customer || "").toLowerCase().trim()]);
      const label = marginBy === "customer" ? key : CHANNEL_LABELS[key];
      add(key, label, { revenue: om.revenue, profit: om.profit, orders: 1 }, { incomplete: 0 });
      if (!om.complete) m[key].incomplete++;
    });
    return Object.values(m)
      .map((r) => ({ ...r, pct: r.revenue > 0 ? r.profit / r.revenue : null }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [shipped, prodMap, marginBy, custTypeByName]);

  const openOrders = salesOrders.filter((o) => LOCKING.has(o.fulfillmentStage));
  const pipelineVal = openOrders.reduce(
    (s, o) => s + o.lines.reduce((ls, l) => ls + filledQty(l) * l.price, 0),
    0,
  );
  // Backorder value = units owed that no stock covers (pre-order units with
  // reserved on-hand stock aren't short)
  const preCov = useMemo(() => preOrderCoverage(products, salesOrders).byLine, [products, salesOrders]);
  const boVal = openOrders.reduce(
    (s, o) =>
      s +
      o.lines.reduce(
        (ls, l, i) =>
          ls +
          Math.max(0, (l.qtyBackordered != null ? l.qtyBackordered : 0) - (preCov[`${o.id}:${i}`] || 0)) *
            l.price,
        0,
      ),
    0,
  );
  // Pre-order book: confirmed-but-unshipped pre-orders at ordered value
  const preBook = useMemo(() => {
    const pre = openOrders.filter((o) => o.type === "preorder");
    const windows = pre.map((o) => o.requestedShipDate).filter(Boolean).sort();
    return {
      count: pre.length,
      units: pre.reduce((s, o) => s + o.lines.reduce((ls, l) => ls + l.qty, 0), 0),
      value: pre.reduce((s, o) => s + o.lines.reduce((ls, l) => ls + l.qty * l.price, 0), 0),
      nextWindow: windows[0] || "",
    };
  }, [salesOrders]);

  // Monthly top line vs invoiced within the selected period
  const byMonth = useMemo(() => {
    const m = {};
    const bucket = (mo) => (m[mo] = m[mo] || { month: mo, ordered: 0, invoiced: 0 });
    facts.forEach((f) => {
      if (inRange(f.orderDate)) bucket(f.orderDate.slice(0, 7)).ordered += f.ordered;
      if (f.invoiced != null && inRange(f.shipDate)) bucket(f.shipDate.slice(0, 7)).invoiced += f.invoiced;
    });
    return Object.values(m)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((r) => ({ ...r, ordered: +r.ordered.toFixed(2), invoiced: +r.invoiced.toFixed(2) }));
  }, [facts, rangeStart, rangeEnd]);

  // Year-over-year by month (current calendar year vs prior year)
  const thisYear = Number(today.slice(0, 4));
  const yoy = useMemo(() => {
    const a = monthlyForYear(facts, thisYear);
    const b = monthlyForYear(facts, thisYear - 1);
    return a.map((r, i) => ({
      month: MONTHS[i],
      cur: +r[yoyMetric].toFixed(2),
      prior: +b[i][yoyMetric].toFixed(2),
    }));
  }, [facts, thisYear, yoyMetric]);
  const ytdCur = useMemo(() => periodMetrics(facts, [`${thisYear}-01-01`, today]), [facts, thisYear, today]);
  const ytdPrior = useMemo(
    () => periodMetrics(facts, [`${thisYear - 1}-01-01`, addMonths(today, -12)]),
    [facts, thisYear, today],
  );

  // Top products (live orders -- history has no SKU detail)
  const topProds = useMemo(() => {
    const agg = (range) => {
      const m = {};
      const orders =
        prodBasis === "invoiced"
          ? shippedIn(range)
          : salesOrders.filter(
              (o) => o.fulfillmentStage !== "cancelled" && (o.date || "") >= range[0] && (o.date || "") <= range[1],
            );
      orders.forEach((o) =>
        o.lines.forEach((l) => {
          const q = prodBasis === "invoiced" ? filledQty(l) : l.qty;
          if (q <= 0) return;
          const r = (m[l.productId] = m[l.productId] || { rev: 0, units: 0 });
          r.rev += q * (l.price || 0);
          r.units += q;
        }),
      );
      return m;
    };
    const now = agg(curRange);
    const before = cmpRange ? agg(cmpRange) : {};
    const rows = Object.entries(now).map(([id, r]) => {
      const p = prodMap[id];
      const b = before[id] || { rev: 0, units: 0 };
      return {
        id,
        sku: p ? p.sku : "",
        name: p ? p.name : "(deleted product)",
        rev: r.rev,
        units: r.units,
        prevVal: prodMetric === "rev" ? b.rev : b.units,
      };
    });
    const key = prodMetric === "rev" ? "rev" : "units";
    const total = rows.reduce((s, r) => s + r[key], 0);
    return {
      total,
      rows: rows
        .sort((a, b) => b[key] - a[key])
        .slice(0, 10)
        .map((r) => ({ ...r, val: r[key], share: total > 0 ? r[key] / total : 0 })),
    };
  }, [salesOrders, curRange, cmpRange, prodBasis, prodMetric, prodMap]);

  // Top customers + channel mix (live + history)
  const custAgg = useMemo(() => {
    const now = groupMetrics(facts, curRange, (f) => f.customer || "(unknown)");
    const before = cmpRange ? groupMetrics(facts, cmpRange, (f) => f.customer || "(unknown)") : {};
    const chan = {};
    facts.forEach((f) => {
      if (f.customer && !chan[f.customer]) chan[f.customer] = f.channel;
    });
    return Object.values(now)
      .map((r) => ({
        ...r,
        channel: chan[r.key],
        prevTop: before[r.key] ? before[r.key].topLine : 0,
        prevInv: before[r.key] ? before[r.key].invoiced : 0,
      }))
      .sort((a, b) => b.topLine - a.topLine || b.invoiced - a.invoiced);
  }, [facts, curRange, cmpRange]);

  const channelAgg = useMemo(() => {
    const now = groupMetrics(facts, curRange, (f) => f.channel);
    const before = cmpRange ? groupMetrics(facts, cmpRange, (f) => f.channel) : {};
    const totTop = Object.values(now).reduce((s, r) => s + r.topLine, 0);
    const totInv = Object.values(now).reduce((s, r) => s + r.invoiced, 0);
    return Object.keys(CHANNEL_LABELS)
      .map((k) => {
        const r = now[k] || { topLine: 0, invoiced: 0, orders: 0 };
        const b = before[k] || { topLine: 0, invoiced: 0 };
        return {
          key: k,
          label: CHANNEL_LABELS[k],
          ...r,
          topShare: totTop > 0 ? r.topLine / totTop : 0,
          invShare: totInv > 0 ? r.invoiced / totInv : 0,
          prevTop: b.topLine,
          prevInv: b.invoiced,
        };
      })
      .filter((r) => r.topLine > 0 || r.invoiced > 0 || r.prevTop > 0 || r.prevInv > 0);
  }, [facts, curRange, cmpRange]);

  // --- Imported sales history aggregates -----------------------------------------
  const histTotals = useMemo(() => {
    let invoiced = 0;
    let poWithInvoice = 0;
    let rev = 0;
    historicalSales.forEach((h) => {
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

  // Invoiced revenue by year: live system + imported history (all-time)
  const byYear = useMemo(() => {
    const m = {};
    facts.forEach((f) => {
      if (f.invoiced == null) return;
      const y = (f.shipDate || "").slice(0, 4);
      if (!y) return;
      m[y] = m[y] || { year: y, live: 0, history: 0 };
      m[y][f.source === "hist" ? "history" : "live"] += f.invoiced;
    });
    return Object.values(m)
      .sort((a, b) => a.year.localeCompare(b.year))
      .map((r) => ({ ...r, live: +r.live.toFixed(2), history: +r.history.toFixed(2) }));
  }, [facts]);

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

  const exportComparisonCSV = () => {
    const pct = (a, b) => {
      const v = pctChange(a, b);
      return v == null ? "" : (v * 100).toFixed(1) + "%";
    };
    const rows = [
      ["Top Line Revenue", cur.topLine, prev && prev.topLine],
      ["Invoiced Revenue", cur.invoiced, prev && prev.invoiced],
      ["Orders", cur.orders, prev && prev.orders],
      ["Avg Order Value", cur.aov, prev && prev.aov],
    ].map(([Metric, c, p]) => ({
      Metric,
      [`Current (${fmtRange(curRange)})`]: typeof c === "number" ? c.toFixed(2) : "",
      [`Compare (${cmpRange ? fmtRange(cmpRange) : "none"})`]: typeof p === "number" ? p.toFixed(2) : "",
      Change: typeof p === "number" ? pct(c, p) : "",
    }));
    const custRowsCsv = custAgg.map((r) => ({
      Metric: `Customer: ${r.key}`,
      [`Current (${fmtRange(curRange)})`]: r.topLine.toFixed(2),
      [`Compare (${cmpRange ? fmtRange(cmpRange) : "none"})`]: cmpRange ? r.prevTop.toFixed(2) : "",
      Change: cmpRange ? pct(r.topLine, r.prevTop) : "",
    }));
    const all = [...rows, ...custRowsCsv];
    dlCSV(toCSV(all, Object.keys(all[0])), `sales-comparison-${timeframe}-${compareMode}.csv`);
  };

  const cmpLabel = (COMPARE_MODES.find((m) => m.id === compareMode) || {}).label;
  const selStyle = { ...SS, width: 190 };
  const smallTh = {
    padding: "6px 8px",
    fontSize: 10,
    fontWeight: 700,
    color: "#64748B",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    textAlign: "right",
    borderBottom: "1px solid #E2E8F0",
    whiteSpace: "nowrap",
  };
  const smallTd = {
    padding: "7px 8px",
    fontSize: 12,
    color: "#334155",
    textAlign: "right",
    borderBottom: "1px solid #F1F5F9",
    whiteSpace: "nowrap",
  };
  const shownCust = showAllCust ? custAgg : custAgg.slice(0, 10);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>
            Reports &amp; Analytics
          </h2>
          <p style={{ color: "#94A3B8", margin: "4px 0 0", fontSize: 13 }}>
            Revenue metrics &amp; charts reflect the selected period &middot; inventory and open-order
            cards show current state
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Period
          </span>
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} style={selStyle}>
            {TIMEFRAMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Compare to
          </span>
          <select
            value={compareMode}
            onChange={(e) => setCompareMode(e.target.value)}
            style={selStyle}
            disabled={timeframe === "allTime"}
          >
            {COMPARE_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button style={{ ...BS, fontSize: 12 }} onClick={exportComparisonCSV}>
            Export CSV
          </button>
        </div>
      </div>

      {/* Period + comparison window */}
      <div
        style={{
          fontSize: 12,
          color: "#64748B",
          background: "#F8FAFC",
          border: "1px solid #E2E8F0",
          borderRadius: 8,
          padding: "7px 12px",
          marginBottom: 14,
        }}
      >
        <strong style={{ color: "#0F172A" }}>{fmtRange(curRange)}</strong>
        {compareOn ? (
          <>
            {" "}vs <strong style={{ color: "#0F172A" }}>{fmtRange(cmpRange)}</strong>{" "}
            <span style={{ color: "#94A3B8" }}>({cmpLabel.toLowerCase()})</span>
          </>
        ) : timeframe === "allTime" ? (
          <span style={{ color: "#94A3B8" }}> &middot; comparison not available for All Time</span>
        ) : null}
        <span style={{ color: "#94A3B8" }}>
          {" "}&middot; Top line dated by order date, invoiced by ship date
          {cur.usesHistory || (prev && prev.usesHistory) ? " · includes imported sales history" : ""}
        </span>
      </div>

      {/* Headline comparison */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <CompareCard label="Top Line Revenue" sub="customer ordered (demand)" accent="#7C3AED" value={cur.topLine} prev={prev && prev.topLine} format={fmt} compareOn={compareOn} />
        <CompareCard label="Invoiced Revenue" sub="shipped / billed" accent="#10B981" value={cur.invoiced} prev={prev && prev.invoiced} format={fmt} compareOn={compareOn} />
        <CompareCard label="Orders" sub={`${fmtNum(cur.invoicedOrders)} shipped in period`} accent="#3B82F6" value={cur.orders} prev={prev && prev.orders} format={fmtNum} compareOn={compareOn} />
        <CompareCard label="Avg Order Value" sub="top line / orders" accent="#06B6D4" value={cur.orders ? cur.aov : null} prev={prev && prev.orders ? prev.aov : null} format={fmt} compareOn={compareOn} />
        <CompareCard
          label="Fill Rate"
          sub="invoiced vs ordered, orders shipped in period"
          accent="#EAB308"
          value={cur.fillRate}
          prev={prev && prev.fillRate}
          format={(v) => (v * 100).toFixed(1) + "%"}
          compareOn={compareOn}
        />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(138px,1fr))",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <MetricCard value={fmt(mCur.cogs)} label="COGS" sub="landed cost, shipped orders" accent="#EF4444" />
        <MetricCard value={fmt(mCur.fet)} label="FET" sub="excise tax on shipped units" accent="#F43F5E" />
        <MetricCard
          value={fmt(mCur.accFreight)}
          label="Freight ACC Paid"
          sub={`shipping cost ${fmt(mCur.shippingCost)} - billed ${fmt(mCur.freightBilled)}`}
          accent="#64748B"
        />
        <MetricCard
          value={fmt(mCur.profit)}
          label="Gross Profit"
          sub={
            compareOn && mPrev
              ? `${pctChange(mCur.profit, mPrev.profit) != null ? (pctChange(mCur.profit, mPrev.profit) >= 0 ? "▲ " : "▼ ") + Math.abs(pctChange(mCur.profit, mPrev.profit) * 100).toFixed(1) + "% " : ""}vs ${fmt(mPrev.profit)}`
              : "after cost, FET & freight"
          }
          accent="#7C3AED"
        />
        <MetricCard
          value={mCur.marginPct != null ? (mCur.marginPct * 100).toFixed(1) + "%" : "--"}
          label="Gross Margin"
          sub={
            mCur.incomplete > 0
              ? `${mCur.incomplete} order(s) missing product costs`
              : compareOn && mPrev && mPrev.marginPct != null
                ? `vs ${(mPrev.marginPct * 100).toFixed(1)}% · target ${(MARGIN_TARGET * 100).toFixed(0)}%`
                : `target ${(MARGIN_TARGET * 100).toFixed(0)}%`
          }
          accent="#06B6D4"
        />
        <MetricCard value={fmt(pipelineVal)} label="Open Order Value" sub="current, filled units" accent="#EAB308" />
        <MetricCard value={fmt(boVal)} label="Backorder Value" sub="current, units not covered by stock" accent="#F97316" />
        <MetricCard
          value={fmt(preBook.value)}
          label="Pre-Order Book"
          sub={
            preBook.count
              ? `${preBook.count} orders · ${fmtNum(preBook.units)} units${preBook.nextWindow ? ` · next ships ${fmtDate(preBook.nextWindow)}` : ""}`
              : "no open pre-orders"
          }
          accent="#A855F7"
        />
      </div>

      {/* Year over year by month */}
      <div style={{ marginBottom: 14 }}>
        <CC
          title={`${thisYear} vs ${thisYear - 1} by Month`}
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "#64748B" }}>
                YTD {yoyMetric === "topLine" ? "top line" : "invoiced"}:{" "}
                <strong style={{ color: "#0F172A" }}>{fmt(ytdCur[yoyMetric])}</strong> vs{" "}
                {fmt(ytdPrior[yoyMetric])} same point last year{" "}
                <Delta cur={ytdCur[yoyMetric]} prev={ytdPrior[yoyMetric]} />
              </span>
              <Toggle
                value={yoyMetric}
                onChange={setYoyMetric}
                options={[
                  ["topLine", "Top Line"],
                  ["invoiced", "Invoiced"],
                ]}
              />
            </div>
          }
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={yoy} barGap={2} maxBarSize={28}>
              <XAxis dataKey="month" tick={{ fill: "#64748B", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94A3B8", fontSize: 10 }} tickFormatter={fmtK} width={56} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v, name) => [fmt(v), name === "cur" ? String(thisYear) : String(thisYear - 1)]}
              />
              <Bar dataKey="prior" fill="#CBD5E1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="cur" fill="#7C3AED" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", fontSize: 11, color: "#64748B", marginTop: 4 }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#CBD5E1", borderRadius: 2, marginRight: 5 }} />{thisYear - 1}</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#7C3AED", borderRadius: 2, marginRight: 5 }} />{thisYear}</span>
          </div>
        </CC>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(420px,1fr))", gap: 14, marginBottom: 14 }}>
        <CC title="Monthly Revenue — Top Line (Ordered) vs Invoiced (Shipped)">
          {byMonth.length === 0 ? (
            <div style={{ color: "#94A3B8", fontSize: 13, textAlign: "center", padding: "30px 0" }}>
              No orders in this period
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byMonth} maxBarSize={56}>
                  <XAxis dataKey="month" tick={{ fill: "#94A3B8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#94A3B8", fontSize: 10 }} tickFormatter={fmtK} width={56} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v, name) => [fmt(v), name === "ordered" ? "Top Line (Ordered)" : "Invoiced (Shipped)"]}
                  />
                  <Bar dataKey="ordered" fill="#C4B5FD" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="invoiced" fill="#7C3AED" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", gap: 16, justifyContent: "center", fontSize: 11, color: "#64748B", marginTop: 4 }}>
                <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#C4B5FD", borderRadius: 2, marginRight: 5 }} />Top Line (Ordered)</span>
                <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#7C3AED", borderRadius: 2, marginRight: 5 }} />Invoiced (Shipped)</span>
              </div>
            </>
          )}
        </CC>

        {/* Ranked list instead of a chart so long product names stay readable */}
        <CC
          title="Top Products"
          right={
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Toggle
                value={prodBasis}
                onChange={setProdBasis}
                options={[
                  ["invoiced", "Invoiced"],
                  ["ordered", "Ordered"],
                ]}
              />
              <Toggle
                value={prodMetric}
                onChange={setProdMetric}
                options={[
                  ["rev", "$"],
                  ["units", "Units"],
                ]}
              />
            </div>
          }
        >
          {topProds.rows.length === 0 ? (
            <div style={{ color: "#94A3B8", fontSize: 13, textAlign: "center", padding: "30px 0" }}>
              No {prodBasis === "invoiced" ? "shipped" : ""} orders in this period
              {prodBasis === "invoiced" ? " — try the Ordered view" : ""}
            </div>
          ) : (
            <div>
              {topProds.rows.map((r, i) => {
                const max = topProds.rows[0].val || 1;
                return (
                  <div key={r.id} style={{ padding: "6px 0", borderBottom: "1px solid #F1F5F9" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ width: 18, fontSize: 11, fontWeight: 800, color: "#94A3B8" }}>{i + 1}</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: "#6D28D9", whiteSpace: "nowrap" }}>
                        {r.sku}
                      </span>
                      <span
                        title={r.name}
                        style={{ fontSize: 12, color: "#334155", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {r.name}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#0F172A", whiteSpace: "nowrap" }}>
                        {prodMetric === "rev" ? fmt(r.val) : `${fmtNum(r.val)} units`}
                      </span>
                      {compareOn && (
                        <span style={{ width: 62, textAlign: "right" }}>
                          <Delta small cur={r.val} prev={r.prevVal} />
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, paddingLeft: 26 }}>
                      <div style={{ flex: 1, height: 6, background: "#F1F5F9", borderRadius: 3 }}>
                        <div style={{ width: `${(r.val / max) * 100}%`, height: 6, background: "#06B6D4", borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 10, color: "#94A3B8", width: 90, textAlign: "right" }}>
                        {(r.share * 100).toFixed(1)}% &middot;{" "}
                        {prodMetric === "rev" ? `${fmtNum(r.units)} u` : fmt(r.rev)}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 8 }}>
                {prodMetric === "rev" ? fmt(topProds.total) : `${fmtNum(topProds.total)} units`} total in
                period &middot; live orders only (imported history has no SKU detail)
              </div>
            </div>
          )}
        </CC>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(420px,1fr))", gap: 14, marginBottom: 14 }}>
        <CC
          title="Top Customers"
          right={
            custAgg.length > 10 && (
              <button style={{ ...BS, fontSize: 11, padding: "4px 10px" }} onClick={() => setShowAllCust((v) => !v)}>
                {showAllCust ? "Top 10" : `Show all ${custAgg.length}`}
              </button>
            )
          }
        >
          {custAgg.length === 0 ? (
            <div style={{ color: "#94A3B8", fontSize: 13, textAlign: "center", padding: "30px 0" }}>
              No customer activity in this period
            </div>
          ) : (
            <div style={{ overflowX: "auto", maxHeight: showAllCust ? 480 : undefined, overflowY: showAllCust ? "auto" : undefined }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...smallTh, textAlign: "left" }}>Customer</th>
                    <th style={smallTh}>Top Line</th>
                    {compareOn && <th style={smallTh}>vs</th>}
                    <th style={smallTh}>Invoiced</th>
                    {compareOn && <th style={smallTh}>vs</th>}
                  </tr>
                </thead>
                <tbody>
                  {shownCust.map((r) => (
                    <tr key={r.key}>
                      <td style={{ ...smallTd, textAlign: "left", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={r.key}>
                        <span style={{ fontWeight: 600, color: "#0F172A" }}>{r.key}</span>
                        <span style={{ fontSize: 10, color: "#94A3B8", marginLeft: 6 }}>{CHANNEL_LABELS[r.channel] || ""}</span>
                      </td>
                      <td style={{ ...smallTd, fontWeight: 700, color: "#0F172A" }}>{fmt(r.topLine)}</td>
                      {compareOn && (
                        <td style={smallTd} title={`Compare period: ${fmt(r.prevTop)}`}>
                          <Delta small cur={r.topLine} prev={r.prevTop} />
                        </td>
                      )}
                      <td style={smallTd}>{fmt(r.invoiced)}</td>
                      {compareOn && (
                        <td style={smallTd} title={`Compare period: ${fmt(r.prevInv)}`}>
                          <Delta small cur={r.invoiced} prev={r.prevInv} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CC>

        <CC title="Sales by Channel">
          {channelAgg.length === 0 ? (
            <div style={{ color: "#94A3B8", fontSize: 13, textAlign: "center", padding: "30px 0" }}>
              No sales in this period
            </div>
          ) : (
            <div>
              {channelAgg.map((r) => (
                <div key={r.key} style={{ padding: "8px 0", borderBottom: "1px solid #F1F5F9" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, color: "#0F172A", fontSize: 13 }}>{r.label}</span>
                    <span style={{ fontSize: 11, color: "#64748B" }}>{fmtNum(r.orders)} orders</span>
                  </div>
                  {[
                    ["Top line", r.topLine, r.topShare, r.prevTop, "#7C3AED"],
                    ["Invoiced", r.invoiced, r.invShare, r.prevInv, "#10B981"],
                  ].map(([lbl, v, share, pv, col]) => (
                    <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <span style={{ width: 58, fontSize: 10, color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>{lbl}</span>
                      <div style={{ flex: 1, height: 6, background: "#F1F5F9", borderRadius: 3 }}>
                        <div style={{ width: `${share * 100}%`, height: 6, background: col, borderRadius: 3 }} />
                      </div>
                      <span style={{ width: 96, textAlign: "right", fontSize: 12, fontWeight: 700, color: "#0F172A" }}>{fmt(v)}</span>
                      <span style={{ width: 40, textAlign: "right", fontSize: 10, color: "#94A3B8" }}>{(share * 100).toFixed(0)}%</span>
                      {compareOn && (
                        <span style={{ width: 62, textAlign: "right" }} title={`Compare period: ${fmt(pv)}`}>
                          <Delta small cur={v} prev={pv} />
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </CC>
      </div>

      {/* Gross margin by customer / channel / product (shipped live orders) */}
      <div style={{ marginBottom: 14 }}>
        <CC
          title="Gross Margin"
          right={
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Toggle
                value={marginBy}
                onChange={(v) => {
                  setMarginBy(v);
                  setShowAllMargin(false);
                }}
                options={[
                  ["customer", "By Customer"],
                  ["channel", "By Channel"],
                  ["product", "By Product"],
                ]}
              />
              {marginRows.length > 12 && (
                <button style={{ ...BS, fontSize: 11, padding: "4px 10px" }} onClick={() => setShowAllMargin((v) => !v)}>
                  {showAllMargin ? "Top 12" : `Show all ${marginRows.length}`}
                </button>
              )}
            </div>
          }
        >
          {marginRows.length === 0 ? (
            <div style={{ color: "#94A3B8", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
              No shipped orders in this period
            </div>
          ) : (
            <>
              <div style={{ overflowX: "auto", maxHeight: showAllMargin ? 480 : undefined, overflowY: showAllMargin ? "auto" : undefined }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...smallTh, textAlign: "left" }}>
                        {marginBy === "customer" ? "Customer" : marginBy === "channel" ? "Channel" : "Product"}
                      </th>
                      <th style={smallTh}>{marginBy === "product" ? "Units" : "Orders"}</th>
                      <th style={smallTh}>Revenue</th>
                      <th style={smallTh}>Gross Profit</th>
                      <th style={smallTh}>Margin</th>
                      <th style={{ ...smallTh, width: "28%" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllMargin ? marginRows : marginRows.slice(0, 12)).map((r) => (
                      <tr key={r.key}>
                        <td style={{ ...smallTd, textAlign: "left", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }} title={r.name || r.label}>
                          <span style={{ fontWeight: 600, color: marginBy === "product" ? "#6D28D9" : "#0F172A", fontFamily: marginBy === "product" ? "monospace" : undefined }}>
                            {r.label}
                          </span>
                          {marginBy === "product" && r.name && (
                            <span style={{ fontSize: 11, color: "#64748B", marginLeft: 6 }}>{r.name}</span>
                          )}
                          {r.incomplete > 0 && (
                            <span style={{ fontSize: 10, color: "#B91C1C", marginLeft: 6 }} title="Some products have no cost on file -- margin overstated">
                              missing cost
                            </span>
                          )}
                        </td>
                        <td style={smallTd}>{fmtNum(marginBy === "product" ? r.units : r.orders)}</td>
                        <td style={smallTd}>{fmt(r.revenue)}</td>
                        <td style={{ ...smallTd, fontWeight: 700, color: "#0F172A" }}>{fmt(r.profit)}</td>
                        <td style={{ ...smallTd, fontWeight: 800, color: marginColor(r.pct) }}>
                          {r.pct == null ? "--" : `${(r.pct * 100).toFixed(1)}%`}
                        </td>
                        <td style={smallTd}>
                          <div style={{ position: "relative", height: 8, background: "#F1F5F9", borderRadius: 4 }}>
                            <div style={{ width: `${Math.max(0, Math.min(1, r.pct || 0)) * 100}%`, height: 8, background: marginColor(r.pct), borderRadius: 4, opacity: 0.8 }} />
                            <div title={`Target ${(MARGIN_TARGET * 100).toFixed(0)}%`} style={{ position: "absolute", left: `${MARGIN_TARGET * 100}%`, top: -3, width: 2, height: 14, background: "#0F172A", opacity: 0.4 }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 8 }}>
                Live orders shipped in the period. Gross profit = price charged - landed cost - FET
                {marginBy === "product" ? "" : " - freight ACC paid"}; before commissions, co-op and other
                selling costs. Bar marker = {(MARGIN_TARGET * 100).toFixed(0)}% target.
                {mCur.estimated > 0 && ` ${mCur.estimated} order(s) shipped before costs were locked use current product costs.`}
              </div>
            </>
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
            <MetricCard value={fmtNum(histTotals.orders)} label="Historical Orders" accent="#64748B" />
            <MetricCard
              value={histTotals.fillRate != null ? (histTotals.fillRate * 100).toFixed(1) + "%" : "--"}
              label="Historical Fill Rate"
              sub="invoiced vs PO amount"
              accent="#06B6D4"
            />
          </div>
          <CC title="Invoiced Revenue by Year — live system + imported history">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byYear} maxBarSize={80}>
                <XAxis dataKey="year" tick={{ fill: "#94A3B8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94A3B8", fontSize: 10 }} tickFormatter={fmtK} width={56} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v, name) => [fmt(v), name === "history" ? "Imported history" : "Live system"]}
                />
                <Bar dataKey="history" stackId="rev" fill="#94A3B8" radius={[0, 0, 0, 0]} />
                <Bar dataKey="live" stackId="rev" fill="#7C3AED" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CC>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(420px,1fr))", gap: 14, marginBottom: 14 }}>
        <CC title="Available Stock Health">
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie data={stockPie} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value">
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
                (sum, o) => sum + o.lines.reduce((ls, l) => ls + filledQty(l) * l.price, 0),
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
          <select value={custSel} onChange={(e) => setCustSel(e.target.value)} style={{ ...SS, width: 240 }}>
            <option value="all">All Customers</option>
            {customerOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 12, color: "#94A3B8" }}>
            {(TIMEFRAMES.find((t) => t.id === timeframe) || {}).label} (period set above)
          </span>
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
                Invoiced Revenue (In Range)
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
