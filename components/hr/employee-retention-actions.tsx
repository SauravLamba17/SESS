"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, Loader2, ShieldOff } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";

const inputClass =
  "w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/**
 * Redact / Extend for one offboarded employee.
 *
 * Redaction is irreversible, so it is behind an explicit expand + a written
 * reason + a final confirm — the same shape as the candidate retention
 * controls, but the wording makes clear this ERASES IDENTIFIERS rather than
 * deleting the person's records.
 */
export function EmployeeRetentionActions({
  employeeId,
  name,
  redactedFields,
  preservedFields,
}: {
  employeeId: string;
  name: string;
  redactedFields: readonly string[];
  preservedFields: readonly string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"idle" | "redact" | "extend">("idle");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(action: "redact" | "extend") {
    setError(null);
    if (!reason.trim()) {
      setError("A written reason is required.");
      return;
    }
    start(async () => {
      try {
        const res = await fetch("/api/hr/employee/retention", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, employeeId, reason: reason.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "The action failed.");
          return;
        }
        setMode("idle");
        setReason("");
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  if (mode === "idle") {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode("redact")}
          className="inline-flex items-center gap-1.5 rounded border border-danger/40 px-2.5 py-1 text-xs text-danger hover:bg-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          <ShieldOff size={12} />
          Redact personal data
        </button>
        <button
          type="button"
          onClick={() => setMode("extend")}
          className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <CalendarClock size={12} />
          Extend retention
        </button>
      </div>
    );
  }

  return (
    <div
      className={`rounded border p-3 ${
        mode === "redact" ? "border-danger/40 bg-danger/5" : "border-border bg-surface-raised/40"
      }`}
    >
      {mode === "redact" ? (
        <>
          <p className="flex items-start gap-1.5 text-xs font-semibold text-danger">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            This is irreversible
          </p>
          <p className="mt-1.5 text-[11px] text-text-muted">
            <span className="text-text">Will be erased</span> on {name}&apos;s
            record: <span className="font-mono">{redactedFields.join(", ")}</span>.
          </p>
          <p className="mt-1 text-[11px] text-text-muted">
            <span className="text-text">Will be kept</span>:{" "}
            <span className="font-mono">{preservedFields.join(", ")}</span> — and
            every payroll, attendance, appraisal, warning and expense record,
            which stay complete and queryable. The employee record itself is
            never deleted.
          </p>
        </>
      ) : (
        <p className="text-xs text-text">
          Push {name}&apos;s redaction date out by one year. Use this only when
          there is a live legal or audit reason to hold their full record.
        </p>
      )}

      <label className="mt-2.5 block text-[10px] uppercase tracking-wide text-text-muted">
        Reason (required)
      </label>
      <textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={
          mode === "redact"
            ? "e.g. Retention period elapsed; routine scheduled redaction."
            : "e.g. Ongoing wage dispute — full record required until resolved."
        }
        className={`${inputClass} mt-1`}
      />

      {error && (
        <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-danger">
          <StatusDot state="danger" />
          {error}
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          disabled={pending || !reason.trim()}
          onClick={() => submit(mode)}
          className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium disabled:opacity-50 focus:outline-none focus-visible:ring-2 ${
            mode === "redact"
              ? "bg-danger text-background focus-visible:ring-danger"
              : "bg-accent text-background focus-visible:ring-accent"
          }`}
        >
          {pending && <Loader2 size={12} className="animate-spin" />}
          {mode === "redact" ? "Confirm redaction" : "Confirm extension"}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("idle");
            setReason("");
            setError(null);
          }}
          disabled={pending}
          className="rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
