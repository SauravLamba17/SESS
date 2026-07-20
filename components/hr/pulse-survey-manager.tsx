"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent";

export function PulseSurveyForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [question, setQuestion] = useState("");
  const [scaleMin, setMin] = useState("1");
  const [scaleMax, setMax] = useState("5");
  const [closesAt, setCloses] = useState("");
  const [error, setError] = useState<string | null>(null);

  function create() {
    setError(null);
    if (!question.trim()) {
      setError("Enter the question.");
      return;
    }
    const lo = Number.parseInt(scaleMin, 10);
    const hi = Number.parseInt(scaleMax, 10);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) {
      setError("Scale max must be greater than scale min.");
      return;
    }
    start(async () => {
      try {
        const res = await fetch("/api/hr/pulse-survey", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: question.trim(),
            scaleMin: lo,
            scaleMax: hi,
            closesAt: closesAt || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not create.");
          return;
        }
        setQuestion("");
        setCloses("");
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
          Question
        </label>
        <textarea
          rows={3}
          maxLength={300}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="I have the tools I need to do my job well."
          className={inputClass}
        />
        <p className="mt-1 text-[10px] text-text-muted">
          Phrase it as a statement people rate agreement with.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Scale min
          </label>
          <input
            type="number"
            min={0}
            max={9}
            value={scaleMin}
            onChange={(e) => setMin(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Scale max
          </label>
          <input
            type="number"
            min={1}
            max={10}
            value={scaleMax}
            onChange={(e) => setMax(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Closes (optional)
          </label>
          <input
            type="date"
            value={closesAt}
            onChange={(e) => setCloses(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </div>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <button
        type="button"
        onClick={create}
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        {pending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
        Create survey
      </button>
    </div>
  );
}

export function SurveyToggleButton({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    start(async () => {
      try {
        const res = await fetch("/api/hr/pulse-survey", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: active ? "close" : "reopen", id }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed");
          return;
        }
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-[10px] text-danger">{error}</span>}
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        {pending && <Loader2 size={12} className="animate-spin" />}
        {active ? "Close" : "Reopen"}
      </button>
    </span>
  );
}
