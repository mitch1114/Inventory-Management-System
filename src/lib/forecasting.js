// --- Demand Forecasting Engine ------------------------------------------------
// Computes sales velocity, dynamic reorder points, days of supply, stockout
// risk dates, and suggested PO quantities for each product.

/**
 * Compute daily sales velocity per product from shipped order history.
 * Uses a configurable lookback window (default 90 days).
 * Returns Map<productId, { unitsPerDay, unitsPerWeek, unitsPerMonth, totalShipped, daysCovered }>
 */
export function computeSalesVelocity(products, salesOrders, lookbackDays = 90) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - lookbackDays * 86400000);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  // Only count shipped orders within the lookback window
  const shipped = salesOrders.filter(
    (o) => o.fulfillmentStage === "shipped" && o.date >= cutoffIso,
  );

  const totals = {};
  shipped.forEach((o) => {
    o.lines.forEach((l) => {
      const qty = l.qtyFilled != null ? l.qtyFilled : l.qty;
      totals[l.productId] = (totals[l.productId] || 0) + qty;
    });
  });

  // Find the earliest shipped order date for the velocity window
  const allShippedDates = salesOrders
    .filter((o) => o.fulfillmentStage === "shipped")
    .map((o) => o.date)
    .sort();
  const earliestShipped = allShippedDates.length > 0 ? allShippedDates[0] : null;

  // The actual days we have data for (capped at lookbackDays)
  let daysCovered = lookbackDays;
  if (earliestShipped) {
    const earliest = new Date(earliestShipped + "T00:00:00");
    const diff = Math.ceil((now - earliest) / 86400000);
    daysCovered = Math.min(lookbackDays, Math.max(diff, 1));
  }

  const velocity = new Map();
  products.forEach((p) => {
    const total = totals[p.id] || 0;
    const perDay = daysCovered > 0 ? total / daysCovered : 0;
    velocity.set(p.id, {
      unitsPerDay: perDay,
      unitsPerWeek: perDay * 7,
      unitsPerMonth: perDay * 30,
      totalShipped: total,
      daysCovered,
    });
  });

  return velocity;
}

/**
 * Get units currently on order (open POs not yet fully received) per product.
 * Returns Map<productId, number>
 */
export function computeIncomingStock(purchaseOrders) {
  const incoming = {};
  purchaseOrders.forEach((po) => {
    if (po.status === "received") return; // fully received, skip
    po.lines.forEach((l) => {
      incoming[l.productId] = (incoming[l.productId] || 0) + l.qty;
    });
  });
  return incoming;
}

/**
 * Compute demand-in-pipeline: units in confirmed/picked/booked orders
 * that are already committed but not yet shipped.
 * Returns Map<productId, number>
 */
function computePipelineDemand(salesOrders) {
  const LOCKING = new Set(["confirmed", "picked", "booked"]);
  const demand = {};
  salesOrders.forEach((o) => {
    if (!LOCKING.has(o.fulfillmentStage)) return;
    o.lines.forEach((l) => {
      const qty = l.qtyFilled != null ? l.qtyFilled : l.qty;
      demand[l.productId] = (demand[l.productId] || 0) + qty;
    });
  });
  return demand;
}

/**
 * Safety stock multiplier -- extra buffer beyond lead time demand.
 * Default 1.5x means we keep 50% extra buffer above the lead-time demand.
 */
const SAFETY_MULTIPLIER = 1.5;

/**
 * Compute full demand planning metrics for every product.
 *
 * Returns array of objects (one per product) sorted by urgency (days of supply ascending):
 * {
 *   ...product fields (id, sku, name, category, onHand, available, locked, backordered, etc.),
 *   velocity: { unitsPerDay, unitsPerWeek, unitsPerMonth, totalShipped, daysCovered },
 *   supplier: { id, name, leadDays, ... },
 *   daysOfSupply:        number (available / daily velocity, Infinity if velocity=0),
 *   dynamicReorderPoint: number (daily velocity × lead time × safety multiplier),
 *   suggestedOrderQty:   number (units needed to cover lead time + buffer, minus incoming),
 *   stockoutDate:        string|null (ISO date when available hits 0 at current velocity),
 *   orderByDate:         string|null (ISO date -- when to place PO so it arrives before stockout),
 *   incomingQty:         number (units on open POs),
 *   pipelineDemand:      number (units locked in active orders),
 *   needsReorder:        boolean (available <= dynamicReorderPoint),
 *   urgency:             "critical"|"warning"|"ok"|"no-velocity"
 * }
 */
