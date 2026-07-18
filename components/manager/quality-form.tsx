"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

function todayStr(): string {
  const n = new Date();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${n.getFullYear()}-${m}-${d}`;
}

const field =
  "rounded border border-border bg-background px-2 py-1 font-mono text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function QualityForm({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = todayStr();
  const [date, setDate] = useState(today);
  const [defects, setDefects] = useState("");
  const [score, setScore] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    setMsg(null);
    const dc = Number(defects);
    const qs = Number(score);
    if (!date) return setMsg({ ok: false, text: "Date required" });
    if (!Number.isInteger(dc) || dc < 0)
      return setMsg({ ok: false, text: "Defects: int ≥ 0" });
    if (!Number.isFinite(qs) || qs < 0 || qs > 100)
      return setMsg({ ok: false, text: "Score: 0–100" });

    start(async () => {
      try {
        const res = await fetch("/api/manager/quality", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, date, defectCount: dc, qualityScore: qs }),
        });
        const data = await res.json();
        if (!res.ok) return setMsg({ ok: false, text: data.error ?? "Failed" });
        setMsg({ ok: true, text: "Saved" });
        setDefects("");
        setScore("");
        router.refresh();
      } catch {
        setMsg({ ok: false, text: "Network error" });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <input
          type="date"
          max={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={field}
          aria-label="Review date"
        />
        <input
          type="number"
          min={0}
          value={defects}
          onChange={(e) => setDefects(e.target.value)}
          placeholder="defects"
          className={`${field} w-20`}
          aria-label="Defect count"
        />
        <input
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={score}
          onChange={(e) => setScore(e.target.value)}
          placeholder="score"
          className={`${field} w-20`}
          aria-label="Quality score"
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
