// --- FULFILLMENT STAGES -------------------------------------------------------
// Inventory is locked from "confirmed" through "booked"
// onHand is only decremented when order reaches "shipped"
export const STAGES = ["confirmed", "picked", "booked", "shipped"];
export const STAGE_LABEL = {
  confirmed: "Confirmed",
  picked: "Picked & Packed",
  booked: "Shipment Booked",
  shipped: "Shipped",
};
export const STAGE_NEXT = { confirmed: "picked", picked: "booked", booked: "shipped" };
export const STAGE_BTN = {
  confirmed: "Mark Picked & Packed",
  picked: "Mark Shipment Booked",
  booked: "Mark as Shipped",
};
export const LOCKING = new Set(["confirmed", "picked", "booked"]); // these lock inventory

export const STORAGE_KEY = "acc_crappie_v2";

// --- Status colors ------------------------------------------------------------
export const SC = {
  confirmed:       { bg: "#EFF6FF", text: "#1D4ED8", dot: "#3B82F6", border: "#BFDBFE" },
  picked:          { bg: "#FEFCE8", text: "#854D0E", dot: "#CA8A04", border: "#FDE68A" },
  booked:          { bg: "#ECFEFF", text: "#0E7490", dot: "#06B6D4", border: "#A5F3FC" },
  shipped:         { bg: "#F0FDF4", text: "#15803D", dot: "#16A34A", border: "#BBF7D0" },
  "shipped-log":   { bg: "#F0FDF4", text: "#15803D", dot: "#16A34A", border: "#BBF7D0" },
  cancelled:       { bg: "#FEF2F2", text: "#B91C1C", dot: "#DC2626", border: "#FECACA" },
  preorder:        { bg: "#FAF5FF", text: "#6D28D9", dot: "#7C3AED", border: "#DDD6FE" },
  distributor:     { bg: "#F0F9FF", text: "#0369A1", dot: "#0EA5E9", border: "#BAE6FD" },
  retailer:        { bg: "#F0FDF4", text: "#15803D", dot: "#16A34A", border: "#BBF7D0" },
  dealer:          { bg: "#FFF7ED", text: "#9A3412", dot: "#EA580C", border: "#FED7AA" },
  backordered:     { bg: "#FFF7ED", text: "#9A3412", dot: "#EA580C", border: "#FED7AA" },
  partial:         { bg: "#FEFCE8", text: "#854D0E", dot: "#CA8A04", border: "#FDE68A" },
  ordered:         { bg: "#EFF6FF", text: "#1D4ED8", dot: "#3B82F6", border: "#BFDBFE" },
  received:        { bg: "#F0FDF4", text: "#15803D", dot: "#16A34A", border: "#BBF7D0" },
  adjustment:      { bg: "#F0F9FF", text: "#0369A1", dot: "#0EA5E9", border: "#BAE6FD" },
  "stage-advance": { bg: "#ECFEFF", text: "#0E7490", dot: "#06B6D4", border: "#A5F3FC" },
  "dealer-import": { bg: "#ECFEFF", text: "#0E7490", dot: "#06B6D4", border: "#A5F3FC" },
  "auto-allocated":{ bg: "#FAF5FF", text: "#6D28D9", dot: "#7C3AED", border: "#DDD6FE" },
  hold:            { bg: "#FEFCE8", text: "#854D0E", dot: "#CA8A04", border: "#FDE68A" },
};

// --- CSV column aliases -------------------------------------------------------
export const COL_ALIASES = {
  sku:   ["sku", "item", "item #", "item no", "part", "part no", "part number", "product code", "code", "item code", "model", "model #", "style", "style #", "upc"],
  qty:   ["qty", "quantity", "order qty", "ordered", "units", "qty ordered", "amount", "count"],
  price: ["price", "unit price", "sell price", "each", "cost", "rate", "unit cost", "msrp", "dealer price", "wholesale", "net price"],
  name:  ["name", "description", "product", "product name", "item description", "desc", "title"],
  poRef: ["po", "po#", "po number", "po no", "purchase order", "reference", "ref", "order number", "order #", "dealer po"],
};
