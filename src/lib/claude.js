// --- Claude AI client wrapper -------------------------------------------------

const BASE = "/api/claude";

export async function analyzeInventory(inventorySummary, userPrompt) {
  const res = await fetch(`${BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inventorySummary, userPrompt }),
  });
  return res.json();
}
