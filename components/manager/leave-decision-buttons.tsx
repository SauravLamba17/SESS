"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Loader2 } from "lucide-react";

export function LeaveDecisionButtons({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(decision: "APPROVE" | "REJECT") {
    setError(null);
    start(async () => {
      try {
        const res = await fetch("/api/manager/leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, decision }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed");
          router.refresh(); // 409 → list is stale; pull fresh state
          return;
        }
        router.refresh(); // moves the row into "recently handled"
      } catch {
        setError("Network error");
      }
    });
  }

  const btn =
    "inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs focus:outline-none focus-visible:ring-2 disabled:opacity-50";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {pending && <Loader2 size={14} className="animate-spin text-text-muted" />}
        <button
          type="button"
          onClick={() => decide("APPROVE")}
          disabled={pending}
          className={`${btn} border-good/40 text-good hover:bg-good/10 focus-visible:ring-good`}
        >
          <Check size={13} /> Approve
        </button>
        <button
          type="button"
          onClick={() => decide("REJECT")}
          disabled={pending}
          className={`${btn} border-danger/40 text-danger hover:bg-danger/10 focus-visible:ring-danger`}
        >
          <X size={13} /> Reject
        </button>
      </div>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
