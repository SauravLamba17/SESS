"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

/**
 * Submit one anonymous pulse response.
 *
 * The form sends only { surveyId, ratingValue } — no identity of any kind.
 * The server takes the employee id from the session purely to write the
 * separate double-vote turnstile row, which never touches the rating.
 */
export function PulseRespondForm({
  surveyId,
  scaleMin,
  scaleMax,
}: {
  surveyId: string;
  scaleMin: number;
  scaleMax: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const points = Array.from({ length: scaleMax - scaleMin + 1 }, (_, i) => scaleMin + i);

  function submit(value: number) {
    setError(null);
    setSelected(value);
    start(async () => {
      try {
        const res = await fetch("/api/pulse/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ surveyId, ratingValue: value }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not record your response.");
          setSelected(null);
          router.refresh();
          return;
        }
        setDone(true);
        router.refresh();
      } catch {
        setError("Network error");
        setSelected(null);
      }
    });
  }

  if (done) {
    return (
      <div
        className="flex items-center gap-2 rounded border border-good/40 bg-good/10 px-3 py-2 text-sm text-good"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 size={15} />
        <span>Thanks — your response was recorded anonymously.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {points.map((p) => (
          <button
            key={p}
            type="button"
            disabled={pending}
            onClick={() => submit(p)}
            aria-label={`Rate ${p} out of ${scaleMax}`}
            className={`h-10 w-10 rounded border font-mono text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
              selected === p
                ? "border-accent bg-accent/20 text-accent"
                : "border-border text-text-muted hover:border-accent hover:text-accent"
            }`}
          >
            {p}
          </button>
        ))}
        {pending && <Loader2 size={15} className="animate-spin text-text-muted" />}
      </div>
      <p className="text-[10px] text-text-muted">
        {scaleMin} = strongly disagree · {scaleMax} = strongly agree. One
        response each, and it can&apos;t be changed afterwards — that&apos;s part
        of how responses stay unlinkable to you.
      </p>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
