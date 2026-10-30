"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";

export function ReleaseButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  // Release can't be undone, so it takes a second, explicit click.
  const [confirming, setConfirming] = useState(false);

  function release() {
    setErr(null);
    setConfirming(false);
    start(async () => {
      try {
        const res = await fetch("/api/hr/warning/release", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        if (!res.ok) {
          setErr(data.error ?? "Failed");
          router.refresh();
          return;
        }
        router.refresh();
      } catch {
        setErr("Network error");
      }
    });
  }

  if (confirming)
    return (
      <div className="flex flex-col items-end gap-1.5 text-right">
        <span className="max-w-[16rem] text-xs text-text-muted">
          The employee will see this letter and be asked to acknowledge it. This can’t be undone.
        </span>
        <span className="inline-flex gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={release}
            className="inline-flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Send size={13} />
            Confirm release
          </button>
        </span>
      </div>
    );

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        {pending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
        Release
      </button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}
