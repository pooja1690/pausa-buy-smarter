import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, ArrowRight, History, Loader2, Sparkles, Telescope } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ANSWER_OPTIONS,
  addRecord,
  buildSignals,
  estimateUses,
  scoreAnswers,
  updateRecord,
  type Choice,
  type Decision,
} from "@/lib/pausa";
import { generateQuestions, generateDeepQuestions, generateExplanation } from "@/lib/ai.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pausa — A calm sanity check before you buy" },
      {
        name: "description",
        content:
          "Pausa asks five quick questions and tells you to buy, wait, or skip. A mindful pause before every purchase.",
      },
      { property: "og:title", content: "Pausa — Buy, Wait, or Skip" },
      {
        property: "og:description",
        content: "A calm 10-second sanity check before any purchase.",
      },
    ],
  }),
  component: PausaApp,
});

type Step = "entry" | "preparing" | "questions" | "loading" | "result";

const FALLBACK_QUESTIONS = [
  "Will you use this 30+ times?",
  "Do you already have something that does this?",
  "Would you still want this tomorrow?",
  "Does this align with your current goals?",
  "Is the price comfortable for you right now?",
];

function PausaApp() {
  const [step, setStep] = useState<Step>("entry");
  const [item, setItem] = useState("");
  const [price, setPrice] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Choice[]>([]);
  const [result, setResult] = useState<{
    decision: Decision;
    explanation: string;
    id: string;
    estUses: number;
  } | null>(null);

  const fetchQuestions = useServerFn(generateQuestions);
  const fetchExplanation = useServerFn(generateExplanation);

  const navigate = useNavigate();

  async function startFlow() {
    const trimmed = item.trim();
    if (!trimmed) return;
    setStep("preparing");
    setQIndex(0);
    setAnswers([]);
    let qs: string[] = FALLBACK_QUESTIONS;
    try {
      const r = await fetchQuestions({ data: { item: trimmed } });
      if (r.questions?.length === 5) qs = r.questions;
    } catch {
      /* keep fallback */
    }
    setQuestions(qs);
    setStep("questions");
  }

  async function answer(choice: Choice) {
    const next = [...answers, choice];
    setAnswers(next);
    if (next.length < questions.length) {
      setQIndex(qIndex + 1);
      return;
    }
    setStep("loading");
    const { decision } = scoreAnswers(next);
    const priceNum = price ? parseFloat(price) : undefined;
    const signals = buildSignals(item.trim(), questions, next, priceNum);
    let explanation = fallbackExplanation(decision);
    try {
      const r = await fetchExplanation({
        data: { item: item.trim(), decision, signals },
      });
      if (r.explanation) explanation = r.explanation;
    } catch {
      /* keep fallback */
    }
    const id = crypto.randomUUID();
    const estUses = estimateUses(next[0]);
    addRecord({
      id,
      item: item.trim(),
      price: priceNum,
      decision,
      explanation,
      createdAt: Date.now(),
      boughtAnyway: decision === "BUY" ? null : null,
      estUses,
      questions,
    });
    setResult({ decision, explanation, id, estUses });
    setStep("result");
  }

  function reset() {
    setStep("entry");
    setItem("");
    setPrice("");
    setAnswers([]);
    setQuestions([]);
    setQIndex(0);
    setResult(null);
  }

  function goBack() {
    if (qIndex === 0) {
      setStep("entry");
      return;
    }
    setAnswers(answers.slice(0, -1));
    setQIndex(qIndex - 1);
  }

  return (
    <div className="pausa-screen">
      <header className="flex items-center justify-between pb-6">
        <Link to="/" onClick={reset} className="flex items-center gap-2 text-foreground">
          <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center">
            <span className="h-2 w-2 rounded-full bg-primary" />
          </div>
          <span className="font-display text-lg">Pausa</span>
        </Link>
        <Link
          to="/history"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <History className="h-4 w-4" />
          History
        </Link>
      </header>

      {step === "entry" && (
        <EntryScreen
          item={item}
          price={price}
          setItem={setItem}
          setPrice={setPrice}
          onStart={startFlow}
        />
      )}

      {step === "preparing" && <PreparingScreen item={item.trim()} />}

      {step === "questions" && questions.length > 0 && (
        <QuestionScreen
          index={qIndex}
          total={questions.length}
          prompt={questions[qIndex]}
          onAnswer={answer}
          onBack={goBack}
        />
      )}

      {step === "loading" && <LoadingScreen />}

      {step === "result" && result && (
        <ResultScreen
          item={item}
          price={price ? parseFloat(price) : undefined}
          decision={result.decision}
          explanation={result.explanation}
          estUses={result.estUses}
          onReset={reset}
          onHistory={() => navigate({ to: "/history" })}
        />
      )}
    </div>
  );
}

function fallbackExplanation(d: Decision): string {
  if (d === "BUY") return "High usage and aligned with your goals.";
  if (d === "WAIT") return "This looks somewhat impulsive. Try waiting 24 hours.";
  return "You already own similar items and may not use this enough.";
}

/* ---------------- Entry ---------------- */

