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
  .inputValidator((d: { item: string }) => z.object({ item: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const system = `You generate exactly 5 short, calm, non-judgmental Yes/Maybe/No questions to help someone decide whether to buy a specific item. The questions MUST be highly tailored to the item — reference its actual use cases, context, and category. Avoid generic phrasing.

Rules:
- Each question must be answerable with Yes / Maybe / No.
- Each question max 14 words, one sentence, no preamble.
- Cover: real usage frequency, owning similar, alignment with goals/lifestyle, durability/long-term fit, and one item-specific consideration.
- Phrase so "Yes" is the positive (pro-buy) answer when possible. If "No" is the positive answer (e.g. "Do you already own something similar?"), that is fine — but be consistent.
- Output ONLY a JSON array of 5 strings. No prose, no keys, no markdown.`;

    const raw = await callClaude(system, `Item: ${data.item}\n\nReturn the JSON array now.`, 500);
    let parsed: unknown;
    try {
      parsed = extractJsonArray(raw);
    } catch {
      throw new Error("Failed to parse questions");
    }
    const arr = z.array(z.string().min(3).max(160)).length(5).parse(parsed);
    return { questions: arr.map((q) => q.replace(/^["']|["']$/g, "").trim()) };
  });

export const generateExplanation = createServerFn({ method: "POST" })
  .inputValidator((d: { item: string; decision: "BUY" | "WAIT" | "SKIP"; signals: string[] }) =>
    z
      .object({
        item: z.string().min(1).max(200),
        decision: z.enum(["BUY", "WAIT", "SKIP"]),
        signals: z.array(z.string().max(200)).max(10),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const system =
      "You write ONE short sentence (max 20 words) explaining a buying decision. Tone: calm, practical, non-judgmental. No preamble, no quotes, no emojis.";
    const prompt = `Item: ${data.item}\nDecision: ${data.decision}\nSignals: ${data.signals.join("; ")}\nWrite one sentence.`;
    const text = await callClaude(system, prompt, 200);
    return { explanation: text.replace(/^["']|["']$/g, "").split("\n")[0].slice(0, 240) };
  });
