"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Loader2, Trash2 } from "lucide-react";

/**
 * Delete / extend actions for a candidate past their retention review date.
 *
 * Deletion is irreversible and destroys real personal data, so it requires an
 * explicit confirm that names the candidate and spells out what goes.
 */
export function RetentionActions({
  candidateId,
  name,
  applications,
}: {
  candidateId: string;
  name: string;
  applications: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"idle" | "deleting" | "extending">("idle");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function post(body: Record<string, unknown>) {
    setError(null);
    start(async () => {
      try {
        const res = await fetch("/api/hr/candidate/retention", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId, ...body }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed");
          setMode("idle");
          router.refresh();
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

  const btn =
    "inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs focus:outline-none focus-visible:ring-2 disabled:opacity-50";

  if (mode === "deleting") {
    return (
      <div className="flex max-w-sm flex-col items-end gap-1.5">
        <p className="rounded border border-danger/40 bg-danger/10 px-2.5 py-2 text-right text-[10px] text-danger">
          Permanently delete all data for <strong>{name}</strong>: their profile,
          resume file, {applications} application{applications === 1 ? "" : "s"},
          interview feedback and any offer. This cannot be undone. An audit
          record of the deletion is kept.
        </p>
        <span className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => post({ action: "delete" })}
            className={`${btn} border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 focus-visible:ring-danger`}
          >
            {pending && <Loader2 size={12} className="animate-spin" />}
            Permanently delete
          </button>
          <button
            type="button"
            onClick={() => setMode("idle")}
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

  if (mode === "extending") {
    return (
      <div className="flex w-72 flex-col items-end gap-1.5">
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why must this data be kept longer? (required)"
          className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <span className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending || !reason.trim()}
            onClick={() => post({ action: "extend", reason: reason.trim() })}
            className={`${btn} border-accent/40 text-accent hover:bg-accent/10 focus-visible:ring-accent`}
          >
            {pending && <Loader2 size={12} className="animate-spin" />}
            Extend 180 days
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("idle");
              setReason("");
            }}
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
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMode("extending")}
          className={`${btn} border-border text-text-muted hover:border-accent hover:text-accent focus-visible:ring-accent`}
        >
          <CalendarPlus size={12} /> Extend
        </button>
        <button
          type="button"
          onClick={() => setMode("deleting")}
          className={`${btn} border-border text-text-muted hover:border-danger hover:text-danger focus-visible:ring-danger`}
        >
          <Trash2 size={12} /> Delete data
        </button>
      </div>
      {error && <span className="max-w-xs text-right text-xs text-danger">{error}</span>}
    </div>
  );
}
