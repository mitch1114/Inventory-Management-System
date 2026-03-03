import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { computeDemandMetrics, buildAISummary } from "../lib/forecasting";
import { analyzeInventory } from "../lib/claude";
import { fmt, fmtNum, fmtDate, todayIso, uid, nowIso, dlCSV, toCSV } from "../lib/utils";
import { Badge, Table, TR, TD, BP, BS, IS, SS } from "./ui";

const URGENCY_COLORS = {
  critical: { bg: "#FEF2F2", text: "#DC2626", dot: "#EF4444", border: "#FECACA" },
  warning:  { bg: "#FFFBEB", text: "#D97706", dot: "#F59E0B", border: "#FDE68A" },
  ok:       { bg: "#F0FDF4", text: "#15803D", dot: "#22C55E", border: "#BBF7D0" },
  "no-velocity": { bg: "#F8FAFC", text: "#94A3B8", dot: "#CBD5E1", border: "#E2E8F0" },
};

const LOOKBACK_OPTIONS = [
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
];

const QUICK_PROMPTS = [
  "What should I reorder this week? Give me specific POs to place with quantities and expected costs.",
  "Which products are at risk of stocking out before their next PO arrives?",
  "Analyze my sales velocity trends -- which products are growing vs declining?",
  "What's my optimal reorder strategy for the upcoming spring crappie season?",
  "How much capital do I need for restocking over the next 60 days?",
];

