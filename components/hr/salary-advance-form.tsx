"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { inr } from "@/lib/payroll/format";

const inputClass =
  "w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm font-mono text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent";

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

export function SalaryAdvanceForm({
  employeeId,
  activeAdvance,
}: {
  employeeId: string;
  activeAdvance: {
    principalAmount: string;
    monthlyDeduction: string;
    remainingBalance: string;
  } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [principalAmount, setPrincipal] = useState("");
  const [monthlyDeduction, setMonthly] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (activeAdvance) {
    const paid =
      Number(activeAdvance.principalAmount) - Number(activeAdvance.remainingBalance);
    return (
      <div className="space-y-1 text-xs">
        <p className="text-text">
          Active advance · ₹{inr(activeAdvance.remainingBalance)} outstanding
        </p>
        <p className="font-mono text-[11px] text-text-muted">
          principal ₹{inr(activeAdvance.principalAmount)} · recovered ₹
          {inr(paid.toFixed(2))} · ₹{inr(activeAdvance.monthlyDeduction)}/month
        </p>
        <p className="text-[11px] text-text-muted">
          Recovered automatically on each payroll run, capped at the outstanding
          balance. On offboarding the full remaining balance is settled at once.
          A second advance can only be issued once this one closes.
        </p>
      </div>
    );
  }

  function issue() {
    setError(null);
    setSaved(false);
    if (!MONEY.test(principalAmount.trim()) || Number(principalAmount) <= 0) {
      setError("Principal must be an amount like 50000 or 50000.00.");
      return;
    }
    if (!MONEY.test(monthlyDeduction.trim()) || Number(monthlyDeduction) <= 0) {
      setError("Monthly deduction must be an amount greater than zero.");
      return;
    }
    if (Number(monthlyDeduction) > Number(principalAmount)) {
      setError("Monthly deduction cannot exceed the principal.");
      return;
    }
    start(async () => {
      try {
        const res = await fetch("/api/hr/salary-advance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId,
            principalAmount: principalAmount.trim(),
            monthlyDeduction: monthlyDeduction.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not issue the advance.");
          return;
        }
        setSaved(true);
        setPrincipal("");
        setMonthly("");
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  const months =
    MONEY.test(principalAmount.trim()) &&
    MONEY.test(monthlyDeduction.trim()) &&
    Number(monthlyDeduction) > 0
      ? Math.ceil(Number(principalAmount) / Number(monthlyDeduction))
      : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Principal amount
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={principalAmount}
            onChange={(e) => setPrincipal(e.target.value)}
            placeholder="50000.00"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Monthly deduction
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={monthlyDeduction}
            onChange={(e) => setMonthly(e.target.value)}
            placeholder="5000.00"
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-text-muted">
          {months ? `recovers over ~${months} month${months === 1 ? "" : "s"}` : " "}
        </span>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-good">
              <CheckCircle2 size={13} /> Issued
            </span>
          )}
          <button
            type="button"
            onClick={issue}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {pending && <Loader2 size={13} className="animate-spin" />}
            Issue advance
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
