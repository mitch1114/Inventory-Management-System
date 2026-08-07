// --- Freight billing rules ------------------------------------------------------
// Who pays shipping on an order:
//   Dealers:       merchandise under $1,000 -> customer pays freight;
//                  $1,000 and over -> ACC pays (freight is NOT billed).
//   Distributors:  merchandise under $4,000 -> customer pays freight;
//                  $4,000 and over -> ACC pays.
// The raw ShipStation label cost always stays on the order for reporting --
// these rules only decide whether it becomes an invoice line in QuickBooks.
export const FREIGHT_THRESHOLDS = { dealer: 1000, distributor: 4000 };

// Merchandise value basis: what actually shipped (filled qty x price)
export const orderFilledValue = (o) =>
  (o.lines || []).reduce(
    (s, l) => s + (l.qtyFilled != null ? l.qtyFilled : l.qty) * (l.price || 0),
    0,
  );

export const isDistributorOrder = (o) =>
  o.channel === "distributor" || o.type === "distributor";

export const freightThreshold = (o) =>
  isDistributorOrder(o) ? FREIGHT_THRESHOLDS.distributor : FREIGHT_THRESHOLDS.dealer;

/**
 * Freight amount to bill the customer: the order's shipping cost when the
 * merchandise value is under the channel threshold, 0 when ACC pays.
 */
export function billableFreight(o) {
  const cost = o.shipment && o.shipment.shippingCost;
  if (!cost || cost <= 0) return 0;
  return orderFilledValue(o) < freightThreshold(o) ? cost : 0;
}
