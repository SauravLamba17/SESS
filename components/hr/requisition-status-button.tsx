"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Undo2 } from "lucide-react";

export function RequisitionStatusButton({
  id,
  status,
  title,
}: {
  id: string;
  status: "OPEN" | "ON_HOLD" | "CLOSED";
  title: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function send(body: Record<string, unknown>) {
    setError(null);
    start(async () => {
      try {
        const res = await fetch("/api/hr/requisition", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed");
          setConfirming(false);
          return;
        }
        setConfirming(false);
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  const btn =
    "inline-flex items-center gap-1 rounded border px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 disabled:opacity-50";

  if (status === "CLOSED") {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => send({ action: "status", id, status: "OPEN" })}
          className={`${btn} border-border text-text-muted hover:border-accent hover:text-accent focus-visible:ring-accent`}
        >
          {pending ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
          Reopen
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex max-w-xs flex-col items-end gap-1.5">
          <p className="text-right text-[10px] text-text-muted">
            Closing “{title}” removes it from the public career page and rejects
            any further applications, including from stale browser tabs.
          </p>
          <span className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => send({ action: "close", id })}
              className={`${btn} border-danger/40 text-danger hover:bg-danger/10 focus-visible:ring-danger`}
            >
              {pending && <Loader2 size={12} className="animate-spin" />}
              Confirm close
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text"
            >
              Cancel
            </button>
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`${btn} border-border text-text-muted hover:border-danger hover:text-danger focus-visible:ring-danger`}
        >
          <Lock size={12} /> Close
        </button>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
