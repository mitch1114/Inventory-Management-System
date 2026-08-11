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
      // Strip trailing country tokens ("... MO 65279 US") -- SPS/EDI addresses
      // append them and they break the ZIP detection below. Also split a
      // glued state+ZIP ("PA16415" -> "PA 16415"); street numbers are never
      // exactly 5 digits attached to a letter, so this is safe.
      const segs = String(str || "")
        .split(/[|,]/)
        .map((s) =>
          s
            .trim()
            // Only strip US/USA when it follows a ZIP (or stands alone) --
            // company names like "Fish USA" / "Midway USA" must survive.
            .replace(/(\d{5}(?:-\d{4})?)\s+(?:US|USA|United States)$/i, "$1")
            .replace(/^(?:US|USA|United States)$/i, "")
            .replace(/([A-Za-z])(\d{5}(?:-\d{4})?)$/, "$1 $2"),
        )
        .filter(Boolean);
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

      // Segments without commas glue street and city together ("Company 6960
      // W. Ridge Road Fairview" before "PA 16415"). When the extracted city
      // contains digits it's really street+city -- split on the LAST
      // street-suffix word and push the street part back into `rest`.
      if (out.city && /\d/.test(out.city) && out.city.split(/\s+/).length > 2) {
        const toks = out.city.split(/\s+/);
        const SUFFIX = /^(road|rd|street|st|drive|dr|avenue|ave|blvd|boulevard|hwy|highway|lane|ln|way|court|ct|circle|cir|pkwy|parkway|trail|trl|box|suite|ste|apt|unit|place|pl|plaza|loop)\.?$/i;
        let cut = -1;
        for (let i = 0; i < toks.length; i++) {
          if (SUFFIX.test(toks[i])) {
            cut = i;
            // absorb trailing unit/route numbers and directionals ("Box 17587",
            // "Suite 3", "Hwy 9 East") as long as a city token remains after
            while (
              cut + 1 < toks.length - 1 &&
              /^(#?\d+[A-Za-z]?|[NSEW]|North|South|East|West)$/i.test(toks[cut + 1])
            )
              cut++;
          }
        }
        if (cut >= 0 && cut < toks.length - 1) {
          rest.push(toks.slice(0, cut + 1).join(" "));
          out.city = toks.slice(cut + 1).join(" ");
        } else if (toks.length > 1) {
          rest.push(toks.slice(0, -1).join(" "));
          out.city = toks[toks.length - 1];
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
      // Company name still embedded at the start of the street line ("Farris
      // Brothers Inc PO Box 17587"): everything before the first numeric / PO
      // token is the company. Streets starting with their number ("213 Tech
      // Way") and label lines ("ATN RECEIVING") are untouched.
      if (out.street1 && !/^[#\d]/.test(out.street1)) {
        const toks = out.street1.split(/\s+/);
        const di = toks.findIndex((t) => /\d/.test(t) || /^p\.?o\.?$/i.test(t) || t.startsWith("#"));
        if (di > 0) {
          const head = toks.slice(0, di).join(" ");
          out.company = out.company ? `${out.company} ${head}` : head;
          out.street1 = toks.slice(di).join(" ");
        }
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

    // Ship-to label format the warehouse wants: Full Name is the full customer
    // name, and Company carries the receiving line with the dealer's PO number
    // ("ATN Receiving PO# <dealerPORef>").
    const atnCompany = order.dealerPORef ? `ATN Receiving PO# ${order.dealerPORef}` : "";
    if (atnCompany) {
      // The ATN line now lives in Company -- drop duplicate ATN/ATTN street
      // lines that came in from the address on file, promoting real street
      // lines up so street1 stays populated.
      for (const k of ["street1", "street2", "street3"]) {
        if (/^AT+N/i.test(shipAddr[k] || "")) shipAddr[k] = "";
      }
      const streets = [shipAddr.street1, shipAddr.street2, shipAddr.street3].filter(Boolean);
      shipAddr.street1 = streets[0] || "";
      shipAddr.street2 = streets[1] || "";
      shipAddr.street3 = streets[2] || "";
    }

    // Fail fast with a fixable message instead of letting ShipStation reject
    // an empty ship-to. The address comes from the customer record (or the
    // imported PO), so tell the user exactly where to fix it.
    if (!shipAddr.street1 || !shipAddr.postalCode) {
      return res.status(400).json({
        error: `No usable ship-to address for "${order.customer}" -- add a full address (street, city, state, ZIP) on the customer record (Customers tab), then push again.`,
        detail: `Address on file: "${shipSource || "(empty)"}"`,
      });
    }

    // Only push units actually picked/filled -- backordered lines (0 filled)
    // don't belong on the ShipStation packing slip.
    const items = (order.lines || [])
      .map((l) => ({
        sku: l.sku || "",
        name: l.productName || l.sku || "",
        quantity: l.qtyFilled != null ? l.qtyFilled : l.qty,
        unitPrice: l.price || 0,
      }))
      .filter((i) => i.quantity > 0);
    if (items.length === 0) {
      return res.status(400).json({
        error: `${order.orderNum} has no filled units -- every line is backordered (0 picked), so there is nothing to ship. Adjust quantities and push again.`,
      });
    }

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
        name: order.customer || "Unknown",
        company: atnCompany || shipAddr.company || "",
        street1: shipAddr.street1,
        street2: shipAddr.street2 || "",
        street3: shipAddr.street3 || "",
        city: shipAddr.city,
        state: shipAddr.state,
        postalCode: shipAddr.postalCode,
        country: "US",
        phone: order.customerPhone || "",
      },
      items,
      // Order notes stay internal -- they are working notes, not something to
      // print on ShipStation docs.
      customerNotes: "",
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
      // Extract ShipStation's human-readable message (their errors come back
      // as JSON with Message/ExceptionMessage) so the UI can show WHY.
      const errText = await response.text();
      let detail = errText;
      try {
        const body = JSON.parse(errText);
        detail = body.ExceptionMessage || body.Message || body.message || errText;
      } catch (_) {
        /* non-JSON error body */
      }
      console.error(`ShipStation create-order failed for ${order.orderNum}: HTTP ${response.status} -- ${errText}`);
      return res.status(response.status).json({
        error: `ShipStation rejected ${order.orderNum} (HTTP ${response.status})`,
        detail: String(detail).slice(0, 500),
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