export function computeDemandMetrics(
  products,
  salesOrders,
  suppliers,
  purchaseOrders,
  lookbackDays = 90,
) {
  const velocity = computeSalesVelocity(products, salesOrders, lookbackDays);
  const incoming = computeIncomingStock(purchaseOrders);
  const pipelineDemand = computePipelineDemand(salesOrders);
  const supplierMap = Object.fromEntries((suppliers || []).map((s) => [s.id, s]));
  const now = new Date();

  return products
    .map((p) => {
      const v = velocity.get(p.id) || {
        unitsPerDay: 0,
        unitsPerWeek: 0,
        unitsPerMonth: 0,
        totalShipped: 0,
        daysCovered: 0,
      };
      const sup = supplierMap[p.supplier] || null;
      const leadDays = sup ? sup.leadDays || 14 : 14; // default 14 days if unknown
      const incomingQty = incoming[p.id] || 0;
      const pipeDemand = pipelineDemand[p.id] || 0;

      // Days of supply = available units / daily velocity
      const daysOfSupply =
        v.unitsPerDay > 0 ? Math.round(p.available / v.unitsPerDay) : Infinity;

      // Dynamic reorder point = (daily velocity × lead time) × safety multiplier
      const dynamicReorderPoint = Math.ceil(
        v.unitsPerDay * leadDays * SAFETY_MULTIPLIER,
      );

      // Suggested order qty = cover 60 days of demand (beyond what's already incoming)
      const coverageDays = leadDays + 30; // lead time + 30 day buffer
      const targetStock = Math.ceil(v.unitsPerDay * coverageDays * SAFETY_MULTIPLIER);
      const gap = targetStock - p.available - incomingQty;
      const suggestedOrderQty = Math.max(0, gap);

      // Stockout date = today + daysOfSupply
      let stockoutDate = null;
      if (v.unitsPerDay > 0 && daysOfSupply < Infinity) {
        const d = new Date(now.getTime() + daysOfSupply * 86400000);
        stockoutDate = d.toISOString().slice(0, 10);
      }

      // Order-by date = stockout date - supplier lead time
      let orderByDate = null;
      if (stockoutDate) {
        const d = new Date(
          new Date(stockoutDate + "T00:00:00").getTime() - leadDays * 86400000,
        );
        // If order-by date is in the past, it's already overdue
        orderByDate = d.toISOString().slice(0, 10);
      }

      // Determine urgency
      let urgency = "ok";
      if (v.unitsPerDay === 0 && v.totalShipped === 0) {
        urgency = "no-velocity";
      } else if (p.available <= 0 || (daysOfSupply !== Infinity && daysOfSupply <= leadDays)) {
        urgency = "critical";
      } else if (p.available <= dynamicReorderPoint) {
        urgency = "warning";
      }

      const needsReorder =
        v.unitsPerDay > 0 && p.available <= dynamicReorderPoint && suggestedOrderQty > 0;

      return {
        ...p,
        velocity: v,
        supplier: sup,
        leadDays,
        daysOfSupply,
        dynamicReorderPoint,
        suggestedOrderQty,
        stockoutDate,
        orderByDate,
        incomingQty,
        pipelineDemand: pipeDemand,
        needsReorder,
        urgency,
      };
    })
    .sort((a, b) => {
      // Critical first, then warning, then ok, then no-velocity
      const order = { critical: 0, warning: 1, ok: 2, "no-velocity": 3 };
      const diff = (order[a.urgency] || 3) - (order[b.urgency] || 3);
      if (diff !== 0) return diff;
      // Within same urgency, sort by days of supply ascending
      if (a.daysOfSupply === Infinity && b.daysOfSupply === Infinity) return 0;
      if (a.daysOfSupply === Infinity) return 1;
      if (b.daysOfSupply === Infinity) return -1;
      return a.daysOfSupply - b.daysOfSupply;
    });
}

/**
 * Build a text summary of inventory/demand data suitable for sending to Claude AI.
 * Keeps it concise to minimize token usage.
 */
export function buildAISummary(metrics, suppliers, purchaseOrders) {
  const today = new Date().toISOString().slice(0, 10);
  const critical = metrics.filter((m) => m.urgency === "critical");
  const warning = metrics.filter((m) => m.urgency === "warning");
  const needsReorder = metrics.filter((m) => m.needsReorder);

  let summary = `# ACC Crappie Stix Inventory Snapshot (${today})\n\n`;
  summary += `## Summary\n`;
  summary += `- Total SKUs: ${metrics.length}\n`;
  summary += `- Critical (stockout risk): ${critical.length}\n`;
  summary += `- Warning (below reorder point): ${warning.length}\n`;
  summary += `- Need reorder: ${needsReorder.length}\n\n`;

  summary += `## Products Needing Attention\n`;
  summary += `| SKU | Name | On-Hand | Available | Velocity/mo | Days Supply | Lead Time | Dynamic ROP | Suggested Qty | Incoming PO | Stockout Date | Order By |\n`;
  summary += `|-----|------|---------|-----------|-------------|-------------|-----------|-------------|---------------|-------------|---------------|----------|\n`;

  // Show all products that need reorder or have urgency, plus top movers
  const show = metrics.filter(
    (m) => m.urgency === "critical" || m.urgency === "warning" || m.needsReorder || m.velocity.unitsPerMonth >= 1,
  );
  show.forEach((m) => {
    summary += `| ${m.sku} | ${m.name} | ${m.onHand} | ${m.available} | ${m.velocity.unitsPerMonth.toFixed(1)} | ${m.daysOfSupply === Infinity ? "N/A" : m.daysOfSupply + "d"} | ${m.leadDays}d | ${m.dynamicReorderPoint} | ${m.suggestedOrderQty} | ${m.incomingQty} | ${m.stockoutDate || "N/A"} | ${m.orderByDate || "N/A"} |\n`;
  });

  summary += `\n## Suppliers\n`;
  (suppliers || []).forEach((s) => {
    const prodCount = metrics.filter((m) => m.supplier && m.supplier.id === s.id).length;
    summary += `- ${s.name}: ${s.leadDays || "??"} day lead time, ${prodCount} products\n`;
  });

  summary += `\n## Open Purchase Orders\n`;
  const openPOs = (purchaseOrders || []).filter((po) => po.status !== "received");
  if (openPOs.length === 0) {
    summary += `- None\n`;
  } else {
    openPOs.forEach((po) => {
      const sup = (suppliers || []).find((s) => s.id === po.supplierId);
      const total = po.lines.reduce((s, l) => s + l.qty * l.cost, 0);
      summary += `- ${po.orderNum}: ${sup ? sup.name : "Unknown"} -- ${po.lines.length} items, $${total.toFixed(2)}, expected ${po.expectedDate || "TBD"}, status: ${po.status}\n`;
    });
  }

  return summary;
}
