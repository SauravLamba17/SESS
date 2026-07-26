"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PencilLine } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";

const inputClass =
  "rounded border border-border bg-background px-2 py-1 font-mono text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/**
 * Inline correction control for one attendance row.
 *
 * Times are HH:MM only — the row's DATE is never editable here. Moving a punch
 * to a different day is not a correction, it is a different record, and
 * allowing it would let one day's attendance quietly become another's.
 */
export function AttendanceCorrection({
  attendanceId,
  initialCheckIn,
  initialCheckOut,
  flagged,
}: {
  attendanceId: string;
  initialCheckIn: string | null; // "HH:MM"
  initialCheckOut: string | null;
  flagged: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [checkIn, setCheckIn] = useState(initialCheckIn ?? "");
  const [checkOut, setCheckOut] = useState(initialCheckOut ?? "");
  const [clearFlag, setClearFlag] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    start(async () => {
      try {
        const res = await fetch("/api/hr/attendance/correct", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attendanceId,
            checkIn: checkIn.trim() || undefined,
            checkOut: checkOut.trim() || undefined,
            clearFlag,
            reason: reason.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not correct the record.");
          return;
        }
        setOpen(false);
        setReason("");
        setClearFlag(false);
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <PencilLine size={11} />
        Correct
      </button>
    );
  }

  return (
    <div className="mt-1 w-full min-w-[16rem] rounded border border-accent/40 bg-accent/5 p-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-0.5 block text-[9px] uppercase tracking-wide text-text-muted">
            Check-in
          </label>
          <input
            type="time"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[9px] uppercase tracking-wide text-text-muted">
            Check-out
          </label>
          <input
            type="time"
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {flagged && (
        <label className="mt-2 flex items-center gap-1.5 text-[11px] text-text-muted">
          <input
            type="checkbox"
            checked={clearFlag}
            onChange={(e) => setClearFlag(e.target.checked)}
          />
          Clear the review flag (issue resolved)
        </label>
      )}

      <label className="mt-2 block text-[9px] uppercase tracking-wide text-text-muted">
        Reason (required)
      </label>
      <textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Employee forgot to clock out; confirmed 18:05 with supervisor."
        className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-xs text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />

      {error && (
        <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-danger">
          <StatusDot state="danger" />
          {error}
        </p>
      )}

      <p className="mt-1.5 text-[10px] text-text-muted">
        Lateness is recalculated from the new time against this employee&apos;s
        shift. Old and new values are written to the audit log.
      </p>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !reason.trim()}
          className="inline-flex items-center gap-1.5 rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-background hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {pending && <Loader2 size={11} className="animate-spin" />}
          Save correction
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
            setReason("");
          }}
          disabled={pending}
          className="text-[11px] text-text-muted hover:text-text"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
