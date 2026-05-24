import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MODEL = "claude-sonnet-4-5";

async function callClaude(systemPrompt: string, userPrompt: string, maxTokens = 400): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error("Anthropic error", res.status, txt);
    throw new Error(`Anthropic API error: ${res.status}`);
  }
  const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
  return data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
}

function extractJsonArray(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array found");
  return JSON.parse(candidate.slice(start, end + 1));
}

export const generateQuestions = createServerFn({ method: "POST" })
  .inputValidator((d: { item: string; count?: number }) =>
    z.object({ item: z.string().min(1).max(200), count: z.number().int().min(3).max(5).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const count = data.count ?? 4;
    const system = `You generate exactly ${count} short, calm, non-judgmental Yes/Maybe/No questions to help someone decide whether to buy a specific item. The questions MUST be highly tailored to the item — reference its actual use cases, context, and category. Avoid generic phrasing.

Rules:
- Each question must be answerable with Yes / Maybe / No.
- Each question max 14 words, one sentence, no preamble.
- Cover the most decision-critical angles: real usage frequency, owning similar, alignment with goals/lifestyle, and one item-specific consideration.
- Phrase so "Yes" is the positive (pro-buy) answer when possible. If "No" is the positive answer (e.g. "Do you already own something similar?"), that is fine.
- Output ONLY a JSON array of ${count} strings. No prose, no keys, no markdown.`;

    const raw = await callClaude(system, `Item: ${data.item}\n\nReturn the JSON array now.`, 500);
    let parsed: unknown;
    try {
      parsed = extractJsonArray(raw);
    } catch {
      throw new Error("Failed to parse questions");
    }
    const arr = z.array(z.string().min(3).max(160)).length(count).parse(parsed);
    return { questions: arr.map((q) => q.replace(/^["']|["']$/g, "").trim()) };
  });

export const generateDeepQuestions = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { item: string; decision: "BUY" | "WAIT" | "SKIP"; signals: string[]; count?: number }) =>
      z
        .object({
          item: z.string().min(1).max(200),
          decision: z.enum(["BUY", "WAIT", "SKIP"]),
          signals: z.array(z.string().max(200)).max(10),
          count: z.number().int().min(1).max(3).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const count = data.count ?? 3;
    const system = `You generate ${count} deeper follow-up Yes/Maybe/No questions to pressure-test a buying decision. These must NOT repeat the earlier questions implied by the provided signals. Probe motivation, hidden costs, opportunity cost, or emotional drivers specific to the item.

Rules:
- Each question max 16 words, one sentence, answerable with Yes / Maybe / No.
- Tailored to the item and the tentative decision.
- Output ONLY a JSON array of ${count} strings. No prose, no markdown.`;
    const prompt = `Item: ${data.item}\nTentative decision: ${data.decision}\nAlready asked / signals: ${data.signals.join("; ")}\n\nReturn the JSON array now.`;
    const raw = await callClaude(system, prompt, 400);
    let parsed: unknown;
    try {
      parsed = extractJsonArray(raw);
    } catch {
      throw new Error("Failed to parse deep questions");
    }
    const arr = z.array(z.string().min(3).max(180)).length(count).parse(parsed);
    return { questions: arr.map((q) => q.replace(/^["']|["']$/g, "").trim()) };
  });

export const generateExplanation = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { item: string; decision: "BUY" | "WAIT" | "SKIP"; signals: string[]; deep?: boolean }) =>
      z
        .object({
          item: z.string().min(1).max(200),
          decision: z.enum(["BUY", "WAIT", "SKIP"]),
          signals: z.array(z.string().max(200)).max(16),
          deep: z.boolean().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const system = data.deep
      ? "You write a focused 2–3 sentence explanation (max 60 words) of a buying decision, citing the strongest signals. Calm, practical, non-judgmental. No preamble, no quotes, no emojis, no bullet points."
      : "You write ONE short sentence (max 20 words) explaining a buying decision. Tone: calm, practical, non-judgmental. No preamble, no quotes, no emojis.";
    const prompt = `Item: ${data.item}\nDecision: ${data.decision}\nSignals: ${data.signals.join("; ")}\nWrite the explanation.`;
    const text = await callClaude(system, prompt, data.deep ? 350 : 200);
    const cleaned = text.replace(/^["']|["']$/g, "").trim();
    return { explanation: data.deep ? cleaned.slice(0, 600) : cleaned.split("\n")[0].slice(0, 240) };
  });
