"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

export function IdleThresholdForm({ current }: { current: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [seconds, setSeconds] = useState(String(current));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const n = Number.parseInt(seconds, 10);
  const valid = Number.isFinite(n) && n >= 60 && n <= 3600;

  function save() {
    setError(null);
    setSaved(false);
    if (!valid) {
      setError("Threshold must be a whole number of seconds between 60 and 3600.");
      return;
    }
    start(async () => {
      try {
        const res = await fetch("/api/admin/idle-threshold", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seconds: n }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not save.");
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
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <div>
          <label
            htmlFor="threshold"
            className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted"
          >
            Inactivity threshold (seconds)
          </label>
          <input
            id="threshold"
            type="number"
            min={60}
            max={3600}
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            className="w-32 rounded border border-border bg-background px-2.5 py-1.5 font-mono text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <span className="pb-2 font-mono text-xs text-text-muted">
          {valid ? `= ${(n / 60).toFixed(1)} minutes` : "—"}
        </span>
        {saved && (
          <span className="inline-flex items-center gap-1 pb-2 text-xs text-good">
            <CheckCircle2 size={13} /> Saved
          </span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={pending || !valid}
          className="mb-0.5 inline-flex items-center gap-2 rounded bg-accent px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {pending && <Loader2 size={13} className="animate-spin" />}
          Save threshold
        </button>
      </div>

      <p className="text-[11px] text-text-muted">
        Default is <span className="font-mono text-text">210s</span> (3.5 minutes).
        Agents pick up a change on their next heartbeat — within 15 minutes, with
        no reinstall. Lower values are more intrusive; consider carefully before
        going below the default.
      </p>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
