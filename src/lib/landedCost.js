// --- Landed cost engine ---------------------------------------------------------
// Landed cost = supplier unit cost + an allocated share of the extra costs of
// getting goods to the warehouse (freight, duties/tariffs, customs & brokerage,
// insurance, other fees). Costs are entered at receiving time (when the freight
// bill and duty amounts are actually known) and allocated across the units
// received in that session.

export const LANDED_COST_TYPES = [
  { value: "freight", label: "Freight" },
  { value: "duty", label: "Duty / Tariffs" },
  { value: "customs", label: "Customs / Brokerage" },
  { value: "insurance", label: "Insurance" },
  { value: "other", label: "Other Fees" },
];

// Allocate landed cost entries across received lines.
//   receivedLines: [{ productId, qty, unitCost }]  (qty = units received now)
//   costs:         [{ type, amount, basis }]        basis: "value" | "units"
// Returns { perUnitExtra: {productId: $}, landedUnitCost: {productId: $},
//           totalExtra, totalValue, totalUnits }
export function allocateLandedCosts(receivedLines, costs) {
  const lines = (receivedLines || []).filter((l) => l.qty > 0);
  const totalUnits = lines.reduce((s, l) => s + l.qty, 0);
  const totalValue = lines.reduce((s, l) => s + l.qty * (l.unitCost || 0), 0);
  const extra = {}; // productId -> allocated $ total

  (costs || []).forEach((c) => {
    const amount = parseFloat(c.amount) || 0;
    if (amount <= 0) return;
    lines.forEach((l) => {
      let share = 0;
      if (c.basis === "units") {
        share = totalUnits > 0 ? (l.qty / totalUnits) * amount : 0;
      } else {
        // default: allocate proportionally to line value (standard for duty,
        // reasonable default for freight)
        share =
          totalValue > 0
            ? ((l.qty * (l.unitCost || 0)) / totalValue) * amount
            : totalUnits > 0
              ? (l.qty / totalUnits) * amount
              : 0;
      }
      extra[l.productId] = (extra[l.productId] || 0) + share;
    });
  });

  const perUnitExtra = {};
  const landedUnitCost = {};
  lines.forEach((l) => {
    const per = l.qty > 0 ? (extra[l.productId] || 0) / l.qty : 0;
    perUnitExtra[l.productId] = round2(per);
    landedUnitCost[l.productId] = round2((l.unitCost || 0) + per);
  });

  const totalExtra = (costs || []).reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
  return { perUnitExtra, landedUnitCost, totalExtra: round2(totalExtra), totalValue, totalUnits };
}

// Blend a new receipt into a product's running landed cost using a weighted
// moving average over the units already on hand.
//   prevOnHand: units on hand BEFORE this receipt
//   prevLanded: product's current landed cost (falls back to costPrice)
export function blendLandedCost(prevOnHand, prevLanded, receivedQty, receiptLandedUnit) {
  const base = prevLanded > 0 ? prevLanded : 0;
  if (receivedQty <= 0) return base;
  if (prevOnHand <= 0 || base <= 0) return round2(receiptLandedUnit);
  return round2(
    (prevOnHand * base + receivedQty * receiptLandedUnit) / (prevOnHand + receivedQty),
  );
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
