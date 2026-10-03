"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Power } from "lucide-react";

export function ShiftActiveToggle({
  id,
  active,
  assignedCount,
}: {
  id: string;
  active: boolean;
  assignedCount: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  // Deactivating asks first (it hides the shift from every assignment
  // picker); reactivating is harmless and stays one click.
  const [confirming, setConfirming] = useState(false);

  function toggle() {
    setErr(null);
    setConfirming(false);
    start(async () => {
      try {
        const res = await fetch("/api/hr/shifts/deactivate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, active: !active }),
        });
        const data = await res.json();
        if (!res.ok) return setErr(data.error ?? "Failed");
        router.refresh();
      } catch {
        setErr("Network error");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex flex-col items-end gap-1.5" role="group" aria-label="Confirm deactivation">
          <span className="max-w-[18rem] text-right text-[10px] text-text-muted">
            Deactivate this shift? It disappears from assignment pickers
            {assignedCount > 0
              ? `; ${assignedCount} employee(s) keep it until reassigned.`
              : "."}{" "}
            Shifts are never hard-deleted — you can reactivate it.
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded border border-danger/40 px-2 py-1 text-xs text-danger hover:bg-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
            >
              {pending && <Loader2 size={12} className="animate-spin" />}
              Confirm
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
        </div>
      ) : (
      <button
        type="button"
        onClick={active ? () => setConfirming(true) : toggle}
        disabled={pending}
        title={
          active && assignedCount > 0
            ? `Deactivating hides this shift from assignment; ${assignedCount} employee(s) keep it until reassigned. Shifts are never hard-deleted.`
            : ""
        }
        className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        {pending ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
        {active ? "Deactivate" : "Reactivate"}
      </button>
      )}
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}
