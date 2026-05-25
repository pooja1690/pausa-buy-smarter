import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadHistory, updateRecord, type DecisionRecord } from "@/lib/pausa";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History — PAUSA" },
      { name: "description", content: "Your past PAUSA decisions." },
    ],
  }),
  component: HistoryPage,
});

const pillClass: Record<DecisionRecord["decision"], string> = {
  BUY: "bg-primary text-white",
  WAIT: "bg-wait text-foreground",
  SKIP: "bg-skip text-foreground line-through decoration-foreground/40",
};

function HistoryPage() {
  const [records, setRecords] = useState<DecisionRecord[]>([]);

  useEffect(() => {
    setRecords(loadHistory());
  }, []);

  function setBought(id: string, value: boolean) {
    updateRecord(id, { boughtAnyway: value });
    setRecords(loadHistory());
  }

  const moneySaved = records
    .filter((r) => r.decision !== "BUY" && r.boughtAnyway === false && r.price)
    .reduce((s, r) => s + (r.price ?? 0), 0);

  const avoided = records.filter(
    (r) => r.decision !== "BUY" && r.boughtAnyway === false,
  ).length;

  return (
    <div className="pausa-screen">
      <header className="flex items-center gap-3 pb-8">
        <Link
          to="/"
          className="h-9 w-9 rounded-full bg-white border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-semibold">History</h1>
      </header>

      {records.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-8">
          <Stat label="Decisions avoided" value={avoided.toString()} />
          <Stat label="Money saved" value={`$${moneySaved.toFixed(0)}`} />
        </div>
      )}

      {records.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3 pb-8">
          {records.map((r) => (
            <li
              key={r.id}
              className="rounded-[16px] bg-white border border-border p-5 fade-up"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate text-foreground">{r.item}</p>
                  <p className="text-xs font-light text-muted-foreground mt-1">
                    {new Date(r.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                    {r.price ? ` · $${r.price.toFixed(2)}` : ""}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-[11px] font-medium tracking-wide",
                    pillClass[r.decision],
                  )}
                >
                  {r.decision}
                </span>
              </div>
              <p className="text-sm text-foreground/80 mt-4 leading-relaxed font-regular">
                {r.explanation}
              </p>

              {r.decision !== "BUY" && (
                <div className="mt-4 pt-4 border-t border-border">
                  {r.boughtAnyway === undefined || r.boughtAnyway === null ? (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-light text-muted-foreground">
                        Did you buy it anyway?
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setBought(r.id, true)}
                          className="rounded-full bg-[var(--border)] text-foreground px-4 py-1.5 text-xs font-medium hover:bg-muted"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setBought(r.id, false)}
                          className="rounded-full bg-primary text-white px-4 py-1.5 text-xs font-medium hover:opacity-90"
                        >
                          No
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs font-light text-muted-foreground">
                      {r.boughtAnyway
                        ? "You bought it anyway."
                        : "You stuck with the pause."}
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] bg-white border border-border p-5">
      <p className="text-3xl font-display font-semibold text-foreground">{value}</p>
      <p className="text-[11px] tracking-label text-muted-foreground mt-2">{label}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
      <div className="h-14 w-14 rounded-full bg-[var(--border)] flex items-center justify-center mb-4">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-foreground font-medium">No decisions yet</p>
      <p className="text-sm font-light text-muted-foreground mt-1">
        Your past pauses will appear here.
      </p>
      <Link
        to="/"
        className="mt-6 rounded-full bg-primary text-white px-6 py-3 text-sm font-medium"
      >
        Take a PAUSA
      </Link>
    </div>
  );
}
