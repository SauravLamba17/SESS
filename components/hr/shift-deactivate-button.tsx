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

  function toggle() {
    setErr(null);
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
      <button
        type="button"
        onClick={toggle}
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
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}
