// Empty starting state -- used as the fallback when no saved data exists.
// This prevents demo inventory from overwriting real ShipStation data
// when localStorage or Supabase is unavailable.
export const defaultData = {
  products: [],
  suppliers: [],
  salesOrders: [],
  purchaseOrders: [],
  customers: [],
  auditLog: [],
  counters: { so: 0, po: 0 },
};

// ---------------------------------------------------------------------------
// Demo data -- full sample catalog for exploring the app before connecting
// real data. Loaded via Settings > "Load Demo Data".
//
// Dates are generated relative to today so the date-aware views (Dashboard
// "Last 7 Days", Demand Planning velocity windows, Reports monthly chart)
// always have live data to show. Call makeDemoData() to get a fresh copy.
// ---------------------------------------------------------------------------

// Local date string (yyyy-mm-dd) offset from today by N days.
function d(offsetDays) {
  const t = new Date();
  t.setDate(t.getDate() + offsetDays);
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const day = String(t.getDate()).padStart(2, "0");
  return `${t.getFullYear()}-${m}-${day}`;
}

// Audit-log timestamp offset from today by N days at a given time of day.
function ts(offsetDays, time) {
  return `${d(offsetDays)}T${time}:00Z`;
}

export function makeDemoData() {
  return {
  products: [
    // -- Spinning Reels
    { id: "p-lx1bx", sku: "LX-1000-S-SLVR-BX", name: "ACC Crappie Legacy X - 1000 Size Spinning Reel (Box)", category: "Spinning Reels", costPrice: 40.67, sellPrice: 79.99, onHand: 60, reorderPoint: 12, reorderQty: 36, supplier: "s1" },
    { id: "p-lx1cl", sku: "LX-1000-S-SLVR-CLM", name: "ACC Crappie Legacy X - 1000 Size Spinning Reel (Clamshell)", category: "Spinning Reels", costPrice: 40.67, sellPrice: 79.99, onHand: 36, reorderPoint: 12, reorderQty: 36, supplier: "s1" },
    // -- Fishing Line -- DualFlex Copolymer
    { id: "p-df4clr", sku: "DF4CLR300", name: "ACC Crappie DualFlex - 4lb Clear Copolymer 300yd", category: "Fishing Line", costPrice: 4.68, sellPrice: 9.99, onHand: 200, reorderPoint: 48, reorderQty: 200, supplier: "s2" },
    { id: "p-df6clr", sku: "DF6CLR300", name: "ACC Crappie DualFlex - 6lb Clear Copolymer 300yd", category: "Fishing Line", costPrice: 4.68, sellPrice: 9.99, onHand: 200, reorderPoint: 48, reorderQty: 200, supplier: "s2" },
    { id: "p-df8clr", sku: "DF8CLR300", name: "ACC Crappie DualFlex - 8lb Clear Copolymer 300yd", category: "Fishing Line", costPrice: 4.68, sellPrice: 9.99, onHand: 200, reorderPoint: 48, reorderQty: 200, supplier: "s2" },
    { id: "p-df10clr", sku: "DF10CLR300", name: "ACC Crappie DualFlex - 10lb Clear Copolymer 300yd", category: "Fishing Line", costPrice: 4.68, sellPrice: 9.99, onHand: 200, reorderPoint: 48, reorderQty: 200, supplier: "s2" },
    { id: "p-df4hv", sku: "DF4CTHV300", name: "ACC Crappie DualFlex - 4lb Hi-Vis Copolymer 300yd", category: "Fishing Line", costPrice: 4.68, sellPrice: 9.99, onHand: 200, reorderPoint: 48, reorderQty: 200, supplier: "s2" },
    { id: "p-df6hv", sku: "DF6CTHV300", name: "ACC Crappie DualFlex - 6lb Hi-Vis Copolymer 300yd", category: "Fishing Line", costPrice: 4.68, sellPrice: 9.99, onHand: 200, reorderPoint: 48, reorderQty: 200, supplier: "s2" },
    { id: "p-df8hv", sku: "DF8CTHV300", name: "ACC Crappie DualFlex - 8lb Hi-Vis Copolymer 300yd", category: "Fishing Line", costPrice: 4.68, sellPrice: 9.99, onHand: 200, reorderPoint: 48, reorderQty: 200, supplier: "s2" },
    { id: "p-df10hv", sku: "DF10CTHV300", name: "ACC Crappie DualFlex - 10lb Hi-Vis Copolymer 300yd", category: "Fishing Line", costPrice: 4.68, sellPrice: 9.99, onHand: 200, reorderPoint: 48, reorderQty: 200, supplier: "s2" },
    // -- Fishing Line -- SmoothX Braid
    { id: "p-sx8", sku: "SX8YHV300", name: "ACC Crappie SmoothX - 8lb Braided Line 300yd", category: "Fishing Line", costPrice: 14.04, sellPrice: 29.99, onHand: 80, reorderPoint: 20, reorderQty: 80, supplier: "s2" },
    { id: "p-sx10", sku: "SX10YHV300", name: "ACC Crappie SmoothX - 10lb Braided Line 300yd", category: "Fishing Line", costPrice: 14.04, sellPrice: 29.99, onHand: 80, reorderPoint: 20, reorderQty: 80, supplier: "s2" },
    { id: "p-sx15", sku: "SX15YHV300", name: "ACC Crappie SmoothX - 15lb Braided Line 300yd", category: "Fishing Line", costPrice: 14.04, sellPrice: 29.99, onHand: 80, reorderPoint: 20, reorderQty: 80, supplier: "s2" },
    { id: "p-sx20", sku: "SX20YHV300", name: "ACC Crappie SmoothX - 20lb Braided Line 300yd", category: "Fishing Line", costPrice: 14.04, sellPrice: 29.99, onHand: 80, reorderPoint: 20, reorderQty: 80, supplier: "s2" },
    // -- Spinnin' Stix
    { id: "p-sps51", sku: "SPS-51S-MF-C", name: "ACC Crappie Spinnin' Stix - 5' 1pc Med Fast Spinning", category: "Spinnin' Stix", costPrice: 41.58, sellPrice: 89.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps561", sku: "SPS-561S-MF-C", name: 'ACC Crappie Spinnin\' Stix - 5\'6" 1pc Med Fast Spinning', category: "Spinnin' Stix", costPrice: 41.58, sellPrice: 89.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps62", sku: "SPS-62S-MF-C", name: "ACC Crappie Spinnin' Stix - 6' 2pc Med Fast Spinning", category: "Spinnin' Stix", costPrice: 41.58, sellPrice: 89.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps662", sku: "SPS-662S-MF-C", name: 'ACC Crappie Spinnin\' Stix - 6\'6" 2pc Med Fast Spinning', category: "Spinnin' Stix", costPrice: 41.58, sellPrice: 89.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps61", sku: "SPS-61S-MF-C", name: "ACC Crappie Spinnin' Stix - 6' 1pc Med Fast Spinning", category: "Spinnin' Stix", costPrice: 41.58, sellPrice: 89.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps661", sku: "SPS-661S-MF-C", name: 'ACC Crappie Spinnin\' Stix - 6\'6" 1pc Med Fast Spinning', category: "Spinnin' Stix", costPrice: 41.58, sellPrice: 89.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps71", sku: "SPS-71S-LM-C", name: "ACC Crappie Spinnin' Stix - 7' 1pc Lt Moderate Spinning", category: "Spinnin' Stix", costPrice: 46.20, sellPrice: 99.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps762", sku: "SPS-762S-MF-C", name: 'ACC Crappie Spinnin\' Stix - 7\'6" 2pc Med Fast Spinning', category: "Spinnin' Stix", costPrice: 46.20, sellPrice: 99.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps82", sku: "SPS-82S-MF-C", name: "ACC Crappie Spinnin' Stix - 8' 2pc Med Fast Spinning", category: "Spinnin' Stix", costPrice: 46.20, sellPrice: 99.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps82sg", sku: "SPS-82S-MF-SPG", name: "ACC Crappie Spinnin' Stix Super Grip - 8' 2pc Med Fast", category: "Spinnin' Stix", costPrice: 50.82, sellPrice: 109.99, onHand: 36, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    // -- Jiggin' Stix
    { id: "p-js102", sku: "JS-102-M-MS-C", name: "ACC Crappie Jiggin' Stix - 10' 2pc Med Fast Spinning", category: "Jiggin' Stix", costPrice: 46.20, sellPrice: 99.99, onHand: 36, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    { id: "p-js102sg", sku: "JS-102-M-MS-SPG", name: "ACC Crappie Jiggin' Stix Super Grip - 10' 2pc Med Fast", category: "Jiggin' Stix", costPrice: 50.82, sellPrice: 109.99, onHand: 36, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    { id: "p-js112", sku: "JS-112-M-MS-C", name: "ACC Crappie Jiggin' Stix - 11' 2pc Med Fast Spinning", category: "Jiggin' Stix", costPrice: 46.20, sellPrice: 99.99, onHand: 36, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    { id: "p-js112sg", sku: "JS-112-M-MS-SPG", name: "ACC Crappie Jiggin' Stix Super Grip - 11' 2pc Med Fast", category: "Jiggin' Stix", costPrice: 50.82, sellPrice: 109.99, onHand: 36, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    { id: "p-js122", sku: "JS-122-M-MS-C", name: "ACC Crappie Jiggin' Stix - 12' 2pc Med Fast Spinning", category: "Jiggin' Stix", costPrice: 53.13, sellPrice: 114.99, onHand: 36, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    { id: "p-js122sg", sku: "JS-122-M-MS-SPG", name: "ACC Crappie Jiggin' Stix Super Grip - 12' 2pc Med Fast", category: "Jiggin' Stix", costPrice: 57.75, sellPrice: 124.99, onHand: 0, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    { id: "p-js132", sku: "JS-132-M-MS-C", name: "ACC Crappie Jiggin' Stix - 13' 2pc Med Fast Spinning", category: "Jiggin' Stix", costPrice: 53.13, sellPrice: 114.99, onHand: 36, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    { id: "p-js132sg", sku: "JS-132-M-MS-SPG", name: "ACC Crappie Jiggin' Stix Super Grip - 13' 2pc Med Fast", category: "Jiggin' Stix", costPrice: 57.75, sellPrice: 124.99, onHand: 36, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    // -- Scopin' / Riggin' Stix
    { id: "p-scs15", sku: "SCS-153-M-MS-C", name: "ACC Crappie Scopin' Stix - 15' 3pc Med Fast Spinning", category: "Scopin' Stix", costPrice: 73.92, sellPrice: 159.99, onHand: 18, reorderPoint: 6, reorderQty: 18, supplier: "s1" },
    { id: "p-rs14", sku: "RS-143-M-EVA", name: "ACC Crappie Riggin' Stix - 14' 3pc Med Moderate Spinning", category: "Riggin' Stix", costPrice: 41.58, sellPrice: 89.99, onHand: 18, reorderPoint: 6, reorderQty: 18, supplier: "s1" },
    { id: "p-rs16", sku: "RS-163-M-EVA", name: "ACC Crappie Riggin' Stix - 16' 3pc Med Moderate Spinning", category: "Riggin' Stix", costPrice: 46.20, sellPrice: 99.99, onHand: 18, reorderPoint: 6, reorderQty: 18, supplier: "s1" },
    // -- Kids / Trout
    { id: "p-ks52", sku: "KS-52SC-L-EVA-CMB", name: "ACC Crappie Kids Stix - 5' 2pc Spin Cast Combo", category: "Kids Stix", costPrice: 16.17, sellPrice: 34.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-tps60", sku: "TPS-601S-LF-C", name: "ACC Trout/Panfishin' Stix - 6' 1pc Lt Fast Spinning", category: "Trout/Panfish Stix", costPrice: 53.13, sellPrice: 114.99, onHand: 18, reorderPoint: 6, reorderQty: 18, supplier: "s1" },
    { id: "p-tps66", sku: "TPS-661S-LF-C", name: 'ACC Trout/Panfishin\' Stix - 6\'6" 1pc Lt Fast Spinning', category: "Trout/Panfish Stix", costPrice: 53.13, sellPrice: 114.99, onHand: 18, reorderPoint: 6, reorderQty: 18, supplier: "s1" },
    { id: "p-tps70", sku: "TPS-701S-LF-C", name: "ACC Trout/Panfishin' Stix - 7' 1pc Lt Fast Spinning", category: "Trout/Panfish Stix", costPrice: 53.13, sellPrice: 114.99, onHand: 18, reorderPoint: 6, reorderQty: 18, supplier: "s1" },
    // -- Big Eye Jig Heads
    { id: "p-jh132blck", sku: "JH-132-8-BLCK", name: "ACC Big Eye Jig Heads - 1/32oz Black (8pk)", category: "Jig Heads", costPrice: 2.80, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh132blue", sku: "JH-132-8-BLUE", name: "ACC Big Eye Jig Heads - 1/32oz Blue (8pk)", category: "Jig Heads", costPrice: 2.80, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh132chrt", sku: "JH-132-8-CHRT", name: "ACC Big Eye Jig Heads - 1/32oz Chartreuse (8pk)", category: "Jig Heads", costPrice: 2.80, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh116blck", sku: "JH-116-8-BLCK", name: "ACC Big Eye Jig Heads - 1/16oz Black (8pk)", category: "Jig Heads", costPrice: 2.80, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh116blue", sku: "JH-116-8-BLUE", name: "ACC Big Eye Jig Heads - 1/16oz Blue (8pk)", category: "Jig Heads", costPrice: 2.80, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh116chrt", sku: "JH-116-8-CHRT", name: "ACC Big Eye Jig Heads - 1/16oz Chartreuse (8pk)", category: "Jig Heads", costPrice: 2.80, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh18blck", sku: "JH-18-8-BLCK", name: "ACC Big Eye Jig Heads - 1/8oz Black (8pk)", category: "Jig Heads", costPrice: 2.80, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh18blue", sku: "JH-18-8-BLUE", name: "ACC Big Eye Jig Heads - 1/8oz Blue (8pk)", category: "Jig Heads", costPrice: 2.80, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh18chrt", sku: "JH-18-8-CHRT", name: "ACC Big Eye Jig Heads - 1/8oz Chartreuse (8pk)", category: "Jig Heads", costPrice: 2.80, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
  ],
  suppliers: [
    { id: "s1", name: "Far East Rods Co.", contact: "David Lin", email: "david@ferods.com", phone: "555-8801", leadDays: 45 },
    { id: "s2", name: "Tackle Components Inc.", contact: "Mike Russo", email: "mike@tackleci.com", phone: "555-8802", leadDays: 21 },
    { id: "s3", name: "Pokee Fishing Tackle Co., Ltd.", contact: "", email: "", phone: "", leadDays: 60 },
    { id: "s4", name: "Fishing Capital Company Limited", contact: "", email: "", phone: "", leadDays: 45 },
    { id: "s5", name: "Tech Angler Company Limited", contact: "", email: "", phone: "", leadDays: 45 },
  ],
  salesOrders: [
    {
      id: "so1", orderNum: "SO-0001", customer: "Tackle Warehouse", date: d(-25),
      fulfillmentStage: "shipped", type: "standard", dealerPORef: "TW-2026-0011",
      lines: [
        { productId: "p-js102", qty: 12, price: 99.99, qtyFilled: 12, qtyBackordered: 0 },
        { productId: "p-js102sg", qty: 12, price: 109.99, qtyFilled: 12, qtyBackordered: 0 },
        { productId: "p-js112", qty: 12, price: 99.99, qtyFilled: 12, qtyBackordered: 0 },
        { productId: "p-df4clr", qty: 48, price: 9.99, qtyFilled: 48, qtyBackordered: 0 },
        { productId: "p-df4hv", qty: 48, price: 9.99, qtyFilled: 48, qtyBackordered: 0 },
      ],
      shipment: { carrier: "UPS", trackingNum: "1Z999AA10123456780", shipDate: d(-22) },
      notes: "",
    },
    {
      id: "so2", orderNum: "SO-0002", customer: "Bass Pro Shops", date: d(-14),
      fulfillmentStage: "picked", type: "standard", dealerPORef: "BPS-55021",
      lines: [
        { productId: "p-lx1bx", qty: 24, price: 79.99, qtyFilled: 24, qtyBackordered: 0 },
        { productId: "p-lx1cl", qty: 24, price: 79.99, qtyFilled: 24, qtyBackordered: 0 },
        { productId: "p-sps82sg", qty: 18, price: 109.99, qtyFilled: 18, qtyBackordered: 0 },
      ],
      shipment: {}, notes: "Staged in bay 2",
    },
    {
      id: "so3", orderNum: "SO-0003", customer: "Academy Sports", date: d(-8),
      fulfillmentStage: "booked", type: "standard", dealerPORef: "ACS-91002",
      lines: [
        { productId: "p-js122", qty: 12, price: 114.99, qtyFilled: 12, qtyBackordered: 0 },
        { productId: "p-js132", qty: 12, price: 114.99, qtyFilled: 12, qtyBackordered: 0 },
        { productId: "p-js132sg", qty: 6, price: 124.99, qtyFilled: 6, qtyBackordered: 0 },
        { productId: "p-sx8", qty: 24, price: 29.99, qtyFilled: 24, qtyBackordered: 0 },
      ],
      shipment: { carrier: "FedEx", trackingNum: "", shipDate: d(2) },
      notes: "",
    },
    {
      id: "so4", orderNum: "SO-0004", customer: "Fisherman's Corner", date: d(-5),
      fulfillmentStage: "confirmed", type: "preorder", dealerPORef: "FSC-2026-007",
      lines: [
        { productId: "p-js112sg", qty: 6, price: 109.99, qtyFilled: 0, qtyBackordered: 6 },
        { productId: "p-js122sg", qty: 6, price: 124.99, qtyFilled: 0, qtyBackordered: 6 },
      ],
      shipment: {}, notes: "Awaiting Super Grip restock -- tied to PO-0001",
    },
    {
      id: "so5", orderNum: "SO-0005",
      customer: "A-1 Bait and Tackle Co.", date: d(-2),
      fulfillmentStage: "confirmed", type: "distributor",
      dealerPORef: "GW2426",
      notes: "Buyer: Gracie Watson | a-1bait75662@gmail.com | Ship To: 1114 Southport Road, Kilgore, TX 75662",
      lines: [
        { productId: "p-lx1bx", qty: 10, price: 79.99, qtyFilled: 10, qtyBackordered: 0 },
        { productId: "p-lx1cl", qty: 5, price: 79.99, qtyFilled: 5, qtyBackordered: 0 },
        { productId: "p-df4clr", qty: 20, price: 9.99, qtyFilled: 20, qtyBackordered: 0 },
        { productId: "p-df6clr", qty: 20, price: 9.99, qtyFilled: 20, qtyBackordered: 0 },
        { productId: "p-df8clr", qty: 20, price: 9.99, qtyFilled: 20, qtyBackordered: 0 },
        { productId: "p-df10clr", qty: 20, price: 9.99, qtyFilled: 20, qtyBackordered: 0 },
        { productId: "p-df4hv", qty: 20, price: 9.99, qtyFilled: 20, qtyBackordered: 0 },
        { productId: "p-df6hv", qty: 20, price: 9.99, qtyFilled: 20, qtyBackordered: 0 },
        { productId: "p-df8hv", qty: 20, price: 9.99, qtyFilled: 20, qtyBackordered: 0 },
        { productId: "p-df10hv", qty: 20, price: 9.99, qtyFilled: 20, qtyBackordered: 0 },
        { productId: "p-sps82sg", qty: 12, price: 109.99, qtyFilled: 12, qtyBackordered: 0 },
        { productId: "p-js102", qty: 6, price: 99.99, qtyFilled: 6, qtyBackordered: 0 },
        { productId: "p-js102sg", qty: 6, price: 109.99, qtyFilled: 6, qtyBackordered: 0 },
        { productId: "p-js112", qty: 6, price: 99.99, qtyFilled: 6, qtyBackordered: 0 },
        { productId: "p-js112sg", qty: 6, price: 109.99, qtyFilled: 6, qtyBackordered: 0 },
        { productId: "p-js122", qty: 6, price: 114.99, qtyFilled: 6, qtyBackordered: 0 },
        { productId: "p-js132", qty: 6, price: 114.99, qtyFilled: 6, qtyBackordered: 0 },
        { productId: "p-js132sg", qty: 6, price: 124.99, qtyFilled: 6, qtyBackordered: 0 },
      ],
      shipment: {},
    },
  ],
  purchaseOrders: [
    {
      id: "po1", orderNum: "PO-0001", supplierId: "s1", date: d(-10),
      expectedDate: d(35), status: "ordered",
      lines: [
        { productId: "p-js112sg", qty: 36, cost: 50.82 },
        { productId: "p-js122sg", qty: 72, cost: 57.75 },
        { productId: "p-js132sg", qty: 36, cost: 57.75 },
        { productId: "p-scs15", qty: 36, cost: 73.92 },
      ],
      notes: "Super Grip restock -- addresses backorders on SO-0004",
    },
  ],
  customers: [
    { id: "c1", name: "A-1 Bait and Tackle Co.", type: "distributor", email: "a-1bait75662@gmail.com", phone: "", address: "1114 Southport Road, Kilgore, TX 75662" },
    { id: "c2", name: "Bass Pro Shops", type: "retailer", email: "buying@basspro.com", phone: "417-873-5000", address: "Springfield, MO" },
    { id: "c3", name: "Tackle Warehouse", type: "distributor", email: "po@tacklewarehouse.com", phone: "805-466-4493", address: "Atascadero, CA" },
    { id: "c4", name: "Academy Sports", type: "retailer", email: "buying@academy.com", phone: "281-646-5200", address: "Katy, TX" },
    { id: "c5", name: "Fisherman's Corner", type: "dealer", email: "orders@fscorner.com", phone: "555-2201", address: "Memphis, TN" },
  ],
  auditLog: [
    { id: "a1", ts: ts(-25, "08:30"), type: "dealer-import", entity: "SO-0001", description: "Imported TW-2026-0011 from Tackle Warehouse -- 36 Jiggin' Stix, 96 DualFlex Line" },
    { id: "a2", ts: ts(-22, "13:00"), type: "shipped-log", entity: "SO-0001", description: "Shipped SO-0001 -> Tackle Warehouse * UPS 1Z999AA10123456780" },
    { id: "a3", ts: ts(-14, "09:15"), type: "dealer-import", entity: "SO-0002", description: "Imported BPS-55021 from Bass Pro Shops -- Legacy X Reels x48, Super Grip Spinnin' Stix x18" },
    { id: "a4", ts: ts(-11, "10:00"), type: "stage-advance", entity: "SO-0002", description: "SO-0002 advanced to Picked & Packed -- Bass Pro Shops" },
    { id: "a5", ts: ts(-8, "14:20"), type: "dealer-import", entity: "SO-0003", description: "Imported ACS-91002 from Academy Sports -- Jiggin' Stix x30, SmoothX Braid x24" },
    { id: "a6", ts: ts(-6, "09:45"), type: "stage-advance", entity: "SO-0003", description: "SO-0003 advanced to Shipment Booked -- Academy Sports * FedEx" },
    { id: "a7", ts: ts(-5, "11:30"), type: "dealer-import", entity: "SO-0004", description: "Imported FSC-2026-007 from Fisherman's Corner -- 12 units on backorder (Super Grip)" },
    { id: "a8", ts: ts(-2, "09:12"), type: "dealer-import", entity: "SO-0005", description: "Imported PO GW2426 from A-1 Bait and Tackle Co. -- 18 lines * 229 units * $8,767.71 * Buyer: Gracie Watson" },
  ],
  counters: { so: 5, po: 1 },
  };
}
