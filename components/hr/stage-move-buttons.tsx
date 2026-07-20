"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowRight, X } from "lucide-react";

/** Forward path through the pipeline. HIRED is absent by design — it is set
 *  only by hire-conversion when an offer is accepted. */
const FORWARD: Record<string, string | null> = {
  APPLIED: "SCREENING",
  SCREENING: "INTERVIEW",
  INTERVIEW: "OFFER",
  OFFER: null, // from OFFER the next step is creating an offer, not a stage move
  HIRED: null,
  REJECTED: null,
};

export function StageMoveButtons({ id, stage }: { id: string; stage: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const next = FORWARD[stage] ?? null;
  const terminal = stage === "HIRED" || stage === "REJECTED";

  function move(to: string, rejectedReason?: string) {
    setError(null);
    start(async () => {
      try {
        const res = await fetch("/api/hr/application/stage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, stage: to, rejectedReason }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed");
          router.refresh();
          return;
        }
        setRejecting(false);
        setReason("");
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  if (terminal) return null;

  const btn =
    "inline-flex items-center gap-1 rounded border px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 disabled:opacity-50";

  return (
    <div className="flex flex-col items-end gap-1">
      {rejecting ? (
        <div className="flex w-64 flex-col items-end gap-1.5">
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for rejection (required)"
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          />
          <span className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending || !reason.trim()}
              onClick={() => move("REJECTED", reason.trim())}
              className={`${btn} border-danger/40 text-danger hover:bg-danger/10 focus-visible:ring-danger`}
            >
              {pending && <Loader2 size={12} className="animate-spin" />}
              Confirm reject
            </button>
            <button
              type="button"
              onClick={() => {
                setRejecting(false);
                setReason("");
              }}
              className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text"
            >
              Cancel
            </button>
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {pending && <Loader2 size={13} className="animate-spin text-text-muted" />}
          {next && (
            <button
              type="button"
              disabled={pending}
              onClick={() => move(next)}
              className={`${btn} border-good/40 text-good hover:bg-good/10 focus-visible:ring-good`}
            >
              Move to {next} <ArrowRight size={12} />
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => setRejecting(true)}
            className={`${btn} border-border text-text-muted hover:border-danger hover:text-danger focus-visible:ring-danger`}
          >
            <X size={12} /> Reject
          </button>
        </div>
      )}
      {error && <span className="max-w-xs text-right text-xs text-danger">{error}</span>}
    </div>
  );
}
