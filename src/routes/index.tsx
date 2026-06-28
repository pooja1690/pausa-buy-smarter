import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, History, Loader2, Pause, Sparkles, Telescope } from "lucide-react";
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
import { generateQuestions, generateDeepQuestions, generateExplanation, classifyPurchase } from "@/lib/ai.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PAUSA — A calm sanity check before you buy" },
      {
        name: "description",
        content:
          "PAUSA asks a few quick questions and tells you to buy, wait, or skip. A mindful pause before every purchase.",
      },
      { property: "og:title", content: "PAUSA — Buy, Wait, or Skip" },
      {
        property: "og:description",
        content: "A calm 10-second sanity check before any purchase.",
      },
    ],
  }),
  component: PausaApp,
});

type Step =
  | "entry"
  | "preparing"
  | "questions"
  | "loading"
  | "result"
  | "deep-preparing"
  | "deep-questions"
  | "deep-loading"
  | "invest";

type Mode = "quick" | "deep";

const QUICK_COUNT = 4;

const FALLBACK_QUESTIONS = [
  "Will you use this often?",
  "Do you already have something similar?",
  "Would you still want this tomorrow?",
  "Is the price comfortable right now?",
];

const FALLBACK_DEEP = [
  "Are you buying this to solve a real, current need?",
  "Could you wait a week and still want it?",
  "Is there a gentler alternative you'd be happy with?",
];

