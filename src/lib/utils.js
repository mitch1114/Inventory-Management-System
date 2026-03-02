// --- Utility helpers ----------------------------------------------------------
export const uid = () => Math.random().toString(36).slice(2, 10);
export const fmt = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
export const fmtNum = (n) => new Intl.NumberFormat("en-US").format(n || 0);
export const fmtDate = (d) =>
  d
    ? new Date(d.includes("T") ? d : d + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "--";
export const fmtTs = (ts) =>
  new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export const nowIso = () => new Date().toISOString();
export const todayIso = () => new Date().toISOString().slice(0, 10);

// --- CSV helpers --------------------------------------------------------------
const escCSV = (v) => `"${String(v != null ? v : "").replace(/"/g, '""')}"`;

export function toCSV(rows, headers) {
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escCSV(r[h])).join(","))].join(
    "\n",
  );
}

export function dlCSV(csv, fn) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = fn;
  a.click();
}

export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const hdrs = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const vals = [];
      let cur = "";
      let inQ = false;
      for (const ch of line) {
        if (ch === '"') {
          inQ = !inQ;
          continue;
        }
        if (ch === "," && !inQ) {
          vals.push(cur.trim());
          cur = "";
          continue;
        }
        cur += ch;
      }
      vals.push(cur.trim());
      return Object.fromEntries(hdrs.map((h, i) => [h, vals[i] != null ? vals[i] : ""]));
    });
}

export const detectCol = (headers, aliases) =>
  headers.find((h) => aliases.includes(h.toLowerCase().trim())) || null;
