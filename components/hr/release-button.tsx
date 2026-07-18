"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";

export function ReleaseButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function release() {
    setErr(null);
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

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={release}
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
