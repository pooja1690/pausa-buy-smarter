import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MODEL = "claude-sonnet-4-20250514";

async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
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
      max_tokens: 200,
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
  const text = data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
  return text;
}

export const generateContextualQuestion = createServerFn({ method: "POST" })
  .inputValidator((d: { item: string }) => z.object({ item: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const system =
      "You generate ONE short, calm, non-judgmental question (max 12 words, one line, no preamble, no quotes) that helps someone decide whether to buy a specific item. Return only the question.";
    const question = await callClaude(system, `Item: ${data.item}`);
    return { question: question.replace(/^["']|["']$/g, "").split("\n")[0].slice(0, 140) };
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
    const text = await callClaude(system, prompt);
    return { explanation: text.replace(/^["']|["']$/g, "").split("\n")[0].slice(0, 240) };
  });
