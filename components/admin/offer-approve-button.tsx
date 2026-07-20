"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

export function OfferApproveButton({
  id,
  candidateName,
  monthlyGross,
}: {
  id: string;
  candidateName: string;
  monthlyGross: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function approve() {
    setError(null);
    start(async () => {
      try {
        const res = await fetch("/api/admin/offer/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed");
          setConfirming(false);
          router.refresh();
          return;
        }
        setConfirming(false);
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  if (confirming) {
    return (
      <div className="flex max-w-sm flex-col items-end gap-1.5">
        <p className="text-right text-[10px] text-text-muted">
          Approving authorises HR to send {candidateName} an offer at ₹
          {monthlyGross}/month. HR still controls when it is sent.
        </p>
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={approve}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded border border-good/40 px-2 py-1 text-xs text-good hover:bg-good/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-good disabled:opacity-50"
          >
            {pending && <Loader2 size={12} className="animate-spin" />}
            Confirm approval
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
        {error && <span className="text-right text-xs text-danger">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1 rounded border border-good/40 px-2.5 py-1 text-xs text-good hover:bg-good/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-good"
      >
        <Check size={13} /> Approve
      </button>
      {error && <span className="max-w-xs text-right text-xs text-danger">{error}</span>}
    </div>
  );
}
