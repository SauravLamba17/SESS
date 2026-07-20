"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { inr } from "@/lib/payroll/format";

const inputClass =
  "w-full rounded border border-border bg-background px-2 py-1 text-xs font-mono text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent";

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const SIGNED_MONEY = /^-?\d{1,10}(\.\d{1,2})?$/;

export interface EditableRow {
  id: string;
  pfEmployee: string;
  pfEmployer: string;
  esi: string;
  professionalTax: string;
  tds: string;
  tdsSource: string;
  bonus: string;
  basic: string;
  hra: string;
  specialAllowance: string;
  reimbursements: string;
  loanDeduction: string;
  /** Set when this row corrects a finalized row — switches the editor to
   *  delta mode: signed amounts, editable earnings, "additional amount" copy. */
  adjustmentFor?: { period: string; finalizedAt: string | null } | null;
}

const FIELDS = [
  ["pfEmployee", "PF (employee)"],
  ["pfEmployer", "PF (employer)"],
  ["esi", "ESI"],
  ["professionalTax", "Prof. Tax"],
  ["tds", "TDS"],
  ["bonus", "Bonus"],
] as const;

const EARNING_FIELDS = [
  ["basic", "Basic"],
  ["hra", "HRA"],
  ["specialAllowance", "Special Allow."],
] as const;

export function PayrollRowEditor({ row }: { row: EditableRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isAdjustment = !!row.adjustmentFor;
  const RE = isAdjustment ? SIGNED_MONEY : MONEY;

  const [v, setV] = useState<Record<string, string>>({
    pfEmployee: row.pfEmployee,
    pfEmployer: row.pfEmployer,
    esi: row.esi,
    professionalTax: row.professionalTax,
    tds: row.tds,
    bonus: row.bonus,
    ...(isAdjustment
      ? { basic: row.basic, hra: row.hra, specialAllowance: row.specialAllowance }
      : {}),
  });
  const [tdsSource, setTdsSource] = useState(row.tdsSource);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const allValid = Object.values(v).every((x) => RE.test(x.trim()));

  // Live preview mirroring the server's Decimal arithmetic. The server
  // recomputes authoritatively on save — this is display only.
  const n = (k: string) => (RE.test(v[k]?.trim() ?? "") ? Number(v[k]) : 0);
  const gross = isAdjustment
    ? n("basic") + n("hra") + n("specialAllowance")
    : Number(row.basic) + Number(row.hra) + Number(row.specialAllowance);
  const deductions =
    n("pfEmployee") + n("esi") + n("professionalTax") + n("tds") + Number(row.loanDeduction);
  const net = gross - deductions + n("bonus") + Number(row.reimbursements);

  function save() {
    setError(null);
    setSaved(false);
    if (!allValid) {
      setError(
        isAdjustment
          ? "Every amount must look like 1800, 1800.50 or -1800.50."
          : "Every amount must look like 1800 or 1800.50.",
      );
      return;
    }
    if (Number(v.tds) !== 0 && !tdsSource.trim()) {
      setError("Record where the TDS figure came from (e.g. \"CA-provided, FY2026-27\").");
      return;
    }
    start(async () => {
      try {
        const res = await fetch("/api/hr/payroll/row", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: row.id, ...v, tdsSource: tdsSource.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not save.");
          router.refresh(); // 409 → row was submitted/finalized under us
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
      {/* The single most important thing HR must not misread: whether these
          numbers REPLACE the original or ADD to it. */}
      {isAdjustment && (
        <div className="rounded border border-accent/40 bg-accent/10 px-3 py-2">
          <p className="text-xs font-medium text-accent">
            Additional amount — these figures are ADDED to the original payslip,
            not a replacement for it.
          </p>
          <p className="mt-1 text-[10px] text-text-muted">
            Enter only the difference. To pay ₹2,000 of arrears on Basic, enter
            Basic = 2000 and leave everything else at 0. To recover an
            overpayment, use a negative amount (e.g. -2000). The original{" "}
            {row.adjustmentFor?.period} payslip stays exactly as issued.
          </p>
        </div>
      )}

      {isAdjustment && (
        <div className="grid grid-cols-3 gap-2">
          {EARNING_FIELDS.map(([key, label]) => (
            <div key={key}>
              <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
                {label} <span className="normal-case text-accent">±</span>
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={v[key] ?? "0.00"}
                onChange={(e) => setV({ ...v, [key]: e.target.value })}
                className={inputClass}
                aria-invalid={!RE.test(v[key]?.trim() ?? "")}
              />
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {FIELDS.map(([key, label]) => (
          <div key={key}>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
              {label}
              {isAdjustment && <span className="normal-case text-accent"> ±</span>}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={v[key]}
              onChange={(e) => setV({ ...v, [key]: e.target.value })}
              className={inputClass}
              aria-invalid={!RE.test(v[key]?.trim() ?? "")}
            />
          </div>
        ))}
      </div>

      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
          TDS source — where this figure came from
        </label>
        <input
          type="text"
          value={tdsSource}
          onChange={(e) => setTdsSource(e.target.value)}
          placeholder="CA-provided, FY2026-27"
          className={inputClass.replace("font-mono", "")}
        />
        <p className="mt-1 text-[10px] text-text-muted">
          TDS is entered from the company&apos;s accountant. SESS never calculates
          it, and never applies a tax slab or exemption.
        </p>
      </div>

      {Number(row.loanDeduction) > 0 && (
        <p className="rounded border border-border bg-surface-raised/40 px-2.5 py-1.5 text-[10px] text-text-muted">
          Salary advance recovery of ₹{inr(Number(row.loanDeduction).toFixed(2))} is
          included in deductions. It is not editable here — the amount is derived
          from the outstanding balance, and finalizing this run reduces that
          balance by exactly this figure.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-text-muted">
          <span>gross ₹{inr(gross.toFixed(2))}</span>
          <span>− deductions ₹{inr(deductions.toFixed(2))}</span>
          {Number(row.loanDeduction) > 0 && (
            <span className="text-warn">
              (incl. loan ₹{inr(Number(row.loanDeduction).toFixed(2))})
            </span>
          )}
          {Number(row.reimbursements) > 0 && (
            <span className="text-accent">
              + reimb ₹{inr(Number(row.reimbursements).toFixed(2))}
            </span>
          )}
          <span className="text-text">
            {isAdjustment ? "= additional net " : "= net "}₹{inr(net.toFixed(2))}
          </span>
          {isAdjustment && net < 0 && (
            <span className="text-warn">recovery — employee owes this back</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-good">
              <CheckCircle2 size={13} /> Saved
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded bg-accent px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {pending && <Loader2 size={13} className="animate-spin" />}
            {isAdjustment ? "Save adjustment" : "Save row"}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
