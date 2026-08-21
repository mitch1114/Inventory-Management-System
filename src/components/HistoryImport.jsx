import { useState, useRef } from "react";
import { uid, fmt, fmtNum, nowIso, fmtDate } from "../lib/utils";
import {
  parseCustomerListCSV,
  parseSalesHistoryCSV,
  buildSalesImportPlan,
  mergeCustomerList,
  historyRevenue,
  normalizeName,
} from "../lib/historyImport";
import { BP, BS } from "./ui";

// One-time import of the company's historical spreadsheets:
//   1. Customer contact list CSV -> merges bill-to / email / phone into the
//      Customers tab (blanks only; ship-to addresses are never touched).
//   2. Running sales sheet CSV -> data.historicalSales (order-level history,
//      separate from live orders; PO#s already in the system are skipped).
// Nothing is written until the preview is confirmed.
export default function HistoryImport({ data, setData }) {
  const custRef = useRef(null);
  const salesRef = useRef(null);
  const [custPreview, setCustPreview] = useState(null); // { parsed, added, updated } | { error }
  const [salesPreview, setSalesPreview] = useState(null); // { plan, parsedCount, skippedBlank } | { error }
  const [msg, setMsg] = useState(null);

  const readFile = (e, cb) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => cb(ev.target.result);
    reader.readAsText(file);
  };

  // --- Customer list -----------------------------------------------------------
  const handleCustFile = (e) =>
    readFile(e, (text) => {
      setMsg(null);
      const result = parseCustomerListCSV(text);
      if (result.error) return setCustPreview({ error: result.error });
      const merged = mergeCustomerList(data.customers || [], result.customers);
      setCustPreview({ parsed: result.customers, merged });
    });

  const confirmCustImport = () => {
    const { merged, parsed } = custPreview;
    setData((d) => {
      // Re-merge against live data at confirm time (another tab may have
      // changed customers since the preview was computed).
      const fresh = mergeCustomerList(d.customers || [], parsed);
      return {
        ...d,
        customers: fresh.customers,
        auditLog: [
          ...(d.auditLog || []),
          {
            id: uid(),
            ts: nowIso(),
            type: "dealer-import",
            entity: "Historical Import",
            description: `Customer list import: ${fresh.added} added, ${fresh.updated} updated (bill-to/email/phone, blanks only -- ship-to untouched)`,
          },
        ],
      };
    });
    setMsg({ ok: true, text: `Customers imported: ${merged.added} added, ${merged.updated} updated. Ship-to addresses were not touched.` });
    setCustPreview(null);
  };

  // --- Sales history -----------------------------------------------------------
  const handleSalesFile = (e) =>
    readFile(e, (text) => {
      setMsg(null);
      const result = parseSalesHistoryCSV(text);
      if (result.error) return setSalesPreview({ error: result.error });
      const plan = buildSalesImportPlan(result.entries, data.customers || [], data.salesOrders || []);
      setSalesPreview({ plan, parsedCount: result.entries.length, skippedBlank: result.skippedBlank });
    });

  const confirmSalesImport = () => {
    const { plan } = salesPreview;
    setData((d) => {
      // Rebuild against live data at confirm time
      const freshPlan = buildSalesImportPlan(
        plan.rows.concat(plan.skippedOverlap),
        d.customers || [],
        d.salesOrders || [],
      );
      const newCustomers = freshPlan.newCustomers.map((n) => ({
        id: uid(),
        name: n.name,
        type: n.type === "distributor" ? "distributor-t1" : "dealer",
        paymentTerms: n.type === "distributor" ? "Net 60" : "Net 30",
        email: "",
        phone: "",
        address: "",
      }));
      const historicalSales = freshPlan.rows.map((r) => ({ id: uid(), ...r }));
      // Upgrade default-typed customers that the sheet marks Distributor on a
      // majority of rows (tolerates the sheet's occasional mislabeled row).
      // dealer -> distributor-t1 only, never the reverse.
      const typeByNorm = new Map();
      freshPlan.rows.forEach((r) => {
        const k = normalizeName(r.customer);
        const cur = typeByNorm.get(k) || { dist: 0, total: 0 };
        cur.total++;
        if (r.type === "distributor") cur.dist++;
        typeByNorm.set(k, cur);
      });
      const customersOut = [...(d.customers || []), ...newCustomers].map((c) => {
        const s = typeByNorm.get(normalizeName(c.name));
        return s && s.total > 0 && s.dist > s.total / 2 && (!c.type || c.type === "dealer")
          ? { ...c, type: "distributor-t1", paymentTerms: c.paymentTerms === "Net 60" ? c.paymentTerms : "Net 60" }
          : c;
      });
      return {
        ...d,
        customers: customersOut,
        historicalSales, // replaces any previous import (re-import safe)
        auditLog: [
          ...(d.auditLog || []),
          {
            id: uid(),
            ts: nowIso(),
            type: "dealer-import",
            entity: "Historical Import",
            description: `Sales history import: ${historicalSales.length} orders (${fmt(historicalSales.reduce((s, h) => s + historyRevenue(h), 0))}), ${newCustomers.length} customers created, ${freshPlan.skippedOverlap.length} skipped as live-order overlap`,
          },
        ],
      };
    });
    setMsg({
      ok: true,
      text: `Sales history imported: ${plan.rows.length} orders, ${plan.newCustomers.length} new customers, ${plan.skippedOverlap.length} skipped (already live orders). Re-importing later replaces this history cleanly.`,
    });
    setSalesPreview(null);
  };

  const histCount = (data.historicalSales || []).length;
  const box = {
    background: "#F8FAFC",
    border: "1px solid #E2E8F0",
    borderRadius: 10,
    padding: "12px 16px",
    marginTop: 12,
    fontSize: 12,
    color: "#475569",
    lineHeight: 1.7,
  };

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E8F0",
        borderRadius: 12,
        padding: "20px 24px",
        marginBottom: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "#F5F3FF",
            border: "1px solid #DDD6FE",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
            fontWeight: 800,
            color: "#6D28D9",
          }}
        >
          &#8681;
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>
            Historical Data Import
          </div>
          <div style={{ fontSize: 11, color: "#64748B" }}>
            One-time import of the customer contact list and the running YOY sales sheet
            (Google Sheets &rarr; File &rarr; Download &rarr; CSV). Preview first, nothing
            saves until you confirm.
            {histCount > 0 && (
              <span style={{ color: "#15803D", fontWeight: 700 }}>
                {" "}{fmtNum(histCount)} historical orders currently loaded.
              </span>
            )}
          </div>
        </div>
        <button style={{ ...BS, fontSize: 12 }} onClick={() => custRef.current?.click()}>
          1. Customer List CSV
        </button>
        <button style={{ ...BS, fontSize: 12 }} onClick={() => salesRef.current?.click()}>
          2. Sales History CSV
        </button>
        <input ref={custRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleCustFile} />
        <input ref={salesRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleSalesFile} />
      </div>

      {msg && (
        <div style={{ ...box, background: msg.ok ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${msg.ok ? "#BBF7D0" : "#FECACA"}`, color: msg.ok ? "#15803D" : "#B91C1C", fontWeight: 600 }}>
          {msg.text}
        </div>
      )}

      {/* Customer list preview */}
      {custPreview && (
        <div style={box}>
          {custPreview.error ? (
            <span style={{ color: "#B91C1C", fontWeight: 600 }}>{custPreview.error}</span>
          ) : (
            <>
              <strong>Customer list preview:</strong> {custPreview.parsed.length} rows parsed &rarr;{" "}
              <strong>{custPreview.merged.added} new customers</strong>, {custPreview.merged.updated} existing
              updated (bill-to address / email / phone, <em>blank fields only</em>).
              Ship-to addresses are <strong>not touched</strong> -- the bill-to goes in its own field.
              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <button style={{ ...BP, fontSize: 12 }} onClick={confirmCustImport}>
                  Import Customers
                </button>
                <button style={{ ...BS, fontSize: 12 }} onClick={() => setCustPreview(null)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Sales history preview */}
      {salesPreview && (
        <div style={box}>
          {salesPreview.error ? (
            <span style={{ color: "#B91C1C", fontWeight: 600 }}>{salesPreview.error}</span>
          ) : (
            (() => {
              const { plan, skippedBlank } = salesPreview;
              const dates = plan.rows.map((r) => r.date).filter(Boolean).sort();
              const totPO = plan.rows.reduce((s, r) => s + (r.poAmount || 0), 0);
              const totRev = plan.rows.reduce((s, r) => s + historyRevenue(r), 0);
              return (
                <>
                  <strong>Sales history preview:</strong> {plan.rows.length} orders to import
                  {dates.length > 0 && <> ({fmtDate(dates[0])} &ndash; {fmtDate(dates[dates.length - 1])})</>}
                  {" "}&middot; {fmt(totPO)} PO total &middot; {fmt(totRev)} revenue basis
                  {skippedBlank > 0 && <> &middot; {skippedBlank} malformed rows dropped</>}
                  {plan.skippedOverlap.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <strong style={{ color: "#9A3412" }}>
                        Skipped {plan.skippedOverlap.length} rows already in the system as live orders:
                      </strong>{" "}
                      {plan.skippedOverlap.map((e) => `${e.customer} (PO ${e.poRef})`).join(", ")}
                    </div>
                  )}
                  {plan.newCustomers.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <strong>{plan.newCustomers.length} new customers will be created:</strong>
                      <div style={{ maxHeight: 100, overflowY: "auto", marginTop: 4, color: "#64748B" }}>
                        {plan.newCustomers.map((n) => n.name).sort().join(" · ")}
                      </div>
                    </div>
                  )}
                  {(data.historicalSales || []).length > 0 && (
                    <div style={{ marginTop: 6, color: "#9A3412", fontWeight: 600 }}>
                      This replaces the {fmtNum((data.historicalSales || []).length)} previously imported
                      historical orders.
                    </div>
                  )}
                  <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    <button style={{ ...BP, fontSize: 12 }} onClick={confirmSalesImport}>
                      Import Sales History
                    </button>
                    <button style={{ ...BS, fontSize: 12 }} onClick={() => setSalesPreview(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              );
            })()
          )}
        </div>
      )}
    </div>
  );
}
