export type Choice = 0 | 1 | 2;
export type Decision = "BUY" | "WAIT" | "SKIP";

export interface DecisionRecord {
  id: string;
  item: string;
  price?: number;
  decision: Decision;
  explanation: string;
  createdAt: number;
  boughtAnyway?: boolean | null;
  estUses?: number;
  questions?: string[];
}

const KEY = "pausa.history.v1";

export function loadHistory(): DecisionRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as DecisionRecord[];
  } catch {
    return [];
  }
}

export function saveHistory(records: DecisionRecord[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(records));
}

export function addRecord(r: DecisionRecord) {
  const all = loadHistory();
  all.unshift(r);
  saveHistory(all.slice(0, 200));
}

export function updateRecord(id: string, patch: Partial<DecisionRecord>) {
  const all = loadHistory();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...patch };
  saveHistory(all);
}

export const ANSWER_OPTIONS = ["Yes", "Maybe", "No"] as const;

export function scoreAnswers(answers: Choice[]): { score: number; decision: Decision } {
  const total = answers.reduce<number>((s, a) => s + a, 0);
  let decision: Decision;
  const max = answers.length * 2;
  const ratio = total / max;
  if (ratio <= 0.3) decision = "BUY";
  else if (ratio <= 0.6) decision = "WAIT";
  else decision = "SKIP";
  return { score: total, decision };
}

export function estimateUses(answer0: Choice): number {
  return answer0 === 0 ? 40 : answer0 === 1 ? 15 : 5;
}

export function buildSignals(
  item: string,
  questions: string[],
  answers: Choice[],
  price?: number,
): string[] {
  const labels = questions.map((q, i) => `${q} → ${ANSWER_OPTIONS[answers[i]]}`);
  if (price && price > 0) labels.push(`Price: $${price}`);
  labels.push(`Item: ${item}`);
  return labels;
}
