"use client";

import { isDateOnly } from "@/lib/period";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { inr } from "@/lib/payroll/format";

const inputClass =
  "w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm font-mono text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent";

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

export function SalaryStructureForm({
  employeeId,
  initial,
  initialPfUan,
}: {
  employeeId: string;
  initial: {
    basic: string;
    hra: string;
    specialAllowance: string;
    effectiveFrom: string;
  } | null;
  initialPfUan?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [basic, setBasic] = useState(initial?.basic ?? "");
  const [hra, setHra] = useState(initial?.hra ?? "");
  const [specialAllowance, setSpecial] = useState(initial?.specialAllowance ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(initial?.effectiveFrom ?? "");
  const [pfUan, setPfUan] = useState(initialPfUan ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Preview total is computed on exact strings, mirroring the server's Decimal
  // gross (basic + hra + specialAllowance). Display only.
  const valid = [basic, hra, specialAllowance].every((v) => MONEY.test(v.trim()));
  const preview = valid
    ? (
        Math.round(
          (Number(basic) + Number(hra) + Number(specialAllowance)) * 100,
        ) / 100
      ).toFixed(2)
    : null;

  function save() {
    setError(null);
    setSaved(false);
    if (!valid) {
      setError("Basic, HRA and Special Allowance must be amounts like 30000 or 30000.50.");
      return;
    }
    if (Number(basic) <= 0) {
      setError("Basic must be greater than zero.");
      return;
    }
    if (!isDateOnly(effectiveFrom)) {
      setError("Choose an effective-from date.");
      return;
    }
    if (pfUan.trim() && !/^\d{12}$/.test(pfUan.trim())) {
      setError("PF UAN must be exactly 12 digits (or left blank).");
      return;
    }
    start(async () => {
      try {
        const res = await fetch("/api/hr/salary-structure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId,
            basic: basic.trim(),
            hra: hra.trim(),
            specialAllowance: specialAllowance.trim(),
            effectiveFrom,
            pfUan: pfUan.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not save.");
          return;
        }
        setSaved(true);
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Basic
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={basic}
            onChange={(e) => setBasic(e.target.value)}
            placeholder="30000.00"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            HRA
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={hra}
            onChange={(e) => setHra(e.target.value)}
            placeholder="15000.00"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Special Allow.
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={specialAllowance}
            onChange={(e) => setSpecial(e.target.value)}
            placeholder="5000.00"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Effective from
          </label>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
          PF UAN <span className="normal-case">(optional, 12 digits)</span>
        </label>
        <input
          type="text"
          inputMode="numeric"
          value={pfUan}
          onChange={(e) => setPfUan(e.target.value)}
          placeholder="100123456789"
          className={`${inputClass} max-w-[16rem]`}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-text-muted">
          {preview ? `Monthly gross ₹${inr(preview)}` : "Enter all three components"}
        </span>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-good">
              <CheckCircle2 size={13} /> Structure saved
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded bg-accent px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {pending && <Loader2 size={13} className="animate-spin" />}
            {initial ? "Update structure" : "Set structure"}
          </button>
        </div>
      </div>

      {/* Saving a structure does NOT create payroll. Saying so here is the
          difference between "I saved it" and "I ran payroll". */}
      {saved && (
        <p className="rounded border border-border bg-surface-raised/40 px-2.5 py-1.5 text-[11px] text-text-muted">
          Salary structure saved — this defines what the employee is paid, but it
          does not create a payslip. To actually pay them, go to{" "}
          <Link href="/hr/payroll" className="text-accent underline">
            Payroll &amp; Financials
          </Link>{" "}
          and run <span className="text-text">Step 1 · Create payroll run</span>{" "}
          for the period, then <span className="text-text">Step 2 · Submit</span>.
        </p>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
