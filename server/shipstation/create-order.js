// POST /api/shipstation/create-order
// Pushes or updates an order in ShipStation when it reaches "booked"
//
// ShipStation API: POST /orders/createorder
// Docs: https://www.shipstation.com/docs/api/orders/create-update-order/

const SS_BASE = "https://ssapi.shipstation.com";

export default async function handler(req, res) {
  const _origin = req.headers.origin || ""; res.setHeader("Access-Control-Allow-Origin", _origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.SHIPSTATION_API_KEY;
  const apiSecret = process.env.SHIPSTATION_API_SECRET;
  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: "ShipStation API credentials not configured. Both SHIPSTATION_API_KEY and SHIPSTATION_API_SECRET are required." });
  }

  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

  try {
    const { order } = req.body;
    if (!order || !order.orderNum) {
      return res.status(400).json({ error: "Missing order data" });
    }

    // Split a one-line address into the structured fields ShipStation needs.
    // Handles comma AND pipe separated forms, e.g.
    //   "1114 Southport Road, Kilgore, TX 75662"
    //   "Pitman Creek Wholesale | ATN RECEIVING | 213 Tech Way | Stanford KY, 40484"
    const parseAddress = (str, customerName) => {
      const out = { company: "", street1: "", street2: "", street3: "", city: "", state: "", postalCode: "" };
      const segs = String(str || "").split(/[|,]/).map((s) => s.trim()).filter(Boolean);
      if (segs.length === 0) return out;

      // Find the zip working backwards; capture "City ST 12345", "ST 12345",
      // or a bare "12345" (city/state then live in earlier segments).
      let zipIdx = -1;
      for (let i = segs.length - 1; i >= 0; i--) {
        const m = segs[i].match(/^(.*?)\s*([A-Za-z]{2})?\s+?(\d{5}(?:-\d{4})?)$/) ||
          segs[i].match(/^(\d{5}(?:-\d{4})?)$/);
        if (!m) continue;
        zipIdx = i;
        if (m.length === 2) {
          out.postalCode = m[1];
        } else {
          out.postalCode = m[3];
          if (m[2]) out.state = m[2].toUpperCase();
          if (m[1]) out.city = m[1].trim();
        }
        break;
      }
      if (zipIdx === -1) {
        // No zip anywhere -- pass everything through as street lines
        out.street1 = segs.slice(0, 3).join(", ");
        return out;
      }

      let rest = segs.slice(0, zipIdx);
      // Pull city/state from preceding segments if the zip segment lacked them
      if (!out.city && rest.length) {
        let citySeg = rest.pop();
        const cs = citySeg.match(/^(.*?)\s+([A-Za-z]{2})$/);
        if (cs && !out.state) {
          out.city = cs[1].trim();
          out.state = cs[2].toUpperCase();
        } else {
          out.city = citySeg;
        }
      }
      // Leading company-name segment (matches the customer, or has no digits
      // while a street-looking segment follows) becomes the company field.
      if (
        rest.length >= 2 &&
        !/\d/.test(rest[0]) &&
        (String(customerName || "").toLowerCase().includes(rest[0].toLowerCase().slice(0, 12)) || /\d/.test(rest[1]) || rest.length >= 3)
      ) {
        out.company = rest.shift();
      }
      out.street1 = rest.shift() || "";
      out.street2 = rest.shift() || "";
      out.street3 = rest.join(", ");
      // ATN/ATTN lines belong after the street
      if (/^AT+N/i.test(out.street1) && out.street2) {
        [out.street1, out.street2] = [out.street2, out.street1];
      }
      return out;
    };

    // Prefer whichever address source actually contains a zip code
    const hasZip = (s) => /\d{5}/.test(String(s || ""));
    const shipSource = hasZip(order.shipToAddr)
      ? order.shipToAddr
      : hasZip(order.address)
        ? order.address
        : order.shipToAddr || order.address || "";
    const billSource = hasZip(order.address) ? order.address : order.address || shipSource;
    const shipAddr = parseAddress(shipSource, order.customer);
    const billAddr = parseAddress(billSource, order.customer);

    // Build ShipStation order payload.
    // orderKey is our stable internal id: without it, ShipStation's
    // /orders/createorder CREATES A NEW ORDER on every call -- with it,
    // repeat pushes update the same order (no duplicates).
    const ssOrder = {
      orderKey: order.id || order.orderNum,
      orderNumber: order.dealerPORef || order.orderNum,
      orderDate: order.date || new Date().toISOString().slice(0, 10),
      orderStatus: "awaiting_shipment",
      customerUsername: order.customer || "Unknown",
      customerEmail: order.customerEmail || undefined,
      billTo: {
        name: order.customer || "Unknown",
        company: billAddr.company || "",
        street1: billAddr.street1,
        street2: billAddr.street2 || "",
        street3: billAddr.street3 || "",
        city: billAddr.city,
        state: billAddr.state,
        postalCode: billAddr.postalCode,
        country: "US",
        phone: order.customerPhone || "",
      },
      shipTo: {
        name: order.shipTo || order.customer || "Unknown",
        company: shipAddr.company || "",
        street1: shipAddr.street1,
        street2: shipAddr.street2 || "",
        street3: shipAddr.street3 || "",
        city: shipAddr.city,
        state: shipAddr.state,
        postalCode: shipAddr.postalCode,
        country: "US",
        phone: order.customerPhone || "",
      },
      items: (order.lines || []).map((l) => ({
        sku: l.sku || "",
        name: l.productName || l.sku || "",
        quantity: l.qtyFilled != null ? l.qtyFilled : l.qty,
        unitPrice: l.price || 0,
      })),
      customerNotes: order.notes || "",
      internalNotes: `Internal order: ${order.orderNum} | Type: ${order.type || "dealer"}`,
    };

    const response = await fetch(`${SS_BASE}/orders/createorder`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ssOrder),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `ShipStation API error: ${response.status}`,
        detail: errText,
      });
    }

    const result = await response.json();
    return res.status(200).json({
      success: true,
      shipstationOrderId: result.orderId,
      orderNumber: result.orderNumber,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
