"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserMinus } from "lucide-react";
import { inr } from "@/lib/payroll/format";

function todayStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(
    n.getDate(),
  ).padStart(2, "0")}`;
}

type Settlement = {
  net: string;
  daysWorked: number;
  daysInMonth: number;
  loanDeduction: string;
  reimbursements: string;
} | null;

export function OffboardButton({ employeeId, name }: { employeeId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [lastWorkingDay, setLastWorkingDay] = useState(todayStr());
  const [done, setDone] = useState<{ settlement: Settlement; warning?: string } | null>(null);

  function offboard() {
    setErr(null);
    start(async () => {
      try {
        const res = await fetch("/api/hr/employee/offboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, lastWorkingDay }),
        });
        const data = await res.json();
        if (!res.ok) {
          setErr(data.error ?? "Failed");
          setConfirm(false);
          return;
        }
        setDone({ settlement: data.settlement ?? null, warning: data.warning });
        setConfirm(false);
        router.refresh();
      } catch {
        setErr("Network error");
      }
    });
  }

  if (done) {
    return (
      <div className="flex flex-col items-end gap-0.5 text-right">
        {done.warning ? (
          <span className="max-w-[18rem] text-xs text-warn">{done.warning}</span>
        ) : done.settlement ? (
          <>
            <span className="text-xs text-good">F&amp;F settlement raised (DRAFT)</span>
            <span className="font-mono text-[10px] text-text-muted">
              {done.settlement.daysWorked}/{done.settlement.daysInMonth} days · net ₹
              {inr(done.settlement.net)}
            </span>
            {Number(done.settlement.loanDeduction) > 0 && (
              <span className="font-mono text-[10px] text-text-muted">
                loan settled in full ₹{inr(done.settlement.loanDeduction)}
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-good">Offboarded</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {confirm ? (
        <div className="flex flex-col items-end gap-1.5">
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-text-muted">
            Last working day
            <input
              type="date"
              value={lastWorkingDay}
              onChange={(e) => setLastWorkingDay(e.target.value)}
              className="rounded border border-border bg-background px-2 py-1 font-mono text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
          <span className="max-w-[18rem] text-right text-[10px] text-text-muted">
            Raises a DRAFT full &amp; final settlement pro-rated to this date,
            including any outstanding advance in full.
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={offboard}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded border border-danger/40 px-2 py-1 text-xs text-danger hover:bg-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
            >
              {pending && <Loader2 size={12} className="animate-spin" />}
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirm(false)}
              disabled={pending}
              className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text"
            >
              Cancel
            </button>
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-muted hover:border-danger hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          aria-label={`Offboard ${name}`}
        >
          <UserMinus size={12} /> Offboard
        </button>
      )}
      {err && <span className="max-w-[16rem] text-right text-xs text-danger">{err}</span>}
    </div>
  );
}
