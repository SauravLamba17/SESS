"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

const MODES = ["NONE", "IP_LOCK", "GEOFENCE", "BOTH"] as const;

async function saveToggle(key: string, value: string): Promise<string | null> {
  try {
    const res = await fetch("/api/admin/module-toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    const data = await res.json();
    return res.ok ? null : (data.error ?? "Could not save.");
  } catch {
    return "Network error";
  }
}

function Row({
  title,
  description,
  children,
  state,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  state?: { pending: boolean; saved: boolean; error: string | null };
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
      <div className="max-w-xl">
        <p className="text-sm text-text">{title}</p>
        <p className="mt-0.5 text-xs text-text-muted">{description}</p>
        {state?.error && <p className="mt-1 text-xs text-danger">{state.error}</p>}
      </div>
      <div className="flex items-center gap-2">
        {state?.pending && <Loader2 size={14} className="animate-spin text-text-muted" />}
        {state?.saved && !state.pending && (
          <span className="inline-flex items-center gap-1 text-xs text-good">
            <CheckCircle2 size={13} /> Saved
          </span>
        )}
        {children}
      </div>
    </div>
  );
}

function BoolToggle({
  settingKey,
  title,
  description,
  initial,
  onLabel = "Enabled",
  offLabel = "Disabled",
}: {
  settingKey: string;
  title: string;
  description: string;
  initial: boolean;
  onLabel?: string;
  offLabel?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function flip(next: boolean) {
    setError(null);
    setSaved(false);
    start(async () => {
      const err = await saveToggle(settingKey, String(next));
      if (err) return setError(err);
      setOn(next);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Row title={title} description={description} state={{ pending, saved, error }}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        disabled={pending}
        onClick={() => flip(!on)}
        className={`inline-flex items-center gap-2 rounded border px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
          on
            ? "border-good/40 bg-good/10 text-good"
            : "border-border bg-surface-raised text-text-muted"
        }`}
      >
        <span
          className={`inline-block h-2 w-2 rounded-full ${on ? "bg-good" : "bg-text-muted"}`}
        />
        {on ? onLabel : offLabel}
      </button>
    </Row>
  );
}

function ModeSelect({
  settingKey,
  title,
  description,
  initial,
}: {
  settingKey: string;
  title: string;
  description: string;
  initial: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function change(next: string) {
    setError(null);
    setSaved(false);
    start(async () => {
      const err = await saveToggle(settingKey, next);
      if (err) return setError(err);
      setMode(next);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Row title={title} description={description} state={{ pending, saved, error }}>
      <select
        value={mode}
        onChange={(e) => change(e.target.value)}
        disabled={pending}
        aria-label={title}
        className="rounded border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        {MODES.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </Row>
  );
}

export { BoolToggle, ModeSelect };
