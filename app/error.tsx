"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, LayoutDashboard } from "lucide-react";

/**
 * Global error boundary.
 *
 * ─── NOTHING INTERNAL REACHES THE BROWSER ────────────────────────────────
 * No message, no stack, no cause — for EVERY role, Super Admin included. An
 * error string in this application can carry a database constraint, a file
 * path, or a fragment of somebody's salary row, and "the viewer is an admin"
 * is not a reason to render it into a page that may be screenshotted or
 * shared. The only thing shown is Next's `digest`, an opaque hash that
 * correlates this screen to the full server-side log entry.
 *
 * The real error is already written to the server log by Next itself; the
 * console.error below adds the digest and route so the two can be matched.
 * `error` here is the sanitised object Next passes to the client — in
 * production it deliberately carries only a digest, which is precisely the
 * behaviour this page depends on.
 * ─────────────────────────────────────────────────────────────────────────
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      `[error-boundary] digest=${error.digest ?? "none"} path=${
        typeof window !== "undefined" ? window.location.pathname : "unknown"
      }`,
      error,
    );
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded border border-border bg-surface p-6 shadow-panel sm:p-8">
        <div className="flex items-start gap-3">
          <AlertTriangle size={22} className="mt-0.5 shrink-0 text-danger" />
          <div>
            <h1 className="text-lg font-bold text-text">Something went wrong</h1>
            <p className="mt-1.5 text-sm text-text-muted">
              This page could not be loaded. Nothing you were working on has been
              lost. Try again, and if it keeps happening, contact your system
              administrator.
            </p>
          </div>
        </div>

        {error.digest && (
          <div className="mt-4 rounded border border-border bg-surface-raised/50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-text-muted">
              Reference code
            </p>
            <p className="mt-0.5 font-mono text-xs text-text">{error.digest}</p>
            <p className="mt-1 text-[11px] text-text-muted">
              Quote this when reporting the problem — it identifies this exact
              event in the server log.
            </p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RefreshCw size={15} />
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded border border-border px-4 py-2 text-sm text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <LayoutDashboard size={15} />
            Return to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
