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
  // Full 2026 ACC product catalog (extracted from the 2026 order writer),
  // including UPCs. Existing demo ids/stock levels are preserved.
  products: [
    // -- Spinning Reels
    { id: "p-lx1bx", sku: "LX-1000-S-SLVR-BX", upc: "850056326933", name: "ACC Crappie Legacy X - 1000 Size Spinning Reel (Box)", category: "Spinning Reels", costPrice: 40.67, sellPrice: 79.99, onHand: 60, reorderPoint: 12, reorderQty: 36, supplier: "s1" },
    { id: "p-lx1cl", sku: "LX-1000-S-SLVR-CLM", upc: "850056326933", name: "ACC Crappie Legacy X - 1000 Size Spinning Reel (Clamshell)", category: "Spinning Reels", costPrice: 40.67, sellPrice: 79.99, onHand: 36, reorderPoint: 12, reorderQty: 36, supplier: "s1" },
    // -- Fishing Line
    { id: "p-df4clr", sku: "DF4CLR300", upc: "850056326827", name: "ACC Crappie DualFlex - 4lb Clear Copolymer 300yd", category: "Fishing Line", costPrice: 4.68, sellPrice: 9.99, onHand: 200, reorderPoint: 48, reorderQty: 200, supplier: "s2" },
    { id: "p-df6clr", sku: "DF6CLR300", upc: "850056326834", name: "ACC Crappie DualFlex - 6lb Clear Copolymer 300yd", category: "Fishing Line", costPrice: 4.68, sellPrice: 9.99, onHand: 200, reorderPoint: 48, reorderQty: 200, supplier: "s2" },
    { id: "p-df8clr", sku: "DF8CLR300", upc: "850056326841", name: "ACC Crappie DualFlex - 8lb Clear Copolymer 300yd", category: "Fishing Line", costPrice: 4.68, sellPrice: 9.99, onHand: 200, reorderPoint: 48, reorderQty: 200, supplier: "s2" },
    { id: "p-df10clr", sku: "DF10CLR300", upc: "850056326858", name: "ACC Crappie DualFlex - 10lb Clear Copolymer 300yd", category: "Fishing Line", costPrice: 4.68, sellPrice: 9.99, onHand: 200, reorderPoint: 48, reorderQty: 200, supplier: "s2" },
    { id: "p-df4hv", sku: "DF4CTHV300", upc: "850056326001", name: "ACC Crappie DualFlex - 4lb Hi-Vis Copolymer 300yd", category: "Fishing Line", costPrice: 4.68, sellPrice: 9.99, onHand: 200, reorderPoint: 48, reorderQty: 200, supplier: "s2" },
    { id: "p-df6hv", sku: "DF6CTHV300", upc: "850056326018", name: "ACC Crappie DualFlex - 6lb Hi-Vis Copolymer 300yd", category: "Fishing Line", costPrice: 4.68, sellPrice: 9.99, onHand: 200, reorderPoint: 48, reorderQty: 200, supplier: "s2" },
    { id: "p-df8hv", sku: "DF8CTHV300", upc: "850056326025", name: "ACC Crappie DualFlex - 8lb Hi-Vis Copolymer 300yd", category: "Fishing Line", costPrice: 4.68, sellPrice: 9.99, onHand: 200, reorderPoint: 48, reorderQty: 200, supplier: "s2" },
    { id: "p-df10hv", sku: "DF10CTHV300", upc: "850056326032", name: "ACC Crappie DualFlex - 10lb Hi-Vis Copolymer 300yd", category: "Fishing Line", costPrice: 4.68, sellPrice: 9.99, onHand: 200, reorderPoint: 48, reorderQty: 200, supplier: "s2" },
    { id: "p-sx8", sku: "SX8YHV300", upc: "850056326872", name: "ACC Crappie SmoothX - 8lb Braided Line 300yd", category: "Fishing Line", costPrice: 14.04, sellPrice: 29.99, onHand: 80, reorderPoint: 20, reorderQty: 80, supplier: "s2" },
    { id: "p-sx10", sku: "SX10YHV300", upc: "850056326049", name: "ACC Crappie SmoothX - 10lb Braided Line 300yd", category: "Fishing Line", costPrice: 14.04, sellPrice: 29.99, onHand: 80, reorderPoint: 20, reorderQty: 80, supplier: "s2" },
    { id: "p-sx15", sku: "SX15YHV300", upc: "850056326056", name: "ACC Crappie SmoothX - 15lb Braided Line 300yd", category: "Fishing Line", costPrice: 14.04, sellPrice: 29.99, onHand: 80, reorderPoint: 20, reorderQty: 80, supplier: "s2" },
    { id: "p-sx20", sku: "SX20YHV300", upc: "850056326063", name: "ACC Crappie SmoothX - 20lb Braided Line 300yd", category: "Fishing Line", costPrice: 14.04, sellPrice: 29.99, onHand: 80, reorderPoint: 20, reorderQty: 80, supplier: "s2" },
    // -- Kids Stix
    { id: "p-ks52", sku: "KS-52SC-L-EVA-CMB", upc: "850056326865", name: "ACC Crappie Kids Stix - 5' 2pc Spin Cast Combo", category: "Kids Stix", costPrice: 16.17, sellPrice: 34.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    // -- Trout/Panfish Stix
    { id: "p-tps60", sku: "TPS-601S-LF-C", upc: "850056326902", name: "ACC Trout/Panfishin' Stix - 6' 1pc Lt Fast Spinning", category: "Trout/Panfish Stix", costPrice: 53.13, sellPrice: 114.99, onHand: 18, reorderPoint: 6, reorderQty: 18, supplier: "s1" },
    { id: "p-tps66", sku: "TPS-661S-LF-C", upc: "850056326919", name: "ACC Trout/Panfishin' Stix - 6'6\" 1pc Lt Fast Spinning", category: "Trout/Panfish Stix", costPrice: 53.13, sellPrice: 114.99, onHand: 18, reorderPoint: 6, reorderQty: 18, supplier: "s1" },
    { id: "p-tps70", sku: "TPS-701S-LF-C", upc: "850056326926", name: "ACC Trout/Panfishin' Stix - 7' 1pc Lt Fast Spinning", category: "Trout/Panfish Stix", costPrice: 53.13, sellPrice: 114.99, onHand: 18, reorderPoint: 6, reorderQty: 18, supplier: "s1" },
    // -- Spinnin' Stix
    { id: "p-sps51", sku: "SPS-51S-MF-C", upc: "850056326940", name: "ACC Crappie Spinnin' Stix - 5' 1pc Med Fast Spinning", category: "Spinnin' Stix", costPrice: 41.58, sellPrice: 89.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps561", sku: "SPS-561S-MF-C", upc: "850056326957", name: "ACC Crappie Spinnin' Stix - 5'6\" 1pc Med Fast Spinning", category: "Spinnin' Stix", costPrice: 41.58, sellPrice: 89.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps62", sku: "SPS-62S-MF-C", upc: "850056326964", name: "ACC Crappie Spinnin' Stix - 6' 2pc Med Fast Spinning", category: "Spinnin' Stix", costPrice: 41.58, sellPrice: 89.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps662", sku: "SPS-662S-MF-C", upc: "850056326971", name: "ACC Crappie Spinnin' Stix - 6'6\" 2pc Med Fast Spinning", category: "Spinnin' Stix", costPrice: 41.58, sellPrice: 89.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps61", sku: "SPS-61S-MF-C", upc: "850056326117", name: "ACC Crappie Spinnin' Stix - 6' 1pc Med Fast Spinning", category: "Spinnin' Stix", costPrice: 41.58, sellPrice: 89.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps661", sku: "SPS-661S-MF-C", upc: "850056326315", name: "ACC Crappie Spinnin' Stix - 6'6\" 1pc Med Fast Spinning", category: "Spinnin' Stix", costPrice: 41.58, sellPrice: 89.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps71", sku: "SPS-71S-LM-C", upc: "850056326988", name: "ACC Crappie Spinnin' Stix - 7' 1pc Lt Moderate Spinning", category: "Spinnin' Stix", costPrice: 46.2, sellPrice: 99.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps762", sku: "SPS-762S-MF-C", upc: "850056326995", name: "ACC Crappie Spinnin' Stix - 7'6\" 2pc Med Fast Spinning", category: "Spinnin' Stix", costPrice: 46.2, sellPrice: 99.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps82", sku: "SPS-82S-MF-C", upc: "850056326148", name: "ACC Crappie Spinnin' Stix - 8' 2pc Med Fast Spinning", category: "Spinnin' Stix", costPrice: 46.2, sellPrice: 99.99, onHand: 30, reorderPoint: 9, reorderQty: 30, supplier: "s1" },
    { id: "p-sps82sg", sku: "SPS-82S-MF-SPG", upc: "850056326247", name: "ACC Crappie Spinnin' Stix Super Grip - 8' 2pc Med Fast", category: "Spinnin' Stix", costPrice: 50.82, sellPrice: 109.99, onHand: 36, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    // -- Jiggin' Stix
    { id: "p-js102", sku: "JS-102-M-MS-C", upc: "850056326155", name: "ACC Crappie Jiggin' Stix - 10' 2pc Med Fast Spinning", category: "Jiggin' Stix", costPrice: 46.2, sellPrice: 99.99, onHand: 36, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    { id: "p-js102sg", sku: "JS-102-M-MS-SPG", upc: "850056326254", name: "ACC Crappie Jiggin' Stix Super Grip - 10' 2pc Med Fast", category: "Jiggin' Stix", costPrice: 50.82, sellPrice: 109.99, onHand: 36, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    { id: "p-js112", sku: "JS-112-M-MS-C", upc: "850056326179", name: "ACC Crappie Jiggin' Stix - 11' 2pc Med Fast Spinning", category: "Jiggin' Stix", costPrice: 46.2, sellPrice: 99.99, onHand: 36, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    { id: "p-js112sg", sku: "JS-112-M-MS-SPG", upc: "850056326278", name: "ACC Crappie Jiggin' Stix Super Grip - 11' 2pc Med Fast", category: "Jiggin' Stix", costPrice: 50.82, sellPrice: 109.99, onHand: 36, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    { id: "p-js122", sku: "JS-122-M-MS-C", upc: "850056326193", name: "ACC Crappie Jiggin' Stix - 12' 2pc Med Fast Spinning", category: "Jiggin' Stix", costPrice: 53.13, sellPrice: 114.99, onHand: 36, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    { id: "p-js122sg", sku: "JS-122-M-MS-SPG", upc: "850056326889", name: "ACC Crappie Jiggin' Stix Super Grip - 12' 2pc Med Fast", category: "Jiggin' Stix", costPrice: 57.75, sellPrice: 124.99, onHand: 0, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    { id: "p-js132", sku: "JS-132-M-MS-C", upc: "850056326209", name: "ACC Crappie Jiggin' Stix - 13' 2pc Med Fast Spinning", category: "Jiggin' Stix", costPrice: 53.13, sellPrice: 114.99, onHand: 36, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    { id: "p-js132sg", sku: "JS-132-M-MS-SPG", upc: "850056326896", name: "ACC Crappie Jiggin' Stix Super Grip - 13' 2pc Med Fast", category: "Jiggin' Stix", costPrice: 57.75, sellPrice: 124.99, onHand: 36, reorderPoint: 9, reorderQty: 36, supplier: "s1" },
    // -- Scopin' Stix
    { id: "p-scs15", sku: "SCS-153-M-MS-C", upc: "850056326773", name: "ACC Crappie Scopin' Stix - 15' 3pc Med Fast Spinning", category: "Scopin' Stix", costPrice: 73.92, sellPrice: 159.99, onHand: 18, reorderPoint: 6, reorderQty: 18, supplier: "s1" },
    // -- Riggin' Stix
    { id: "p-rs14", sku: "RS-143-M-EVA", upc: "850056326216", name: "ACC Crappie Riggin' Stix - 14' 3pc Med Moderate Spinning", category: "Riggin' Stix", costPrice: 41.58, sellPrice: 89.99, onHand: 18, reorderPoint: 6, reorderQty: 18, supplier: "s1" },
    { id: "p-rs16", sku: "RS-163-M-EVA", upc: "850056326223", name: "ACC Crappie Riggin' Stix - 16' 3pc Med Moderate Spinning", category: "Riggin' Stix", costPrice: 46.2, sellPrice: 99.99, onHand: 18, reorderPoint: 6, reorderQty: 18, supplier: "s1" },
    // -- Jig Heads
    { id: "p-jh132blck", sku: "JH-132-8-BLCK", upc: "850056326421", name: "ACC Big Eye Jig Heads - 1/32oz Black (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh132blue", sku: "JH-132-8-BLUE", upc: "850056326384", name: "ACC Big Eye Jig Heads - 1/32oz Blue (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh132chrt", sku: "JH-132-8-CHRT", upc: "850056326506", name: "ACC Big Eye Jig Heads - 1/32oz Chartreuse (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1328gren", sku: "JH-132-8-GREN", upc: "850056326582", name: "ACC Crappie Big Eye Jig Heads - 1/32oz Green (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1328orag", sku: "JH-132-8-ORAG", upc: "850056326469", name: "ACC Crappie Big Eye Jig Heads - 1/32oz Orange (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1328pink", sku: "JH-132-8-PINK", upc: "850056326544", name: "ACC Crappie Big Eye Jig Heads - 1/32oz Pink (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh132whte", sku: "JH-132-8-WHTE", upc: "850056326629", name: "ACC Big Eye Jig Heads - 1/32oz White (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1328slvr", sku: "JH-132-8-SLVR", upc: "850058548289", name: "ACC Crappie Big Eye Jig Heads - 1/32oz Silver (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1328gld", sku: "JH-132-8-GLD", upc: "850058548296", name: "ACC Crappie Big Eye Jig Heads - 1/32oz Gold (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1248blck", sku: "JH-124-8-BLCK", upc: "850058548302", name: "ACC Crappie Big Eye Jig Heads - 1/24oz Black (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh124blue", sku: "JH-124-8-BLUE", upc: "850058548319", name: "ACC Big Eye Jig Heads - 1/24oz Blue (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1248chrt", sku: "JH-124-8-CHRT", upc: "850058548326", name: "ACC Crappie Big Eye Jig Heads - 1/24oz Chartreuse (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1248gren", sku: "JH-124-8-GREN", upc: "850058548333", name: "ACC Crappie Big Eye Jig Heads - 1/24oz Green (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1248orag", sku: "JH-124-8-ORAG", upc: "850058548340", name: "ACC Crappie Big Eye Jig Heads - 1/24oz Orange (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1248pink", sku: "JH-124-8-PINK", upc: "850058548357", name: "ACC Crappie Big Eye Jig Heads - 1/24oz Pink (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1248whte", sku: "JH-124-8-WHTE", upc: "850058548364", name: "ACC Crappie Big Eye Jig Heads - 1/24oz White (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1248slvr", sku: "JH-124-8-SLVR", upc: "850058548371", name: "ACC Crappie Big Eye Jig Heads - 1/24oz Silver (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1248gld", sku: "JH-124-8-GLD", upc: "850058548388", name: "ACC Crappie Big Eye Jig Heads - 1/24oz Gold (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh116blck", sku: "JH-116-8-BLCK", upc: "850056326438", name: "ACC Big Eye Jig Heads - 1/16oz Black (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh116blue", sku: "JH-116-8-BLUE", upc: "850056326391", name: "ACC Big Eye Jig Heads - 1/16oz Blue (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh116chrt", sku: "JH-116-8-CHRT", upc: "850056326513", name: "ACC Big Eye Jig Heads - 1/16oz Chartreuse (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1168gren", sku: "JH-116-8-GREN", upc: "850056326599", name: "ACC Crappie Big Eye Jig Heads - 1/16oz Green (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh116orag", sku: "JH-116-8-ORAG", upc: "850056326476", name: "ACC Big Eye Jig Heads - 1/16oz Orange (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1168pink", sku: "JH-116-8-PINK", upc: "850056326551", name: "ACC Crappie Big Eye Jig Heads - 1/16oz Pink (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh116whte", sku: "JH-116-8-WHTE", upc: "850056326636", name: "ACC Big Eye Jig Heads - 1/16oz White (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1168slvr", sku: "JH-116-8-SLVR", upc: "850058548395", name: "ACC Crappie Big Eye Jig Heads - 1/16oz Silver (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh1168gld", sku: "JH-116-8-GLD", upc: "850058548401", name: "ACC Crappie Big Eye Jig Heads - 1/16oz Gold (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh18blck", sku: "JH-18-8-BLCK", upc: "850056326445", name: "ACC Big Eye Jig Heads - 1/8oz Black (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh18blue", sku: "JH-18-8-BLUE", upc: "850056326407", name: "ACC Big Eye Jig Heads - 1/8oz Blue (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh18chrt", sku: "JH-18-8-CHRT", upc: "850056326520", name: "ACC Big Eye Jig Heads - 1/8oz Chartreuse (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh188gren", sku: "JH-18-8-GREN", upc: "850056326605", name: "ACC Crappie Big Eye Jig Heads - 1/8oz Green (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh188orag", sku: "JH-18-8-ORAG", upc: "850056326483", name: "ACC Crappie Big Eye Jig Heads - 1/8oz Orange (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh188pink", sku: "JH-18-8-PINK", upc: "850056326568", name: "ACC Crappie Big Eye Jig Heads - 1/8oz Pink (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh188whte", sku: "JH-18-8-WHTE", upc: "850056326643", name: "ACC Crappie Big Eye Jig Heads - 1/8oz White (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh18slvr", sku: "JH-18-8-SLVR", upc: "850058548418", name: "ACC Big Eye Jig Heads - 1/8oz Silver (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    { id: "p-jh188gld", sku: "JH-18-8-GLD", upc: "850058548425", name: "ACC Crappie Big Eye Jig Heads - 1/8oz Gold (8pk)", category: "Jig Heads", costPrice: 2.8, sellPrice: 5.99, onHand: 120, reorderPoint: 30, reorderQty: 120, supplier: "s2" },
    // -- Replacement Tips
    { id: "p-js102mmstip", sku: "JS-102-M-MS-TIP", upc: "850056326711", name: "Replacement Tip for JS-102-M-MS-C and JS-102-M-MS-SPG", category: "Replacement Tips", costPrice: 20, sellPrice: 40, onHand: 24, reorderPoint: 6, reorderQty: 24, supplier: "s1" },
    { id: "p-js112mmstip", sku: "JS-112-M-MS-TIP", upc: "850056326728", name: "Replacement Tip for JS-112-M-MS-C and JS-112-M-MS-SPG", category: "Replacement Tips", costPrice: 20, sellPrice: 40, onHand: 24, reorderPoint: 6, reorderQty: 24, supplier: "s1" },
    { id: "p-js122mmstip", sku: "JS-122-M-MS-TIP", upc: "850056326735", name: "Replacement Tip for JS-122-M-MS-C and JS-122-M-MS-SPG", category: "Replacement Tips", costPrice: 25, sellPrice: 50, onHand: 24, reorderPoint: 6, reorderQty: 24, supplier: "s1" },
    { id: "p-js132mmstip", sku: "JS-132-M-MS-TIP", upc: "850056326742", name: "Replacement Tip for JS-132-M-MS-C and JS-132-M-MS-SPG", category: "Replacement Tips", costPrice: 30, sellPrice: 60, onHand: 24, reorderPoint: 6, reorderQty: 24, supplier: "s1" },
    { id: "p-ks52scleva", sku: "KS-52SC-L-EVA", upc: "850056326667", name: "Replacement Tip for KS-52SC-L-EVA-CMB", category: "Replacement Tips", costPrice: 15, sellPrice: 30, onHand: 24, reorderPoint: 6, reorderQty: 24, supplier: "s1" },
    { id: "p-rs143mtip", sku: "RS-143-M-TIP", upc: "850056326759", name: "Replacement Tip for RS-143-M-EVA", category: "Replacement Tips", costPrice: 20, sellPrice: 40, onHand: 24, reorderPoint: 6, reorderQty: 24, supplier: "s1" },
    { id: "p-rs163mtip", sku: "RS-163-M-TIP", upc: "850056326766", name: "Replacement Tip for RS-163-M-EVA", category: "Replacement Tips", costPrice: 20, sellPrice: 40, onHand: 24, reorderPoint: 6, reorderQty: 24, supplier: "s1" },
    { id: "p-scs153mmstip", sku: "SCS-153-M-MS-TIP", upc: "850058548494", name: "Replacement Tip for SCS-153-M-MS-C", category: "Replacement Tips", costPrice: 35, sellPrice: 70, onHand: 24, reorderPoint: 6, reorderQty: 24, supplier: "s1" },
    { id: "p-sps62smftip", sku: "SPS-62S-MF-TIP", upc: "850056326674", name: "Replacement Tip for SPS-62S-MF-C", category: "Replacement Tips", costPrice: 17.5, sellPrice: 35, onHand: 24, reorderPoint: 6, reorderQty: 24, supplier: "s1" },
    { id: "p-sps662smftip", sku: "SPS-662S-MF-TIP", upc: "850056326681", name: "Replacement Tip for SPS-662S-M-C", category: "Replacement Tips", costPrice: 17.5, sellPrice: 35, onHand: 24, reorderPoint: 6, reorderQty: 24, supplier: "s1" },
    { id: "p-sps762smftip", sku: "SPS-762S-MF-TIP", upc: "850056326698", name: "Replacement Tip for SPS-762S-MF-C", category: "Replacement Tips", costPrice: 20, sellPrice: 40, onHand: 24, reorderPoint: 6, reorderQty: 24, supplier: "s1" },
    { id: "p-sps82smftip", sku: "SPS-82S-MF-TIP", upc: "850056326704", name: "Replacement Tip for SPS-82S-MF-C and SPS-82S-MF-SPG", category: "Replacement Tips", costPrice: 20, sellPrice: 40, onHand: 24, reorderPoint: 6, reorderQty: 24, supplier: "s1" },
    // -- Displays & Racks
    { id: "p-rodrack241", sku: "RODRACK24-1", upc: "", name: "ACC Crappie Stix 24 Unit Rod Rack", category: "Displays & Racks", costPrice: 0, sellPrice: 299.99, onHand: 6, reorderPoint: 2, reorderQty: 6, supplier: "s1" },
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
