// Shared barcode-scanning helpers for CycleCount, ReceivingModal, and the
// pick-verify flow. Two jobs:
//
// 1. Decoder configuration tuned for 1D retail barcodes on phone cameras:
//    restricting formats + enabling the native BarcodeDetector makes UPC
//    scanning dramatically faster and more reliable than the defaults.
// 2. Code matching that understands UPC/EAN quirks: a UPC-A barcode
//    (12 digits, e.g. 850056326933) is decoded by scanners as a 13-digit
//    EAN value with a leading zero (0850056326933). Matching numeric codes
//    with leading zeros stripped makes both directions work.
import { Html5QrcodeSupportedFormats } from "html5-qrcode";

export const CAMERA_CONSTRAINTS = { facingMode: "environment" };

// Constructor options for `new Html5Qrcode(elementId, DECODER_OPTIONS)`.
// IMPORTANT: formatsToSupport and experimentalFeatures only take effect here,
// in the constructor -- html5-qrcode ignores them in the start() config.
export const DECODER_OPTIONS = {
  formatsToSupport: [
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.QR_CODE,
  ],
  // Native BarcodeDetector (Android Chrome et al.) -- much faster 1D decoding.
  experimentalFeatures: { useBarCodeDetectorIfSupported: true },
  verbose: false,
};

// start() camera-scan config.
export const SCANNER_CONFIG = {
  fps: 15,
  // Size the scan box from the actual camera viewport -- fixed pixel boxes
  // fail or crop badly on narrow portrait phone cameras.
  qrbox: (viewfinderWidth, viewfinderHeight) => ({
    width: Math.max(180, Math.min(Math.floor(viewfinderWidth * 0.9), 360)),
    height: Math.max(100, Math.min(Math.floor(viewfinderHeight * 0.45), 180)),
  }),
  // Request a high-resolution feed -- low-res defaults make 1D barcodes
  // (thin lines) undecodable on many phones. "ideal" is a soft constraint.
  videoConstraints: {
    facingMode: "environment",
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
};

// Numeric key for UPC/EAN matching: digits only, leading zeros stripped.
// Returns null for short digit runs so SKUs with digits don't collide.
function numKey(value) {
  const digits = String(value == null ? "" : value).replace(/\D/g, "");
  if (digits.length < 6 || digits.length !== String(value).trim().length) return null;
  return digits.replace(/^0+/, "");
}

// Build a lookup of scannable codes -> productId (SKU forms + UPC forms).
export function buildScanIndex(products) {
  const m = {};
  (products || []).forEach((p) => {
    if (p.sku) {
      const sku = String(p.sku).toLowerCase().trim();
      m[sku] = p.id;
      m[sku.replace(/[-\s]/g, "")] = p.id;
    }
    if (p.upc) {
      m[String(p.upc).toLowerCase().trim()] = p.id;
      const nk = numKey(p.upc);
      if (nk) m["num:" + nk] = p.id;
    }
  });
  return m;
}

// Match a scanned/typed code against the index. Returns productId or null.
export function matchScan(index, code) {
  const raw = String(code == null ? "" : code).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const nk = numKey(raw);
  return (
    index[lower] ||
    index[lower.replace(/[-\s]/g, "")] ||
    (nk ? index["num:" + nk] : null) ||
    null
  );
}

// Wait for a DOM element to exist (the scanner container renders on the same
// tick the camera is started, so a fixed 100ms delay is a race).
export async function waitForElement(id, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (document.getElementById(id)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !!document.getElementById(id);
}