export default function DemandPlanning({ data, setData }) {
  const { products, salesOrders, suppliers, purchaseOrders } = data;
  const [lookback, setLookback] = useState(90);
  const [filter, setFilter] = useState("all"); // all | needs-reorder | critical | warning
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [showAI, setShowAI] = useState(false);
  const aiScrollRef = useRef(null);

  const metrics = useMemo(
    () => computeDemandMetrics(products, salesOrders, suppliers, purchaseOrders, lookback),
    [products, salesOrders, suppliers, purchaseOrders, lookback],
  );

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
    [products],
  );

  const filtered = useMemo(() => {
    let list = metrics;
    if (filter === "needs-reorder") list = list.filter((m) => m.needsReorder);
    if (filter === "critical") list = list.filter((m) => m.urgency === "critical");
    if (filter === "warning") list = list.filter((m) => m.urgency === "warning");
    if (categoryFilter) list = list.filter((m) => m.category === categoryFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) =>
          m.sku.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          (m.supplier && m.supplier.name.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [metrics, filter, search, categoryFilter]);

  // --- KPIs ---
  const kpis = useMemo(() => {
    const needsReorder = metrics.filter((m) => m.needsReorder);
    const critical = metrics.filter((m) => m.urgency === "critical");
    const totalReorderValue = needsReorder.reduce(
      (s, m) => s + m.suggestedOrderQty * m.costPrice,
      0,
    );
    const withVelocity = metrics.filter((m) => m.velocity.unitsPerDay > 0);
    const avgDaysSupply =
      withVelocity.length > 0
        ? Math.round(
            withVelocity.reduce(
              (s, m) => s + (m.daysOfSupply === Infinity ? 365 : m.daysOfSupply),
              0,
            ) / withVelocity.length,
          )
        : null;
    const overdueOrders = metrics.filter(
      (m) => m.orderByDate && m.orderByDate < todayIso() && m.needsReorder,
    );
    return { needsReorder, critical, totalReorderValue, avgDaysSupply, overdueOrders };
  }, [metrics]);

  // --- Chart data: days of supply for top movers ---
  const chartData = useMemo(() => {
    return metrics
      .filter((m) => m.velocity.unitsPerDay > 0)
      .slice(0, 20)
      .map((m) => ({
        name: m.sku,
        dos: m.daysOfSupply === Infinity ? 999 : m.daysOfSupply,
        leadDays: m.leadDays,
        urgency: m.urgency,
      }));
  }, [metrics]);

  // --- AI Analysis ---
  const handleAIAnalysis = useCallback(
    async (prompt) => {
      const question = prompt || aiPrompt;
      if (!question.trim()) return;
      setAiLoading(true);
      setAiError("");
      setAiResponse("");
      try {
        const summary = buildAISummary(metrics, suppliers, purchaseOrders);
        const result = await analyzeInventory(summary, question);
        if (result.success) {
          setAiResponse(result.response);
        } else {
          setAiError(result.error || "Unknown error");
        }
      } catch (err) {
        setAiError(`Request failed: ${err.message}`);
      } finally {
        setAiLoading(false);
      }
    },
    [aiPrompt, metrics, suppliers, purchaseOrders],
  );

  useEffect(() => {
    if (aiResponse && aiScrollRef.current) {
      aiScrollRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [aiResponse]);

  // --- Generate suggested POs ---
  const generatePOs = useCallback(() => {
    const reorderItems = metrics.filter((m) => m.needsReorder && m.suggestedOrderQty > 0);
    if (reorderItems.length === 0) return;

    // Group by supplier
    const bySupplier = {};
    reorderItems.forEach((m) => {
      const supId = m.supplier ? m.supplier.id : "unknown";
      if (!bySupplier[supId]) bySupplier[supId] = [];
      bySupplier[supId].push(m);
    });

    let nextData = { ...data };
    const newLogs = [];
    let poCounter = data.counters.po;

    Object.entries(bySupplier).forEach(([supId, items]) => {
      if (supId === "unknown") return;
      const sup = suppliers.find((s) => s.id === supId);
      poCounter++;
      const poNum = `PO-${String(poCounter).padStart(4, "0")}`;
      const expectedDate = new Date(
        Date.now() + (sup ? sup.leadDays : 14) * 86400000,
      )
        .toISOString()
        .slice(0, 10);

      const po = {
        id: uid(),
        orderNum: poNum,
        supplierId: supId,
        date: todayIso(),
        expectedDate,
        status: "ordered",
        lines: items.map((m) => ({
          productId: m.id,
          qty: m.suggestedOrderQty,
          cost: m.costPrice,
        })),
        notes: `Auto-generated from demand planning -- ${items.length} items need restocking`,
      };

      nextData = {
        ...nextData,
        purchaseOrders: [...nextData.purchaseOrders, po],
        counters: { ...nextData.counters, po: poCounter },
      };

      newLogs.push({
        id: uid(),
        ts: nowIso(),
        type: "ordered",
        entity: poNum,
        description: `${poNum} auto-generated from demand planning -- ${sup ? sup.name : "Unknown"} -- ${items.length} items, ${fmt(items.reduce((s, m) => s + m.suggestedOrderQty * m.costPrice, 0))}`,
      });
    });

    nextData = {
      ...nextData,
      auditLog: [...(nextData.auditLog || []), ...newLogs],
    };

    setData(nextData);
  }, [metrics, data, setData, suppliers]);

  // --- Export reorder plan as CSV ---
  const exportCSV = useCallback(() => {
    const rows = filtered.map((m) => ({
      sku: m.sku,
      name: m.name,
      category: m.category,
      supplier: m.supplier ? m.supplier.name : "",
      onHand: m.onHand,
      available: m.available,
      locked: m.locked,
      backordered: m.backordered,
      "velocity/day": m.velocity.unitsPerDay.toFixed(2),
      "velocity/month": m.velocity.unitsPerMonth.toFixed(1),
      daysOfSupply: m.daysOfSupply === Infinity ? "N/A" : m.daysOfSupply,
      leadDays: m.leadDays,
      staticReorderPoint: m.reorderPoint,
      dynamicReorderPoint: m.dynamicReorderPoint,
      suggestedOrderQty: m.suggestedOrderQty,
      incomingPO: m.incomingQty,
      stockoutDate: m.stockoutDate || "N/A",
      orderByDate: m.orderByDate || "N/A",
      urgency: m.urgency,
    }));
    const headers = Object.keys(rows[0] || {});
    dlCSV(toCSV(rows, headers), `demand-plan-${todayIso()}.csv`);
  }, [filtered]);

  // --- UI Helpers ---
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

  const CC = ({ title, children, actions }) => (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E8F0",
        borderRadius: 12,
        padding: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 700, color: "#0F172A", fontSize: 14 }}>{title}</div>
        {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
      </div>
      {children}
    </div>
  );

  const UrgencyBadge = ({ urgency }) => {
    const c = URGENCY_COLORS[urgency] || URGENCY_COLORS["no-velocity"];
    const labels = {
      critical: "Critical",
      warning: "Low Stock",
      ok: "Adequate",
      "no-velocity": "No Sales",
    };
    return (
      <span
        style={{
          background: c.bg,
          color: c.text,
          border: `1px solid ${c.border}`,
          borderRadius: 20,
          padding: "2px 10px",
          fontSize: 11,
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: c.dot,
            flexShrink: 0,
          }}
        />
        {labels[urgency] || urgency}
      </span>
    );
  };

  const reorderCount = kpis.needsReorder.length;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>
            Demand Planning
          </h2>
          <p style={{ color: "#94A3B8", margin: "4px 0 0", fontSize: 13 }}>
            AI-powered forecasting &middot; Sales velocity over last{" "}
            <select
              value={lookback}
              onChange={(e) => setLookback(Number(e.target.value))}
              style={{
                background: "transparent",
                border: "none",
                borderBottom: "1px dashed #94A3B8",
                color: "#2563EB",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
                padding: 0,
              }}
            >
              {LOOKBACK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setShowAI(!showAI)}
            style={{
              ...BP,
              background: showAI
                ? "linear-gradient(135deg,#DC2626,#EF4444)"
                : "linear-gradient(135deg,#6D28D9,#4F46E5)",
            }}
          >
            {showAI ? "Close AI" : "Ask Claude AI"}
          </button>
          <button onClick={exportCSV} style={BS}>
            Export CSV
          </button>
          {reorderCount > 0 && (
            <button
              onClick={() => {
                if (
                  window.confirm(
                    `Generate ${reorderCount} suggested PO(s) for products needing restock?`,
                  )
                ) {
                  generatePOs();
                }
              }}
              style={{
                ...BP,
                background: "linear-gradient(135deg,#059669,#10B981)",
              }}
            >
              Generate POs ({reorderCount})
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))",
          gap: 10,
          marginBottom: 18,
        }}
      >
        <Stat
          label="Need Reorder"
          value={kpis.needsReorder.length}
          sub="below dynamic reorder point"
          accent="#F59E0B"
          warn={kpis.needsReorder.length > 0}
        />
        <Stat
          label="Critical / Stockout Risk"
          value={kpis.critical.length}
          sub="days of supply <= lead time"
          accent="#EF4444"
          warn={kpis.critical.length > 0}
        />
        <Stat
          label="Restock Investment"
          value={fmt(kpis.totalReorderValue)}
          sub="suggested PO cost"
          accent="#7C3AED"
        />
        <Stat
          label="Avg Days of Supply"
          value={kpis.avgDaysSupply != null ? `${kpis.avgDaysSupply}d` : "--"}
          sub="active products"
          accent="#06B6D4"
          warn={kpis.avgDaysSupply != null && kpis.avgDaysSupply < 30}
        />
        <Stat
          label="Overdue Reorders"
          value={kpis.overdueOrders.length}
          sub="order-by date has passed"
          accent="#DC2626"
          warn={kpis.overdueOrders.length > 0}
        />
      </div>

      {/* Claude AI Panel */}
      {showAI && (
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #DDD6FE",
            borderRadius: 12,
            padding: 20,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "linear-gradient(135deg,#6D28D9,#4F46E5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontWeight: 800,
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              AI
            </div>
            <div>
              <div style={{ fontWeight: 700, color: "#0F172A", fontSize: 14 }}>
                Claude AI Demand Analyst
              </div>
              <div style={{ fontSize: 11, color: "#94A3B8" }}>
                Analyzes your live inventory data and provides actionable recommendations
              </div>
            </div>
          </div>

          {/* Quick prompts */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {QUICK_PROMPTS.map((p, i) => (
              <button
                key={i}
                onClick={() => {
                  setAiPrompt(p);
                  handleAIAnalysis(p);
                }}
                disabled={aiLoading}
                style={{
                  background: "#F5F3FF",
                  border: "1px solid #DDD6FE",
                  borderRadius: 20,
                  padding: "5px 12px",
                  fontSize: 11,
                  color: "#6D28D9",
                  cursor: aiLoading ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  fontWeight: 500,
                  opacity: aiLoading ? 0.5 : 1,
                }}
              >
                {p.length > 60 ? p.slice(0, 57) + "..." : p}
              </button>
            ))}
          </div>

          {/* Custom prompt input */}
          <div style={{ display: "flex", gap: 8 }}>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAIAnalysis();
                }
              }}
              placeholder="Ask Claude about your inventory... e.g. 'What should I reorder this week?'"
              rows={2}
              style={{
                ...IS,
                flex: 1,
                resize: "vertical",
                minHeight: 44,
              }}
            />
            <button
              onClick={() => handleAIAnalysis()}
              disabled={aiLoading || !aiPrompt.trim()}
              style={{
                ...BP,
                opacity: aiLoading || !aiPrompt.trim() ? 0.5 : 1,
                cursor: aiLoading || !aiPrompt.trim() ? "not-allowed" : "pointer",
                alignSelf: "flex-end",
                minWidth: 90,
              }}
            >
              {aiLoading ? "Thinking..." : "Analyze"}
            </button>
          </div>

          {/* AI Response */}
          {aiError && (
            <div
              style={{
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 8,
                padding: "10px 14px",
                marginTop: 12,
                fontSize: 13,
                color: "#DC2626",
              }}
            >
              {aiError}
            </div>
          )}
          {aiLoading && (
            <div
              style={{
                background: "#F5F3FF",
                border: "1px solid #DDD6FE",
                borderRadius: 8,
                padding: "16px 14px",
                marginTop: 12,
                fontSize: 13,
                color: "#6D28D9",
                textAlign: "center",
              }}
            >
              Claude is analyzing your inventory data...
            </div>
          )}
          {aiResponse && !aiLoading && (
            <div
              ref={aiScrollRef}
              style={{
                background: "#FAFAF9",
                border: "1px solid #E2E8F0",
                borderRadius: 8,
                padding: "16px 18px",
                marginTop: 12,
                fontSize: 13,
                color: "#1E293B",
                lineHeight: 1.65,
                whiteSpace: "pre-wrap",
                maxHeight: 500,
                overflowY: "auto",
              }}
            >
              {aiResponse}
            </div>
          )}
        </div>
      )}

      {/* Days of Supply Chart */}
      {chartData.length > 0 && (
        <CC title="Days of Supply by Product (Active Sellers)" style={{ marginBottom: 18 }}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ left: 0, right: 8 }}>
              <XAxis
                dataKey="name"
                tick={{ fill: "#94A3B8", fontSize: 9 }}
                angle={-35}
                textAnchor="end"
                height={60}
                interval={0}
              />
              <YAxis tick={{ fill: "#94A3B8", fontSize: 10 }} label={{ value: "Days", angle: -90, position: "insideLeft", fill: "#94A3B8", fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "#FFFFFF",
                  border: "1px solid #CBD5E1",
                  borderRadius: 8,
                  color: "#0F172A",
                  fontSize: 12,
                }}
                formatter={(v, name) => [
                  v >= 999 ? "N/A" : `${v} days`,
                  "Days of Supply",
                ]}
              />
              <ReferenceLine y={30} stroke="#F59E0B" strokeDasharray="5 5" label={{ value: "30d warning", fill: "#F59E0B", fontSize: 10, position: "top" }} />
              <Bar dataKey="dos" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={
                      entry.urgency === "critical"
                        ? "#EF4444"
                        : entry.urgency === "warning"
                          ? "#F59E0B"
                          : "#10B981"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CC>
      )}

      {/* Filters & Search */}
      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 14,
          marginTop: 18,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <input
          type="text"
          placeholder="Search SKU, name, supplier..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...IS, maxWidth: 260 }}
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ ...SS, maxWidth: 180 }}
        >
          <option value="all">All Products ({metrics.length})</option>
          <option value="needs-reorder">
            Needs Reorder ({metrics.filter((m) => m.needsReorder).length})
          </option>
          <option value="critical">
            Critical ({metrics.filter((m) => m.urgency === "critical").length})
          </option>
          <option value="warning">
            Warning ({metrics.filter((m) => m.urgency === "warning").length})
          </option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ ...SS, maxWidth: 180 }}
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>
          {filtered.length} of {metrics.length} products
        </div>
      </div>

      {/* Main Forecast Table */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                {[
                  "Status",
                  "SKU",
                  "Product",
                  "Supplier",
                  "On Hand",
                  "Available",
                  "Velocity/mo",
                  "Days Supply",
                  "Lead Time",
                  "Dynamic ROP",
                  "Static ROP",
                  "Suggested Qty",
                  "Incoming PO",
                  "Stockout",
                  "Order By",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "10px 10px",
                      textAlign: "left",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#94A3B8",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
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
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={15}
                    style={{ padding: 48, textAlign: "center", color: "#94A3B8", fontSize: 14 }}
                  >
                    No products match the current filters.
                  </td>
                </tr>
              )}
              {filtered.map((m, i) => {
                const isOverdue = m.orderByDate && m.orderByDate < todayIso();
                return (
                  <tr
                    key={m.id}
                    style={{
                      borderBottom: "1px solid #F1F5F9",
                      background:
                        m.urgency === "critical"
                          ? "#FEF2F2"
                          : i % 2 === 0
                            ? "transparent"
                            : "#FAFAFA",
                    }}
                  >
                    <td style={{ padding: "9px 10px" }}>
                      <UrgencyBadge urgency={m.urgency} />
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        fontFamily: "monospace",
                        fontWeight: 600,
                        fontSize: 12,
                        color: "#374151",
                      }}
                    >
                      {m.sku}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        fontSize: 12,
                        color: "#0F172A",
                        maxWidth: 180,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.name}
                    </td>
                    <td style={{ padding: "9px 10px", fontSize: 12, color: "#64748B" }}>
                      {m.supplier ? m.supplier.name : "--"}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#0F172A",
                        textAlign: "right",
                      }}
                    >
                      {fmtNum(m.onHand)}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        fontSize: 13,
                        fontWeight: 600,
                        color: m.available <= 0 ? "#DC2626" : m.available <= m.dynamicReorderPoint ? "#D97706" : "#15803D",
                        textAlign: "right",
                      }}
                    >
                      {fmtNum(m.available)}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        fontSize: 13,
                        color: "#0F172A",
                        textAlign: "right",
                      }}
                    >
                      {m.velocity.unitsPerMonth > 0
                        ? m.velocity.unitsPerMonth.toFixed(1)
                        : "--"}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        fontSize: 13,
                        fontWeight: 700,
                        color:
                          m.daysOfSupply === Infinity
                            ? "#94A3B8"
                            : m.daysOfSupply <= m.leadDays
                              ? "#DC2626"
                              : m.daysOfSupply <= 30
                                ? "#D97706"
                                : "#15803D",
                        textAlign: "right",
                      }}
                    >
                      {m.daysOfSupply === Infinity ? "--" : `${m.daysOfSupply}d`}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        fontSize: 12,
                        color: "#64748B",
                        textAlign: "right",
                      }}
                    >
                      {m.leadDays}d
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#7C3AED",
                        textAlign: "right",
                      }}
                    >
                      {m.dynamicReorderPoint > 0 ? m.dynamicReorderPoint : "--"}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        fontSize: 12,
                        color: "#94A3B8",
                        textAlign: "right",
                      }}
                    >
                      {m.reorderPoint}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        fontSize: 13,
                        fontWeight: 700,
                        color: m.suggestedOrderQty > 0 ? "#0F172A" : "#94A3B8",
                        textAlign: "right",
                      }}
                    >
                      {m.suggestedOrderQty > 0 ? fmtNum(m.suggestedOrderQty) : "--"}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        fontSize: 12,
                        color: m.incomingQty > 0 ? "#2563EB" : "#94A3B8",
                        fontWeight: m.incomingQty > 0 ? 600 : 400,
                        textAlign: "right",
                      }}
                    >
                      {m.incomingQty > 0 ? fmtNum(m.incomingQty) : "--"}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        fontSize: 12,
                        color:
                          m.stockoutDate && m.stockoutDate <= todayIso()
                            ? "#DC2626"
                            : m.stockoutDate
                              ? "#D97706"
                              : "#94A3B8",
                        fontWeight: m.stockoutDate ? 600 : 400,
                      }}
                    >
                      {m.stockoutDate ? fmtDate(m.stockoutDate) : "--"}
                    </td>
                    <td
                      style={{
                        padding: "9px 10px",
                        fontSize: 12,
                        color: isOverdue ? "#DC2626" : m.orderByDate ? "#D97706" : "#94A3B8",
                        fontWeight: isOverdue ? 700 : m.orderByDate ? 600 : 400,
                      }}
                    >
                      {m.orderByDate ? fmtDate(m.orderByDate) : "--"}
                      {isOverdue && (
                        <span style={{ fontSize: 10, marginLeft: 4, color: "#DC2626" }}>
                          OVERDUE
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginTop: 14,
          fontSize: 11,
          color: "#94A3B8",
          flexWrap: "wrap",
        }}
      >
        <span>
          <strong>Dynamic ROP</strong> = (velocity/day &times; lead time) &times; 1.5 safety
        </span>
        <span>
          <strong>Days Supply</strong> = Available / daily velocity
        </span>
        <span>
          <strong>Suggested Qty</strong> = (target stock &minus; available &minus; incoming PO)
        </span>
        <span>
          <strong>Order By</strong> = Stockout date &minus; supplier lead time
        </span>
      </div>
    </div>
  );
}
