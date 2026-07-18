"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

export function AcknowledgeButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function ack() {
    setErr(null);
    start(async () => {
      try {
        const res = await fetch("/api/employee/warning/acknowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        if (!res.ok) {
          setErr(data.error ?? "Failed");
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
      <button
        type="button"
        onClick={ack}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-text hover:border-good hover:text-good focus:outline-none focus-visible:ring-2 focus-visible:ring-good disabled:opacity-50"
      >
        {pending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        Acknowledge
      </button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}
