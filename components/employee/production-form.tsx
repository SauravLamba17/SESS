"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";
import {
  logProduction,
  type ProductionFormState,
} from "@/app/employee/production/actions";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent";

function todayStr(): string {
  const n = new Date();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${n.getFullYear()}-${m}-${d}`;
}

export function ProductionForm({ minDate }: { minDate: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = todayStr();
  const [date, setDate] = useState(today);
  const [units, setUnits] = useState("");
  const [state, setState] = useState<ProductionFormState | null>(null);
  const [success, setSuccess] = useState(false);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(false);
    const errs: ProductionFormState["fieldErrors"] = {};
    if (!date) errs.date = "Enter a valid date.";
    if (date && date > today) errs.date = "Date cannot be in the future.";
    if (minDate && date && date < minDate)
      errs.date = "Date is before your joining date.";
    const n = Number(units);
    if (units === "" || !Number.isInteger(n) || n < 0)
      errs.unitsProduced = "Units must be a whole number ≥ 0.";
    if (Object.keys(errs).length > 0) {
      setState({ ok: false, fieldErrors: errs });
      return;
    }
    start(async () => {
      const res = await logProduction({ date, unitsProduced: units });
      setState(res);
      if (res.ok) {
        setSuccess(true);
        setUnits("");
        router.refresh();
      }
    });
  }

  const fe = state?.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="pdate"
            className="mb-1 block text-xs uppercase tracking-wide text-text-muted"
          >
            Date
          </label>
          <input
            id="pdate"
            type="date"
            min={minDate || undefined}
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
            aria-invalid={!!fe.date}
          />
          {fe.date && <p className="mt-1 text-xs text-danger">{fe.date}</p>}
        </div>
        <div>
          <label
            htmlFor="units"
            className="mb-1 block text-xs uppercase tracking-wide text-text-muted"
          >
            Units produced
          </label>
          <input
            id="units"
            type="number"
            min={0}
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            placeholder="0"
            className={inputClass}
            aria-invalid={!!fe.unitsProduced}
          />
          {fe.unitsProduced && (
            <p className="mt-1 text-xs text-danger">{fe.unitsProduced}</p>
          )}
        </div>
      </div>

      {state && !state.ok && state.error && (
        <div className="flex items-center gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <StatusDot state="danger" />
          <span>{state.error}</span>
        </div>
      )}

      {success && (
        <div
          className="flex items-center gap-2 rounded border border-good/40 bg-good/10 px-3 py-2 text-sm text-good"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 size={16} />
          <span>Production logged.</span>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
      >
        {pending && <Loader2 size={16} className="animate-spin" />}
        {pending ? "Saving…" : "Log production"}
      </button>
    </form>
  );
}
