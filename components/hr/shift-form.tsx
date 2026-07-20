"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Plus } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const labelClass = "mb-1 block text-xs uppercase tracking-wide text-text-muted";

/** Create (no id) or edit (with id) a shift. */
export function ShiftForm({
  initial,
}: {
  initial?: { id: string; name: string; startTime: string; endTime: string; gracePeriodMinutes: number };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(initial?.name ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? "09:30");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "17:30");
  const [grace, setGrace] = useState(String(initial?.gracePeriodMinutes ?? 0));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!name.trim()) return setMsg({ ok: false, text: "Name is required." });
    if (!HHMM.test(startTime) || !HHMM.test(endTime))
      return setMsg({ ok: false, text: "Times must be HH:MM (24h)." });
    const g = Number(grace);
    if (!Number.isInteger(g) || g < 0)
      return setMsg({ ok: false, text: "Grace must be a whole number ≥ 0." });

    start(async () => {
      try {
        const res = await fetch("/api/hr/shifts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: initial?.id,
            name: name.trim(),
            startTime,
            endTime,
            gracePeriodMinutes: g,
          }),
        });
        const data = await res.json();
        if (!res.ok) return setMsg({ ok: false, text: data.error ?? "Failed" });
        setMsg({ ok: true, text: initial ? "Shift updated." : "Shift created." });
        if (!initial) {
          setName("");
          setStartTime("09:30");
          setEndTime("17:30");
          setGrace("0");
        }
        router.refresh();
      } catch {
        setMsg({ ok: false, text: "Network error" });
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor={`sn-${initial?.id ?? "new"}`}>Name</label>
          <input id={`sn-${initial?.id ?? "new"}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Standard / Night / …" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`sg-${initial?.id ?? "new"}`}>Grace (min)</label>
          <input id={`sg-${initial?.id ?? "new"}`} type="number" min={0} value={grace} onChange={(e) => setGrace(e.target.value)} className={`${inputClass} font-mono`} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`ss-${initial?.id ?? "new"}`}>Start (HH:MM)</label>
          <input id={`ss-${initial?.id ?? "new"}`} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={`${inputClass} font-mono`} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`se-${initial?.id ?? "new"}`}>End (HH:MM)</label>
          <input id={`se-${initial?.id ?? "new"}`} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={`${inputClass} font-mono`} />
        </div>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${msg.ok ? "border-good/40 bg-good/10 text-good" : "border-danger/40 bg-danger/10 text-danger"}`} role="status">
          {msg.ok ? <CheckCircle2 size={16} /> : <StatusDot state="danger" />}
          <span>{msg.text}</span>
        </div>
      )}

      <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
        {pending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
        {initial ? "Save changes" : "Create shift"}
      </button>
    </form>
  );
}
