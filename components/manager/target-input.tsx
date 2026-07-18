"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

export function TargetInput({
  employeeId,
  current,
}: {
  employeeId: string;
  current: number | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(current === null ? "" : String(current));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    setMsg(null);
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
      setMsg({ ok: false, text: "Whole number ≥ 0" });
      return;
    }
    start(async () => {
      try {
        const res = await fetch("/api/manager/target", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, targetUnits: n }),
        });
        const data = await res.json();
        if (!res.ok) {
          setMsg({ ok: false, text: data.error ?? "Failed" });
          return;
        }
        setMsg({ ok: true, text: "Saved" });
        router.refresh();
      } catch {
        setMsg({ ok: false, text: "Network error" });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="—"
          className="w-24 rounded border border-border bg-background px-2 py-1 text-right font-mono text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-xs font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {pending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Save
        </button>
      </div>
      {msg && (
        <span className={`text-xs ${msg.ok ? "text-good" : "text-danger"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
