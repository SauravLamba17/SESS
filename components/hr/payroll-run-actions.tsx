"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, Send, Lock } from "lucide-react";

type Result = { ok: boolean; message: string; detail?: string[] } | null;

/**
 * Create / Submit / Finalize for one payroll period.
 *
 * `finalize` is rendered only on the Super Admin portal — the server route
 * enforces the SUPER_ADMIN check regardless of what this component renders.
 *
 * Buttons that are unavailable are DISABLED WITH A REASON, not hidden. Hiding
 * them made the two-step workflow invisible: with no rows yet, "Submit run for
 * approval" simply did not exist on screen, so there was nothing to tell HR
 * that creating a run is not the same as submitting it.
 */
export function PayrollRunActions({
  period,
  canCreate,
  canSubmit,
  canFinalize,
  createDisabledReason,
  submitDisabledReason,
}: {
  period: string;
  canCreate: boolean;
  canSubmit: boolean;
  canFinalize?: boolean;
  /** When given, an unavailable Create button is shown disabled with this
   *  explanation instead of being hidden. */
  createDisabledReason?: string;
  /** Likewise for Submit. */
  submitDisabledReason?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const [confirming, setConfirming] = useState(false);

  function post(url: string, describe: (d: Record<string, unknown>) => string) {
    setResult(null);
    start(async () => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ period }),
        });
        const data = await res.json();
        if (!res.ok) {
          const missing = Array.isArray(data.missingStructure)
            ? data.missingStructure.map(
                (m: { name: string; employeeCode: string }) =>
                  `${m.name} (${m.employeeCode})`,
              )
            : undefined;
          setResult({ ok: false, message: data.error ?? "Failed", detail: missing });
          router.refresh();
          return;
        }
        const missing = Array.isArray(data.missingStructure)
          ? data.missingStructure.map(
              (m: { name: string; employeeCode: string }) =>
                `${m.name} (${m.employeeCode})`,
            )
          : undefined;
        setResult({ ok: true, message: describe(data), detail: missing });
        router.refresh();
      } catch {
        setResult({ ok: false, message: "Network error" });
      }
    });
  }

  const btn =
    "inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 disabled:opacity-50";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {pending && <Loader2 size={14} className="animate-spin text-text-muted" />}

        {(canCreate || createDisabledReason) && (
          <button
            type="button"
            disabled={pending || !canCreate}
            title={!canCreate ? createDisabledReason : undefined}
            onClick={() =>
              post("/api/hr/payroll/run", (d) => `Created ${d.created} draft rows for ${period}.`)
            }
            className={`${btn} ${
              canCreate
                ? "border-accent/40 text-accent hover:bg-accent/10 focus-visible:ring-accent"
                : "cursor-not-allowed border-border text-text-muted"
            }`}
          >
            <Play size={13} /> Step 1 · Create payroll run
          </button>
        )}

        {(canSubmit || submitDisabledReason) && (
          <button
            type="button"
            disabled={pending || !canSubmit}
            title={!canSubmit ? submitDisabledReason : undefined}
            onClick={() =>
              post("/api/hr/payroll/submit", (d) => `Submitted ${d.submitted} rows for approval.`)
            }
            className={`${btn} ${
              canSubmit
                ? "border-good/40 text-good hover:bg-good/10 focus-visible:ring-good"
                : "cursor-not-allowed border-border text-text-muted"
            }`}
          >
            <Send size={13} /> Step 2 · Submit run for approval
          </button>
        )}

        {canFinalize && !confirming && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(true)}
            className={`${btn} border-danger/40 text-danger hover:bg-danger/10 focus-visible:ring-danger`}
          >
            <Lock size={13} /> Finalize &amp; lock
          </button>
        )}

        {canFinalize && confirming && (
          <span className="inline-flex items-center gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger">
            Finalizing {period} is permanent and cannot be undone.
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setConfirming(false);
                post(
                  "/api/admin/payroll/finalize",
                  (d) => `Finalized ${d.finalized} rows for ${period}. These are now immutable.`,
                );
              }}
              className="rounded bg-danger px-2 py-0.5 font-medium text-background disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="underline"
            >
              Cancel
            </button>
          </span>
        )}
      </div>

      {/* Why the greyed-out step is greyed out, stated in the open rather than
          hidden in a title attribute nobody hovers. */}
      {!canCreate && createDisabledReason && (
        <p className="text-[11px] text-text-muted">{createDisabledReason}</p>
      )}
      {!canSubmit && submitDisabledReason && (
        <p className="text-[11px] text-warn">{submitDisabledReason}</p>
      )}

      {result && (
        <div
          className={`rounded border px-3 py-2 text-xs ${
            result.ok
              ? "border-good/40 bg-good/10 text-good"
              : "border-danger/40 bg-danger/10 text-danger"
          }`}
          role="status"
          aria-live="polite"
        >
          <p>{result.message}</p>
          {result.detail && result.detail.length > 0 && (
            <p className="mt-1 text-text-muted">
              Cannot run payroll — no salary structure set:{" "}
              {result.detail.join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
