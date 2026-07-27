"use client";

import { isDateOnly } from "@/lib/period";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent";

function todayStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/** Interview feedback — a person's rating and a person's words. */
export function InterviewFeedbackForm({
  applicationId,
  suggestedRound = 1,
}: {
  applicationId: string;
  /** Next round number, derived from existing feedback so the common case is
   *  pre-filled correctly and HR rarely has to think about it. */
  suggestedRound?: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rating, setRating] = useState("");
  const [notes, setNotes] = useState("");
  const [roundNumber, setRoundNumber] = useState(String(suggestedRound));
  const [interviewDate, setInterviewDate] = useState(todayStr());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save() {
    setError(null);
    setSaved(false);
    const r = Number.parseInt(rating, 10);
    if (!Number.isFinite(r) || r < 1 || r > 5) {
      setError("Choose a rating from 1 to 5.");
      return;
    }
    const round = Number.parseInt(roundNumber, 10);
    if (!Number.isFinite(round) || round < 1 || round > 20) {
      setError("Round must be a whole number from 1 to 20.");
      return;
    }
    if (!notes.trim()) {
      setError("Interview notes are required.");
      return;
    }
    if (!isDateOnly(interviewDate)) {
      setError("Choose the interview date.");
      return;
    }
    start(async () => {
      try {
        const res = await fetch("/api/hr/application/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applicationId,
            rating: r,
            notes: notes.trim(),
            interviewDate,
            roundNumber: round,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not save feedback.");
          return;
        }
        setSaved(true);
        setRating("");
        setNotes("");
        // Next entry most likely belongs to the following round.
        setRoundNumber(String(round + 1));
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Round
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={roundNumber}
            onChange={(e) => setRoundNumber(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Rating (1–5)
          </label>
          <select
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            className={inputClass}
          >
            <option value="">Select…</option>
            <option value="1">1 — Strong no</option>
            <option value="2">2 — No</option>
            <option value="3">3 — Borderline</option>
            <option value="4">4 — Yes</option>
            <option value="5">5 — Strong yes</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Interview date
          </label>
          <input
            type="date"
            value={interviewDate}
            onChange={(e) => setInterviewDate(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
          Notes
        </label>
        <textarea
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What you asked, how they answered, your recommendation…"
          className={inputClass}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-good">
            <CheckCircle2 size={13} /> Feedback added
          </span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {pending && <Loader2 size={13} className="animate-spin" />}
          Add feedback
        </button>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Free-text review notes on the application. Human-written, replaces previous. */
export function ReviewNotesForm({
  applicationId,
  initial,
}: {
  applicationId: string;
  initial: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      try {
        const res = await fetch("/api/hr/application/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ applicationId, action: "notes", reviewNotes: notes }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not save notes.");
          return;
        }
        setSaved(true);
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  return (
    <div className="space-y-2">
      <textarea
        rows={5}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Your own summary of this candidate's resume, written by you…"
        className={inputClass}
      />
      <p className="text-[10px] text-text-muted">
        Written by you, for your team. Nothing on this page is generated,
        extracted or summarised automatically — read the resume and write what
        you think.
      </p>
      <div className="flex items-center justify-end gap-2">
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-good">
            <CheckCircle2 size={13} /> Saved
          </span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {pending && <Loader2 size={13} className="animate-spin" />}
          Save notes
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