function EntryScreen({
  item,
  price,
  setItem,
  setPrice,
  onStart,
}: {
  item: string;
  price: string;
  setItem: (s: string) => void;
  setPrice: (s: string) => void;
  onStart: () => void;
}) {
  return (
    <main className="flex-1 flex flex-col justify-center fade-up">
      <p className="text-sm uppercase tracking-[0.18em] text-muted-foreground mb-3">
        Take a pausa
      </p>
      <h1 className="text-4xl leading-tight mb-8">What are you about to buy?</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onStart();
        }}
        className="space-y-3"
      >
        <input
          autoFocus
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder="e.g. wireless headphones"
          className="w-full rounded-2xl bg-card border border-border px-5 py-4 text-base outline-none focus:border-primary/60 focus:ring-4 focus:ring-primary/10 transition"
        />
        <div className="relative">
          <span className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground">
            $
          </span>
          <input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="Price (optional)"
            className="w-full rounded-2xl bg-card border border-border pl-9 pr-5 py-4 text-base outline-none focus:border-primary/60 focus:ring-4 focus:ring-primary/10 transition"
          />
        </div>

        <button
          type="submit"
          disabled={!item.trim()}
          className="mt-3 w-full rounded-2xl bg-primary text-primary-foreground py-4 text-base font-medium shadow-sm hover:bg-primary/90 active:scale-[0.99] transition disabled:opacity-40 disabled:active:scale-100"
        >
          Help me decide
        </button>
      </form>

      <p className="text-xs text-muted-foreground text-center mt-8 leading-relaxed">
        Five quick taps. A calm answer. Under 10 seconds.
      </p>
    </main>
  );
}

/* ---------------- Preparing ---------------- */

function PreparingScreen({ item }: { item: string }) {
  return (
    <main className="flex-1 flex flex-col items-center justify-center text-center fade-up">
      <div className="relative h-16 w-16 mb-6">
        <span className="absolute inset-0 rounded-full bg-primary/15 animate-ping" />
        <span className="absolute inset-2 rounded-full bg-primary/30" />
        <span className="absolute inset-5 rounded-full bg-primary" />
      </div>
      <p className="text-foreground/80 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        Tailoring questions for {item}…
      </p>
    </main>
  );
}

/* ---------------- Questions ---------------- */

function QuestionScreen({
  index,
  total,
  prompt,
  onAnswer,
  onBack,
}: {
  index: number;
  total: number;
  prompt: string;
  onAnswer: (c: Choice) => void;
  onBack: () => void;
}) {
  return (
    <main className="flex-1 flex flex-col fade-up" key={index}>
      <div className="flex items-center gap-3 mb-10">
        <button
          onClick={onBack}
          className="h-9 w-9 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 flex gap-1.5">
          {Array.from({ length: total }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i <= index ? "bg-primary" : "bg-border",
              )}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-3 flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" />
          Question {index + 1} of {total}
        </p>

        <h2 className="text-3xl leading-snug mb-12">{prompt}</h2>

        <div className="space-y-3 mt-auto">
          {ANSWER_OPTIONS.map((opt, i) => (
            <button
              key={opt}
              onClick={() => onAnswer(i as Choice)}
              className="w-full rounded-2xl bg-card border border-border px-5 py-4 text-left text-base font-medium hover:border-primary/50 hover:bg-primary-soft/40 active:scale-[0.99] transition flex items-center justify-between"
            >
              <span>{opt}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

/* ---------------- Loading ---------------- */

function LoadingScreen() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center text-center fade-up">
      <div className="relative h-16 w-16 mb-6">
        <span className="absolute inset-0 rounded-full bg-primary/15 animate-ping" />
        <span className="absolute inset-2 rounded-full bg-primary/30" />
        <span className="absolute inset-5 rounded-full bg-primary" />
      </div>
      <p className="text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Taking a breath…
      </p>
    </main>
  );
}

/* ---------------- Result ---------------- */

const decisionMeta: Record<
  Decision,
  { label: string; soft: string; on: string; cta: string; ring: string }
> = {
  BUY: {
    label: "BUY",
    soft: "bg-buy-soft",
    on: "bg-buy text-buy-foreground",
    cta: "Proceed confidently",
    ring: "text-buy",
  },
  WAIT: {
    label: "WAIT",
    soft: "bg-wait-soft",
    on: "bg-wait text-wait-foreground",
    cta: "Remind me tomorrow",
    ring: "text-wait",
  },
  SKIP: {
    label: "SKIP",
    soft: "bg-skip-soft",
    on: "bg-skip text-skip-foreground",
    cta: "Save decision",
    ring: "text-skip",
  },
};

function ResultScreen({
  item,
  price,
  decision,
  explanation,
  estUses,
  onReset,
  onHistory,
}: {
  item: string;
  price?: number;
  decision: Decision;
  explanation: string;
  estUses: number;
  onReset: () => void;
  onHistory: () => void;
}) {
  const meta = decisionMeta[decision];
  const cpu = price && estUses ? price / estUses : null;

  return (
    <main className="flex-1 flex flex-col fade-up">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
        Your pausa
      </p>
      <h2 className="text-xl text-foreground/80 mb-8 truncate">{item}</h2>

      <div className={cn("rounded-3xl p-8 mb-6", meta.soft)}>
        <div className="flex items-baseline justify-between mb-4">
          <span className={cn("font-display text-6xl tracking-tight", meta.ring)}>
            {meta.label}
          </span>
          {price ? (
            <span className="text-sm text-muted-foreground">${price.toFixed(2)}</span>
          ) : null}
        </div>
        <p className="text-base leading-relaxed text-foreground/85">{explanation}</p>

        {cpu !== null && (
          <p className="mt-5 text-xs text-muted-foreground">
            Est. cost per use: <span className="text-foreground">${cpu.toFixed(2)}</span>{" "}
            <span className="opacity-60">· based on {estUses} uses</span>
          </p>
        )}
      </div>

      <div className="mt-auto space-y-3">
        <button
          onClick={onHistory}
          className={cn(
            "w-full rounded-2xl py-4 text-base font-medium shadow-sm active:scale-[0.99] transition",
            meta.on,
          )}
        >
          {meta.cta}
        </button>
        <button
          onClick={onReset}
          className="w-full rounded-2xl bg-card border border-border py-4 text-base font-medium text-foreground hover:bg-muted transition"
        >
          Decide on something else
        </button>
      </div>
    </main>
  );
}
