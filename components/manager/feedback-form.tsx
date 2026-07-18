"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

const field =
  "rounded border border-border bg-background px-2 py-1 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function FeedbackForm({
  cycleId,
  employeeId,
  initialScore,
  initialComment,
}: {
  cycleId: string;
  employeeId: string;
  initialScore: number | null;
  initialComment: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [score, setScore] = useState(initialScore === null ? "" : String(initialScore));
  const [comment, setComment] = useState(initialComment);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    setMsg(null);
    const s = Number(score);
    if (!Number.isFinite(s) || s < 0 || s > 100)
      return setMsg({ ok: false, text: "Score 0–100" });
    start(async () => {
      try {
        const res = await fetch("/api/manager/appraisal/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cycleId, employeeId, feedbackScore: s, comment }),
        });
        const data = await res.json();
        if (!res.ok) return setMsg({ ok: false, text: data.error ?? "Failed" });
        setMsg({ ok: true, text: "Saved" });
        router.refresh();
      } catch {
        setMsg({ ok: false, text: "Network error" });
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <input
        type="number"
        min={0}
        max={100}
        step="0.1"
        value={score}
        onChange={(e) => setScore(e.target.value)}
        placeholder="score"
        aria-label="Feedback score 0-100"
        className={`${field} w-24 font-mono`}
      />
      <input
        type="text"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comment (optional)"
        aria-label="Feedback comment"
        className={`${field} flex-1`}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-xs font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {pending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Save
        </button>
        {msg && (
          <span className={`text-xs ${msg.ok ? "text-good" : "text-danger"}`}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}
