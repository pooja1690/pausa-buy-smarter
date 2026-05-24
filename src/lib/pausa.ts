export type Choice = 0 | 1 | 2; // 0 = best, 2 = worst
export type Decision = "BUY" | "WAIT" | "SKIP";

export interface DecisionRecord {
  id: string;
  item: string;
  price?: number;
  decision: Decision;
  explanation: string;
  createdAt: number;
  boughtAnyway?: boolean | null; // for WAIT/SKIP
  estUses?: number;
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

// Each answer is a Choice 0/1/2. Lower index = more positive signal.
// Score sums: 0 best (lots of "yes I'll use, aligned"), 10 worst.
// Q2 (already own similar) is inverted: 0 ("No") is positive.
// We normalize so that 0 = positive answer for all questions before storing.
export function scoreAnswers(answers: Choice[]): { score: number; decision: Decision } {
  // Each answer contributes 0, 1, or 2. Total range 0..10 for 5 questions.
  const total = answers.reduce<number>((s, a) => s + a, 0);
  let decision: Decision;
  if (total <= 3) decision = "BUY";
  else if (total <= 6) decision = "WAIT";
  else decision = "SKIP";
  return { score: total, decision };
}

export const FIXED_QUESTIONS = [
  {
    prompt: "Will you use this 30+ times?",
    options: ["Yes", "Maybe", "No"], // 0,1,2
  },
  {
    prompt: "Do you already own something similar?",
    options: ["No", "Kind of", "Yes"], // 0,1,2 (No is positive)
  },
  {
    prompt: "Would you still want this tomorrow?",
    options: ["Yes", "Not sure", "Probably not"],
  },
  {
    prompt: "Does this align with your current goals?",
    options: ["Yes", "Neutral", "No"],
  },
] as const;

export function estimateUses(answer0: Choice): number {
  // Q1 mapping: Yes=40, Maybe=15, No=5
  return answer0 === 0 ? 40 : answer0 === 1 ? 15 : 5;
}

export function buildSignals(item: string, answers: Choice[], price?: number): string[] {
  const labels = [
    `Usage 30+: ${FIXED_QUESTIONS[0].options[answers[0]]}`,
    `Owns similar: ${FIXED_QUESTIONS[1].options[answers[1]]}`,
    `Want tomorrow: ${FIXED_QUESTIONS[2].options[answers[2]]}`,
    `Goal aligned: ${FIXED_QUESTIONS[3].options[answers[3]]}`,
  ];
  if (price && price > 0) labels.push(`Price: $${price}`);
  labels.push(`Item: ${item}`);
  return labels;
}
