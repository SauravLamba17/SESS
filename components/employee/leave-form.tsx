"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";
import {
  submitLeaveRequest,
  type LeaveFormState,
} from "@/app/employee/attendance/actions";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent";

function todayStr(): string {
  const n = new Date();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${n.getFullYear()}-${m}-${d}`;
}

export function LeaveForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<LeaveFormState | null>(null);
  const [success, setSuccess] = useState(false);

  const min = todayStr();

  // Client-side mirror of the server rules for immediate feedback.
  function clientValidate(): LeaveFormState["fieldErrors"] {
    const errs: LeaveFormState["fieldErrors"] = {};
    if (!startDate) errs.startDate = "Enter a valid start date.";
    if (!endDate) errs.endDate = "Enter a valid end date.";
    if (!reason.trim()) errs.reason = "A reason is required.";
    if (startDate && startDate < min)
      errs.startDate = "Start date cannot be in the past.";
    if (endDate && endDate < min)
      errs.endDate = "End date cannot be in the past.";
    if (startDate && endDate && endDate < startDate)
      errs.endDate = "End date cannot be before the start date.";
    return errs;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(false);
    const errs = clientValidate();
    if (errs && Object.keys(errs).length > 0) {
      setState({ ok: false, fieldErrors: errs });
      return;
    }
    startTransition(async () => {
      const res = await submitLeaveRequest({ startDate, endDate, reason });
      setState(res);
      if (res.ok) {
        setSuccess(true);
        setStartDate("");
        setEndDate("");
        setReason("");
        router.refresh(); // reload the request list below
      }
    });
  }

  const fe = state?.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="startDate"
            className="mb-1 block text-xs uppercase tracking-wide text-text-muted"
          >
            Start date
          </label>
          <input
            id="startDate"
            type="date"
            min={min}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputClass}
            aria-invalid={!!fe.startDate}
          />
          {fe.startDate && (
            <p className="mt-1 text-xs text-danger">{fe.startDate}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="endDate"
            className="mb-1 block text-xs uppercase tracking-wide text-text-muted"
          >
            End date
          </label>
          <input
            id="endDate"
            type="date"
            min={startDate || min}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={inputClass}
            aria-invalid={!!fe.endDate}
          />
          {fe.endDate && (
            <p className="mt-1 text-xs text-danger">{fe.endDate}</p>
          )}
        </div>
      </div>

      <div>
        <label
          htmlFor="reason"
          className="mb-1 block text-xs uppercase tracking-wide text-text-muted"
        >
          Reason
        </label>
        <textarea
          id="reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Brief reason for the leave request"
          className={inputClass}
          aria-invalid={!!fe.reason}
        />
        {fe.reason && <p className="mt-1 text-xs text-danger">{fe.reason}</p>}
      </div>

      {/* General (non-field) error */}
      {state && !state.ok && state.error && (
        <div className="flex items-center gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <StatusDot state="danger" />
          <span>{state.error}</span>
        </div>
      )}

      {/* Success confirmation */}
      {success && (
        <div
          className="flex items-center gap-2 rounded border border-good/40 bg-good/10 px-3 py-2 text-sm text-good"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 size={16} />
          <span>Leave request submitted — pending manager approval.</span>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
      >
        {pending && <Loader2 size={16} className="animate-spin" />}
        {pending ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}