function PausaApp() {
  const [step, setStep] = useState<Step>("entry");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  
  const [item, setItem] = useState("");
  const [price, setPrice] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Choice[]>([]);
  const [deepQuestions, setDeepQuestions] = useState<string[]>([]);
  const [deepIndex, setDeepIndex] = useState(0);
  const [deepAnswers, setDeepAnswers] = useState<Choice[]>([]);
  const [result, setResult] = useState<{
    decision: Decision;
    explanation: string;
    id: string;
    estUses: number;
    deep: boolean;
  } | null>(null);

  const fetchQuestions = useServerFn(generateQuestions);
  const fetchDeepQuestions = useServerFn(generateDeepQuestions);
  const fetchExplanation = useServerFn(generateExplanation);
  const fetchValidate = useServerFn(validateItem);

  const navigate = useNavigate();

  const INVALID_MSG =
    "Hmm, I need a real item or purchase to help you pause. Try something like \u201C$120 headphones,\u201D \u201Cnew shoes,\u201D or \u201CAmazon cart.\u201D";
  const VAGUE_MSG = "What are you thinking of buying, and about how much does it cost?";

  function localValidate(input: string): "ok" | "invalid" | "uncertain" {
    const t = input.trim();
    if (t.length < 3) return "invalid";
    const letters = t.replace(/[^a-zA-Z]/g, "");
    if (letters.length < 2) return "invalid";
    // symbols only / mostly
    if (!/[a-zA-Z]/.test(t)) return "invalid";
    const lower = t.toLowerCase();
    const profanity = ["fuck", "shit", "bitch", "asshole", "cunt", "dick"];
    const stripped = lower.replace(/[^a-z]/g, "");
    if (profanity.some((p) => stripped === p || stripped === p + "s" || stripped === p + "ing")) {
      return "invalid";
    }
    // keyboard smash: long run of consonants with no vowels
    const words = lower.split(/\s+/);
    const allGibberish = words.every((w) => {
      const clean = w.replace(/[^a-z]/g, "");
      if (clean.length < 3) return false;
      const hasVowel = /[aeiouy]/.test(clean);
      const longConsonantRun = /[bcdfghjklmnpqrstvwxz]{5,}/.test(clean);
      return !hasVowel || longConsonantRun;
    });
    if (allGibberish && words.length <= 2) return "invalid";
    // vague non-purchase single words
    const vagueBlock = new Set([
      "life", "sad", "whatever", "stuff", "things", "something", "anything",
      "nothing", "happy", "love", "money", "help", "idk", "ok", "okay",
    ]);
    if (words.length === 1 && vagueBlock.has(stripped)) return "invalid";
    return "uncertain";
  }

  async function startFlow() {
    const trimmed = item.trim();
    setValidationError(null);
    if (!trimmed) {
      setValidationError(INVALID_MSG);
      return;
    }
    const local = localValidate(trimmed);
    if (local === "invalid") {
      setValidationError(INVALID_MSG);
      return;
    }
    setValidating(true);
    let label: "valid" | "invalid" | "needs_more_detail" = "valid";
    try {
      const r = await fetchValidate({ data: { item: trimmed } });
      label = r.label;
    } catch {
      // on failure, allow through rather than block the user
      label = "valid";
    }
    setValidating(false);
    if (label === "invalid") {
      setValidationError(INVALID_MSG);
      return;
    }
    if (label === "needs_more_detail") {
      setValidationError(VAGUE_MSG);
      return;
    }
    setStep("preparing");
    setQIndex(0);
    setAnswers([]);
    setDeepQuestions([]);
    setDeepAnswers([]);
    setDeepIndex(0);
    let qs: string[] = FALLBACK_QUESTIONS;
    try {
      const r = await fetchQuestions({ data: { item: trimmed, count: QUICK_COUNT } });
      if (r.questions?.length === QUICK_COUNT) qs = r.questions;
    } catch {
      /* keep fallback */
    }
    setQuestions(qs);
    setStep("questions");
  }


  async function finalizeQuick(allAnswers: Choice[]) {
    setStep("loading");
    const { decision } = scoreAnswers(allAnswers);
    const priceNum = price ? parseFloat(price) : undefined;
    const signals = buildSignals(item.trim(), questions, allAnswers, priceNum);
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
    const estUses = estimateUses(allAnswers[0]);
    addRecord({
      id,
      item: item.trim(),
      price: priceNum,
      decision,
      explanation,
      createdAt: Date.now(),
      boughtAnyway: null,
      estUses,
      questions,
    });
    setResult({ decision, explanation, id, estUses, deep: false });
    setStep("result");
  }

  async function answer(choice: Choice) {
    const next = [...answers, choice];
    setAnswers(next);
    if (next.length < questions.length) {
      setQIndex(qIndex + 1);
      return;
    }
    await finalizeQuick(next);
  }

  async function startDeepWith(r: NonNullable<typeof result>) {
    const remaining = Math.max(1, Math.min(3, 8 - questions.length));
    setStep("deep-preparing");
    setDeepIndex(0);
    setDeepAnswers([]);
    const priceNum = price ? parseFloat(price) : undefined;
    const signals = buildSignals(item.trim(), questions, answers, priceNum);
    let dq: string[] = FALLBACK_DEEP.slice(0, remaining);
    try {
      const res = await fetchDeepQuestions({
        data: { item: item.trim(), decision: r.decision, signals, count: remaining as 1 | 2 | 3 },
      });
      if (res.questions?.length === remaining) dq = res.questions;
    } catch {
      /* keep fallback */
    }
    setDeepQuestions(dq);
    setStep("deep-questions");
  }

  async function startDeep() {
    if (!result) return;
    await startDeepWith(result);
  }

  async function answerDeep(choice: Choice) {
    const next = [...deepAnswers, choice];
    setDeepAnswers(next);
    if (next.length < deepQuestions.length) {
      setDeepIndex(deepIndex + 1);
      return;
    }
    if (!result) return;
    setStep("deep-loading");
    const allAnswers = [...answers, ...next];
    const allQuestions = [...questions, ...deepQuestions];
    const { decision } = scoreAnswers(allAnswers);
    const priceNum = price ? parseFloat(price) : undefined;
    const signals = buildSignals(item.trim(), allQuestions, allAnswers, priceNum);
    let explanation = fallbackExplanation(decision);
    try {
      const r = await fetchExplanation({
        data: { item: item.trim(), decision, signals, deep: true },
      });
      if (r.explanation) explanation = r.explanation;
    } catch {
      /* keep fallback */
    }
    updateRecord(result.id, { decision, explanation, questions: allQuestions });
    setResult({ ...result, decision, explanation, deep: true });
    setStep("result");
  }

  function reset() {
    setStep("entry");
    setItem("");
    setPrice("");
    setAnswers([]);
    setQuestions([]);
    setQIndex(0);
    setDeepAnswers([]);
    setDeepQuestions([]);
    setDeepIndex(0);
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

  function goBackDeep() {
    if (deepIndex === 0) {
      setStep("result");
      return;
    }
    setDeepAnswers(deepAnswers.slice(0, -1));
    setDeepIndex(deepIndex - 1);
  }

  return (
    <div className="pausa-screen">
      <header className="flex items-center justify-between pb-8">
        <Link to="/" onClick={reset} className="flex items-center gap-2 text-foreground">
          <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center">
            <Pause className="h-3.5 w-3.5 text-primary" strokeWidth={3} />
          </div>
          <span className="font-display text-lg font-semibold">PAUSA</span>
        </Link>
        <Link
          to="/history"
          className="flex items-center gap-1.5 text-sm font-light text-foreground hover:opacity-70 transition-colors"
        >
          <History className="h-4 w-4" />
          History
        </Link>
      </header>

      {step === "entry" && (
        <EntryScreen
          item={item}
          price={price}
          setItem={(v) => {
            setItem(v);
            if (validationError) setValidationError(null);
          }}
          setPrice={setPrice}
          onStart={startFlow}
          error={validationError}
          submitting={validating}
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

      {step === "deep-preparing" && <PreparingScreen item={item.trim()} deep />}

      {step === "deep-questions" && deepQuestions.length > 0 && (
        <QuestionScreen
          index={deepIndex}
          total={deepQuestions.length}
          prompt={deepQuestions[deepIndex]}
          onAnswer={answerDeep}
          onBack={goBackDeep}
          deep
        />
      )}

      {step === "deep-loading" && <LoadingScreen deep />}

      {step === "result" && result && (
        <ResultScreen
          item={item}
          price={price ? parseFloat(price) : undefined}
          decision={result.decision}
          explanation={result.explanation}
          estUses={result.estUses}
          deep={result.deep}
          onReset={reset}
          onHistory={() => navigate({ to: "/history" })}
          onInvest={() => setStep("invest")}
        />
      )}

      {step === "invest" && price && (
        <InvestScreen
          item={item.trim()}
          price={parseFloat(price)}
          onBack={() => setStep("result")}
        />
      )}
    </div>
  );
}

function fallbackExplanation(d: Decision): string {
  if (d === "BUY") return "This sounds genuinely useful and aligned with your life right now.";
  if (d === "WAIT") return "There's a little hesitation here. Try waiting 24 hours and see how it feels.";
  return "You already have what you need. This one can pass gently.";
}

/* ---------------- Toggle ---------------- */

function ModeToggle({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="relative grid grid-cols-2 p-1 rounded-full bg-[var(--border)]">
      <span
        className={cn(
          "absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-primary transition-transform duration-300 ease-out",
          mode === "deep" && "translate-x-[calc(100%+0.0rem)]",
        )}
      />
      {(["quick", "deep"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          className={cn(
            "relative z-10 py-2.5 text-sm font-medium rounded-full transition-colors",
            mode === m ? "text-white" : "text-foreground",
          )}
        >
          {m === "quick" ? "Quick" : "Deep"}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Entry ---------------- */

function EntryScreen({
  item,
  price,
  setItem,
  setPrice,
  onStart,
  error,
  submitting,
}: {
  item: string;
  price: string;
  setItem: (s: string) => void;
  setPrice: (s: string) => void;
  onStart: () => void;
  error: string | null;
  submitting: boolean;
}) {
  return (
    <main className="flex-1 flex flex-col justify-center fade-up">
      <p className="text-[11px] tracking-label text-foreground mb-4">
        Take a PAUSA
      </p>
      <h1 className="text-4xl leading-tight mb-10 font-semibold">What are you about to buy?</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onStart();
        }}
        className="space-y-4"
      >
        <div>
          <input
            autoFocus
            value={item}
            onChange={(e) => setItem(e.target.value)}
            placeholder="e.g. wireless headphones"
            aria-invalid={!!error}
            className={cn(
              "w-full rounded-[16px] bg-white border px-5 py-4 text-base text-foreground placeholder:text-border outline-none focus:ring-4 transition",
              error
                ? "border-[#b45a4a] focus:border-[#b45a4a] focus:ring-[#b45a4a]/10"
                : "border-border focus:border-primary/60 focus:ring-primary/10",
            )}
          />
          {error && (
            <p className="mt-2 px-1 text-sm font-light leading-snug" style={{ color: "#b45a4a" }}>
              {error}
            </p>
          )}
        </div>
        <div className="relative">
          <span className="absolute left-5 top-1/2 -translate-y-1/2 text-border">
            $
          </span>
          <input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="Price (optional)"
            className="w-full rounded-[16px] bg-white border border-border pl-9 pr-5 py-4 text-base text-foreground placeholder:text-border outline-none focus:border-primary/60 focus:ring-4 focus:ring-primary/10 transition"
          />
        </div>

        <p className="text-xs font-light pt-1 px-1 text-foreground">
          A few quick taps. Under 10 seconds.
        </p>


        <button
          type="submit"
          disabled={!item.trim() || submitting}
          className="mt-4 w-full rounded-full bg-primary text-primary-foreground py-4 text-base font-medium hover:bg-primary/90 active:scale-[0.99] transition disabled:opacity-40 disabled:active:scale-100 flex items-center justify-center gap-2"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking…
            </>
          ) : (
            "Help me decide"
          )}
        </button>
      </form>
    </main>
  );
}


/* ---------------- Preparing ---------------- */

function PreparingScreen({ item, deep = false }: { item: string; deep?: boolean }) {
  return (
    <main className="flex-1 flex flex-col items-center justify-center text-center fade-up">
      <div className="relative h-16 w-16 mb-6">
        <span className="absolute inset-0 rounded-full bg-primary/15 animate-ping" />
        <span className="absolute inset-2 rounded-full bg-primary/30" />
        <span className="absolute inset-5 rounded-full bg-primary" />
      </div>
      <p className="text-foreground/80 flex items-center gap-2 font-light">
        {deep ? <Telescope className="h-4 w-4 text-primary" /> : <Sparkles className="h-4 w-4 text-primary" />}
        {deep ? `Going deeper on ${item}…` : `Tailoring questions for ${item}…`}
      </p>
    </main>
  );
}

/* ---------------- Questions ---------------- */

const answerStyles: Record<number, string> = {
  0: "bg-primary text-white", // Yes
  1: "bg-wait text-foreground", // Maybe
  2: "bg-skip text-foreground", // No
};

function QuestionScreen({
  index,
  total,
  prompt,
  onAnswer,
  onBack,
  deep = false,
}: {
  index: number;
  total: number;
  prompt: string;
  onAnswer: (c: Choice) => void;
  onBack: () => void;
  deep?: boolean;
}) {
  return (
    <main className="flex-1 flex flex-col fade-up" key={`${deep ? "d" : "q"}-${index}`}>
      <div className="flex items-center gap-3 mb-12">
        <button
          onClick={onBack}
          className="h-9 w-9 rounded-full bg-white border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 flex items-center justify-center gap-2">
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-2 w-2 rounded-full transition-colors",
                i <= index ? "bg-primary" : "bg-border",
              )}
            />
          ))}
        </div>
        <div className="h-9 w-9" />
      </div>

      <div className="flex-1 flex flex-col">
        <p className="text-[11px] tracking-label text-muted-foreground mb-4 flex items-center gap-1.5">
          {deep ? <Telescope className="h-3 w-3" /> : null}
          {deep ? "Deep" : "Question"} {index + 1} of {total}
        </p>

        <h2 className="text-3xl leading-snug mb-14 font-regular text-foreground">{prompt}</h2>

        <div className="space-y-3 mt-auto">
          {ANSWER_OPTIONS.map((opt, i) => (
            <button
              key={opt}
              onClick={() => onAnswer(i as Choice)}
              className={cn(
                "w-full rounded-[16px] px-5 py-[18px] text-center text-base font-medium active:scale-[0.99] transition",
                answerStyles[i],
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

/* ---------------- Loading ---------------- */

function LoadingScreen({ deep = false }: { deep?: boolean }) {
  return (
    <main className="flex-1 flex flex-col items-center justify-center text-center fade-up">
      <div className="relative h-16 w-16 mb-6">
        <span className="absolute inset-0 rounded-full bg-primary/15 animate-ping" />
        <span className="absolute inset-2 rounded-full bg-primary/30" />
        <span className="absolute inset-5 rounded-full bg-primary" />
      </div>
      <p className="text-muted-foreground flex items-center gap-2 font-light">
        <Loader2 className="h-4 w-4 animate-spin" />
        {deep ? "Reflecting deeper…" : "Taking a breath…"}
      </p>
    </main>
  );
}

/* ---------------- Result ---------------- */

const decisionMeta: Record<
  Decision,
  { label: string; bg: string; text: string; cta: string; strike?: boolean }
> = {
  BUY: {
    label: "BUY",
    bg: "bg-buy",
    text: "text-white",
    cta: "Proceed gently",
  },
  WAIT: {
    label: "WAIT",
    bg: "bg-wait",
    text: "text-foreground",
    cta: "Remind me tomorrow",
  },
  SKIP: {
    label: "SKIP",
    bg: "bg-skip",
    text: "text-foreground",
    cta: "Save this decision",
    strike: true,
  },
};

function ResultScreen({
  item,
  price,
  decision,
  explanation,
  estUses,
  deep,
  onReset,
  onHistory,
  onInvest,
}: {
  item: string;
  price?: number;
  decision: Decision;
  explanation: string;
  estUses: number;
  deep: boolean;
  onReset: () => void;
  onHistory: () => void;
  onInvest: () => void;
}) {
  const meta = decisionMeta[decision];
  const cpu = price && estUses ? price / estUses : null;
  const ctaStyle =
    decision === "BUY"
      ? "bg-primary text-white"
      : decision === "WAIT"
        ? "bg-wait text-foreground"
        : "bg-foreground text-white";

  return (
    <main className="flex-1 flex flex-col fade-up">
      <p className="text-[11px] tracking-label text-muted-foreground mb-3 flex items-center gap-2">
        Your pausa
        {deep && (
          <span className="inline-flex items-center gap-1 text-primary normal-case tracking-normal font-light">
            <Telescope className="h-3 w-3" /> deep
          </span>
        )}
      </p>
      <h2 className="text-xl text-foreground/80 mb-8 truncate font-regular">{item}</h2>

      <div className={cn("rounded-[24px] p-8 mb-6", meta.bg, meta.text)}>
        <div className="flex items-baseline justify-between mb-5">
          <span
            className={cn(
              "font-display text-6xl font-semibold tracking-tight",
              meta.strike && "line-through decoration-2 decoration-foreground/40",
            )}
          >
            {meta.label}
          </span>
          {price ? (
            <span className="text-sm font-light opacity-80">${price.toFixed(2)}</span>
          ) : null}
        </div>
        <p className="text-base leading-relaxed font-regular whitespace-pre-line opacity-95">
          {explanation}
        </p>

        {cpu !== null && (
          <p className="mt-6 text-xs font-light opacity-75">
            Est. cost per use: <span className="font-medium">${cpu.toFixed(2)}</span>
            <span className="opacity-70"> · based on {estUses} uses</span>
          </p>
        )}
      </div>

      <div className="mt-auto space-y-3">
        <button
          onClick={onHistory}
          className={cn(
            "w-full rounded-full py-4 text-base font-medium active:scale-[0.99] transition",
            ctaStyle,
          )}
        >
          {meta.cta}
        </button>
        {price && decision !== "BUY" && (
          <button
            onClick={onInvest}
            className="w-full rounded-full bg-white border-2 py-4 text-base font-medium active:scale-[0.99] transition"
            style={{ borderColor: "#55614b", color: "#55614b" }}
          >
            Put it to work?
          </button>
        )}
        <button
          onClick={onReset}
          className="w-full rounded-full bg-transparent border border-border py-4 text-base font-light text-foreground hover:bg-white/50 transition"
        >
          Decide on something else
        </button>
      </div>
    </main>
  );
}

/* ---------------- Invest ---------------- */

function formatMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function InvestScreen({
  item,
  price,
  onBack,
}: {
  item: string;
  price: number;
  onBack: () => void;
}) {
  const y5 = price * Math.pow(1.1, 5);
  const y10 = price * Math.pow(1.1, 10);
  const y20 = price * Math.pow(1.1, 20);

  return (
    <main className="flex-1 flex flex-col fade-up">
      <div className="flex items-center mb-10">
        <button
          onClick={onBack}
          className="h-9 w-9 rounded-full bg-white border border-border flex items-center justify-center"
          aria-label="Back"
          style={{ color: "#44413c" }}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>

      <p className="text-[11px] tracking-label mb-3" style={{ color: "#d8cfc4" }}>
        What if you invested it
      </p>
      <h2 className="text-2xl font-semibold mb-2" style={{ color: "#44413c" }}>
        {item} · ${price.toFixed(2)}
      </h2>

      <h1 className="text-3xl leading-tight font-semibold mt-8 mb-6" style={{ color: "#44413c" }}>
        Your {item} could become {formatMoney(y20)}
      </h1>

      <div className="rounded-[16px] p-7 text-white space-y-7" style={{ backgroundColor: "#55614b" }}>
        <div>
          <p className="text-lg font-semibold">📈 S&P 500 Index Fund</p>
          <p className="text-sm font-light opacity-80 mt-1">
            Historical avg. 10% annual return
          </p>
        </div>

        <div>
          <p className="text-3xl font-semibold">{formatMoney(y5)}</p>
          <p className="text-sm font-light opacity-80 mt-1">in 5 years</p>
        </div>
        <div>
          <p className="text-4xl font-semibold">{formatMoney(y10)}</p>
          <p className="text-sm font-light opacity-80 mt-1">in 10 years</p>
        </div>
        <div>
          <p className="text-6xl font-semibold tracking-tight">{formatMoney(y20)}</p>
          <p className="text-sm font-light opacity-80 mt-2">in 20 years</p>
        </div>
      </div>

      <div className="mt-auto pt-10 space-y-5">
        <a
          href="https://www.acorns.com"
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-full py-4 text-base font-medium text-white text-center active:scale-[0.99] transition"
          style={{ backgroundColor: "#55614b" }}
        >
          Start investing
        </a>
        <p className="text-xs font-light text-center" style={{ color: "#d8cfc4" }}>
          Projections are estimates only. Past performance does not guarantee future results. This is not financial advice.
        </p>
      </div>
    </main>
  );
}
