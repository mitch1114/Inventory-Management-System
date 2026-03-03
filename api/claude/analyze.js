// POST /api/claude/analyze
// Sends inventory demand data to Claude AI for analysis and recommendations.
// Requires ANTHROPIC_API_KEY environment variable.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      success: false,
      error:
        "Anthropic API key not configured. Add ANTHROPIC_API_KEY to your Vercel environment variables. Get one at console.anthropic.com.",
    });
  }

  const { inventorySummary, userPrompt } = req.body || {};
  if (!inventorySummary || !userPrompt) {
    return res.status(400).json({
      success: false,
      error: "Missing inventorySummary or userPrompt in request body.",
    });
  }

  const systemPrompt = `You are an expert inventory demand planner for ACC Crappie Stix, a fishing equipment company that sells rods, reels, line, and accessories to dealers and distributors.

Your job is to analyze their inventory data and provide actionable recommendations. Be specific -- reference SKUs, quantities, dates, and dollar amounts. Keep responses concise and actionable.

Key concepts:
- "Available" = On-Hand minus Locked (units committed to orders in pipeline)
- "Days of Supply" = Available units / daily sales velocity
- "Dynamic Reorder Point" = (daily velocity × supplier lead time) × 1.5 safety factor
- Products below their dynamic reorder point need restocking
- Supplier lead times range from 7-45 days depending on source (domestic vs overseas)
- Crappie fishing is seasonal -- spring (March-May) is peak season
- ACC sells through dealers, distributors, and direct preorders

Format your response with clear headers, bullet points, and tables where useful. Use $ for dollar amounts. Be direct and practical -- this is a small business owner who needs clear action items, not theory.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Here is the current inventory data:\n\n${inventorySummary}\n\n---\n\nMy question: ${userPrompt}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(200).json({
        success: false,
        error: `Claude API error (${response.status}): ${errBody}`,
      });
    }

    const data = await response.json();
    const text =
      data.content && data.content[0] && data.content[0].text
        ? data.content[0].text
        : "No response from Claude.";

    return res.status(200).json({ success: true, response: text });
  } catch (err) {
    return res.status(200).json({
      success: false,
      error: `Failed to reach Claude API: ${err.message}`,
    });
  }
}
