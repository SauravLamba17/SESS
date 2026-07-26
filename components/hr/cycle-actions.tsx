"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Calculator, Send } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";
import { formatComponentOutOf5 } from "@/lib/appraisal/display";

interface Incomplete {
  employeeId: string;
  name: string;
  missing: string[];
}

interface Scored {
  employeeId: string;
  name: string;
  finalScore: number;
  punctuality: {
    value: number;
    frequencyScore: number;
    severityScore: number;
    lateCount: number;
    totalPunchDays: number;
    avgLateMinutesAmongLateDays: number;
  };
}

export function CycleActions({ cycleId }: { cycleId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [allowMissingFeedback, setAllow] = useState(false);
  const [summary, setSummary] = useState<{
    total: number;
    complete: number;
    incomplete: Incomplete[];
    scored: Scored[];
  } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function compute() {
    setMsg(null);
    const res = await fetch("/api/hr/appraisal/compute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cycleId, allowMissingFeedback }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? "Compute failed" });
      return;
    }
    setSummary({
      total: data.total,
      complete: data.complete,
      incomplete: data.incomplete,
      scored: data.scored ?? [],
    });
  }

  function onCompute() {
    start(compute);
  }

  function onExclude(employeeId: string) {
    start(async () => {
      const res = await fetch("/api/hr/appraisal/exclude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleId, employeeId, excluded: true }),
      });
      const data = await res.json();
      if (!res.ok) return setMsg({ ok: false, text: data.error ?? "Exclude failed" });
      await compute(); // refresh completeness after exclusion
    });
  }

  function onPublish() {
    setMsg(null);
    start(async () => {
      const res = await fetch("/api/hr/appraisal/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleId }),
      });
      const data = await res.json();
      if (!res.ok) {
        const extra = data.blocking?.length ? ` (${data.blocking.length} not ready)` : "";
        setMsg({ ok: false, text: (data.error ?? "Publish failed") + extra });
        return;
      }
      setMsg({ ok: true, text: "Cycle published." });
      router.refresh();
    });
  }

  const canPublish = summary !== null && summary.incomplete.length === 0 && summary.total > 0;

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onCompute}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-text hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {pending ? <Loader2 size={13} className="animate-spin" /> : <Calculator size={13} />}
          Compute Scores
        </button>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={allowMissingFeedback}
            onChange={(e) => setAllow(e.target.checked)}
            className="accent-accent"
          />
          Allow missing feedback
        </label>
        <button
          type="button"
          onClick={onPublish}
          disabled={pending || !canPublish}
          title={canPublish ? "" : "Compute first; all employees must be complete or excluded"}
          className="inline-flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
        >
          <Send size={13} />
          Publish
        </button>
      </div>

      {summary && (
        <div className="rounded border border-border bg-surface-raised/40 p-3 text-xs">
          <div className="flex items-center gap-2">
            <StatusDot state={summary.incomplete.length === 0 ? "good" : "warn"} />
            <span className="text-text">
              {summary.complete} / {summary.total} complete
            </span>
          </div>
          {summary.incomplete.length > 0 && (
            <ul className="mt-2 space-y-1">
              {summary.incomplete.map((e) => (
                <li key={e.employeeId} className="flex items-center justify-between gap-3">
                  <span className="text-text-muted">
                    {e.name}
                    <span className="ml-2 font-mono text-danger">
                      missing: {e.missing.join(", ")}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onExclude(e.employeeId)}
                    disabled={pending}
                    className="rounded border border-border px-2 py-0.5 text-[11px] text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                  >
                    Exclude
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Punctuality breakdown per scored employee — pattern vs single incident */}
          {summary.scored.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-text-muted">
                Punctuality breakdown
              </div>
              <ul className="space-y-1">
                {summary.scored.map((s) => (
                  <li key={s.employeeId} className="flex flex-col gap-0.5">
                    <span className="text-text">
                      {s.name}{" "}
                      <span className="font-mono text-text-muted">
                        punctuality {formatComponentOutOf5(s.punctuality.value)}
                      </span>
                    </span>
                    <span className="font-mono text-[11px] text-text-muted">
                      Freq {formatComponentOutOf5(s.punctuality.frequencyScore)} (late{" "}
                      {s.punctuality.lateCount}/{s.punctuality.totalPunchDays}) · Sev{" "}
                      {formatComponentOutOf5(s.punctuality.severityScore)}
                      {s.punctuality.lateCount > 0
                        ? ` (avg ${s.punctuality.avgLateMinutesAmongLateDays.toFixed(0)}m late)`
                        : " (never late)"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {msg && (
        <p className={`text-xs ${msg.ok ? "text-good" : "text-danger"}`}>{msg.text}</p>
      )}
    </div>
  );
}
