"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";

/**
 * Raise a correction against a FINALIZED payroll row.
 *
 * Deliberately NOT an edit control — the finalized row is immutable, and the
 * confirm copy says so, so nobody clicks this expecting to change it in place.
 */
export function CreateAdjustmentButton({
  payrollId,
  period,
}: {
  payrollId: string;
  period: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function create() {
    setError(null);
    start(async () => {
      try {
        const res = await fetch("/api/hr/payroll/adjustment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payrollId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not create the adjustment.");
          setConfirming(false);
          router.refresh();
          return;
        }
        setConfirming(false);
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  if (confirming) {
    return (
      <div className="flex max-w-sm flex-col items-end gap-1.5">
        <p className="text-right text-[10px] text-text-muted">
          Creates a NEW draft row for {period} holding only the{" "}
          <span className="text-accent">difference</span>. The finalized payslip
          is not changed — it stays exactly as issued, and the adjustment goes
          through the same submit and finalize steps.
        </p>
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={create}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded border border-accent/40 px-2 py-1 text-xs text-accent hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {pending && <Loader2 size={12} className="animate-spin" />}
            Create adjustment
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text"
          >
            Cancel
          </button>
        </span>
        {error && <span className="text-right text-xs text-danger">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-muted hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <FilePlus2 size={12} /> Create adjustment
      </button>
      {error && <span className="max-w-[18rem] text-right text-xs text-danger">{error}</span>}
    </div>
  );
}
