"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserMinus } from "lucide-react";

export function OffboardButton({ employeeId, name }: { employeeId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  function offboard() {
    setErr(null);
    start(async () => {
      try {
        const res = await fetch("/api/hr/employee/offboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setErr(data.error ?? "Failed");
          setConfirm(false);
          return;
        }
        router.refresh();
      } catch {
        setErr("Network error");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {confirm ? (
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
