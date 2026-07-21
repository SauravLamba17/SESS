"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, ShieldCheck } from "lucide-react";

/**
 * Warning-letter acknowledgement via an ATTESTATION RECORD.
 *
 * The employee must type their own full name. The server re-checks it against
 * Employee.name and refuses on mismatch, so this is not merely a UI ceremony.
 *
 * NOT a legal digital signature — labelled as such here and everywhere else
 * these fields surface. See lib/attestation.ts.
 */
export function AcknowledgeButton({
  id,
  employeeName,
}: {
  id: string;
  /** Shown so the employee knows exactly what to type. */
  employeeName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function ack() {
    setErr(null);
    if (!typed.trim()) {
      setErr("Type your full name to complete the attestation.");
      return;
    }
    start(async () => {
      try {
        const res = await fetch("/api/employee/warning/acknowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, attestedName: typed.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
          setErr(data.error ?? "Failed");
          return;
        }
        setOpen(false);
        setTyped("");
        router.refresh();
      } catch {
        setErr("Network error");
      }
    });
  }

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-text hover:border-good hover:text-good focus:outline-none focus-visible:ring-2 focus-visible:ring-good"
        >
          <Check size={13} /> Acknowledge
        </button>
      </div>
    );
  }

  return (
    <div className="w-72 rounded border border-border bg-surface-raised/40 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <ShieldCheck size={13} className="text-accent" />
        <span className="text-xs font-medium text-text">Attestation Record</span>
      </div>
      <p className="mb-2 text-[10px] text-text-muted">
        (internal record, not a legal digital signature)
      </p>

      <label htmlFor={`att-${id}`} className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
        Type your full name to acknowledge
      </label>
      <input
        id={`att-${id}`}
        type="text"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && ack()}
        placeholder={employeeName}
        autoComplete="off"
        className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <p className="mt-1 text-[10px] text-text-muted">
        Must match your name on record: <span className="text-text">{employeeName}</span>.
        Your name, the time, and your IP address are recorded.
      </p>

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTyped("");
            setErr(null);
          }}
          disabled={pending}
          className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={ack}
          disabled={pending || !typed.trim()}
          className="inline-flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {pending && <Loader2 size={12} className="animate-spin" />}
          Attest &amp; acknowledge
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
    </div>
  );
}
