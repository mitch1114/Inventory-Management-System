import { useState } from "react";
import * as XLSX from "xlsx";
import { parsePricingCosts, planCostImport, applyCostImport } from "../lib/costImport";
import { fmtNum, uid, nowIso } from "../lib/utils";
import { Modal, BP, BS } from "./ui";

// Unit costs carry fractions of a cent (jig heads $1.098) -- show them
const money4 = (n) =>
  `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

const th = {
  padding: "6px 10px",
  fontSize: 10,
  fontWeight: 700,
  color: "#64748B",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  textAlign: "left",
  position: "sticky",
  top: 0,
  background: "#F8FAFC",
  borderBottom: "1px solid #E2E8F0",
};
const td = { padding: "6px 10px", fontSize: 12, color: "#334155", borderBottom: "1px solid #F1F5F9" };

const Change = ({ from, to }) =>
  Math.abs(from - to) < 0.00005 ? (
    <span style={{ color: "#94A3B8" }}>{money4(to)}</span>
  ) : (
    <span>
      <span style={{ color: "#94A3B8", textDecoration: "line-through", marginRight: 6 }}>
        {from ? money4(from) : "--"}
      </span>
      <strong style={{ color: "#0F172A" }}>{money4(to)}</strong>
    </span>
  );

// Import Cost + Landed Cost per product from the pricing & margins workbook,
// with a full preview before anything is written.
export default function CostImportModal({ data, setData, onClose }) {
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  const onFile = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setPlan(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "array" });
        const sheet = (re) => {
          const name = wb.SheetNames.find((n) => re.test(n));
          return name ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) : null;
        };
        const costRows = sheet(/^pricing costs$/i);
        if (!costRows) {
          setError('This workbook has no "Pricing costs" sheet.');
          return;
        }
        const parsed = parsePricingCosts(costRows, sheet(/^products$/i));
        if (parsed.error) {
          setError(parsed.error);
          return;
        }
        setPlan(planCostImport(parsed.rows, data.products));
      } catch (err) {
        setError(`Couldn't read this file: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const apply = () => {
    setData((d) => applyCostImport(d, plan, { fileName, now: nowIso(), makeId: uid }));
    setDone(plan.updates.length);
  };

  const section = (title, items, render, tone = "#64748B") =>
    items.length > 0 && (
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: tone }}>
          {title} ({items.length})
        </summary>
        <div style={{ fontSize: 11, color: "#64748B", marginTop: 6, lineHeight: 1.6 }}>
          {items.map(render).join(" · ")}
        </div>
      </details>
    );

  return (
    <Modal title="Import Costs from Pricing Workbook" onClose={onClose} width={900}>
      {done != null ? (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#15803D" }}>
            Updated cost &amp; landed cost on {fmtNum(done)} products
          </div>
          <div style={{ fontSize: 12, color: "#64748B", marginTop: 6 }}>
            Logged in the Audit Log. Sell prices were not touched.
          </div>
          <button style={{ ...BP, marginTop: 16 }} onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "#475569", marginTop: 0 }}>
            Reads the <strong>Pricing costs</strong> sheet: <em>Complete goods / unit</em> becomes{" "}
            <strong>Cost</strong> and <em>Active pricing cost / unit</em> (goods + estimated DDP) becomes{" "}
            <strong>Landed</strong>. SKUs without a cost yet are skipped, sell prices are untouched, and
            nothing is saved until you click Update.
          </p>
          <label style={{ ...BS, display: "inline-block", cursor: "pointer" }}>
            {fileName ? "Choose a different file" : "Choose workbook (.xlsx)"}
            <input type="file" accept=".xlsx,.xlsm,.xls" style={{ display: "none" }} onChange={onFile} />
          </label>
          {fileName && <span style={{ marginLeft: 10, fontSize: 12, color: "#64748B" }}>{fileName}</span>}
          {error && (
            <div style={{ marginTop: 12, background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
              {error}
            </div>
          )}

          {plan && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {[
                  [`${plan.updates.length} to update`, "#15803D", "#F0FDF4", "#BBF7D0"],
                  [`${plan.unchanged.length} already match`, "#475569", "#F8FAFC", "#E2E8F0"],
                  [`${plan.incomplete.length} skipped (no cost in workbook yet)`, "#9A3412", "#FFF7ED", "#FED7AA"],
                  [`${plan.unmatched.length} workbook SKUs not in the app`, "#475569", "#F8FAFC", "#E2E8F0"],
                  [`${plan.notInWorkbook.length} app products not in workbook (left as is)`, "#475569", "#F8FAFC", "#E2E8F0"],
                ].map(([t, c, bg, bd]) => (
                  <span key={t} style={{ fontSize: 11, fontWeight: 700, color: c, background: bg, border: `1px solid ${bd}`, borderRadius: 20, padding: "3px 10px" }}>
                    {t}
                  </span>
                ))}
              </div>

              {plan.updates.length > 0 ? (
                <div style={{ maxHeight: 380, overflow: "auto", border: "1px solid #E2E8F0", borderRadius: 8 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={th}>SKU</th>
                        <th style={th}>Product</th>
                        <th style={th}>Cost</th>
                        <th style={th}>Landed</th>
                        <th style={th}>Workbook status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.updates.map((u) => (
                        <tr key={u.productId}>
                          <td style={{ ...td, fontFamily: "monospace", color: "#6D28D9", whiteSpace: "nowrap" }}>
                            {u.sku}
                            {u.matchedBy === "upc" && (
                              <div style={{ fontSize: 10, color: "#94A3B8" }} title="Matched by UPC">
                                = {u.wbSku} (UPC)
                              </div>
                            )}
                          </td>
                          <td style={{ ...td, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={u.name}>
                            {u.name}
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>
                            <Change from={u.oldCost} to={u.newCost} />
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>
                            <Change from={u.oldLanded} to={u.newLanded} />
                          </td>
                          <td style={{ ...td, fontSize: 11, color: "#64748B" }}>{u.status || "--"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "#64748B", padding: "12px 0" }}>
                  Nothing to update -- every matched product already has these costs.
                </div>
              )}

              {section("Skipped -- workbook has no cost yet", plan.incomplete, (r) => r.sku, "#9A3412")}
              {section("Workbook SKUs not found in the app", plan.unmatched, (r) => r.sku)}
              {section("App products not in the workbook (unchanged)", plan.notInWorkbook, (p) => p.sku)}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                <button style={BS} onClick={onClose}>
                  Cancel
                </button>
                <button style={{ ...BP, opacity: plan.updates.length ? 1 : 0.5 }} disabled={!plan.updates.length} onClick={apply}>
                  Update {fmtNum(plan.updates.length)} products
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
