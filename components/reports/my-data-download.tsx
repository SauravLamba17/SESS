"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";

const inputClass =
  "rounded border border-border bg-background px-2.5 py-1.5 text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/**
 * Download button for the employee's own data export.
 *
 * Note what this does NOT send: any employee identifier. The request carries a
 * date range and nothing else — the server resolves whose data to return from
 * the session alone.
 */
export function MyDataDownload({
  defaultStart,
  defaultEnd,
}: {
  defaultStart: string;
  defaultEnd: string;
}) {
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeValid = start !== "" && end !== "" && start <= end;

  async function download() {
    setError(null);
    if (!rangeValid) {
      setError("Choose a start date on or before the end date.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/reports/my-data?startDate=${start}&endDate=${end}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not generate your data export.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `my-data-${start}-to-${end}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Network error while generating your export.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label
            htmlFor="mds"
            className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted"
          >
            From
          </label>
          <input
            id="mds"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="mde"
            className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted"
          >
            To
          </label>
          <input
            id="mde"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className={inputClass}
          />
        </div>
        <button
          type="button"
          onClick={download}
          disabled={busy || !rangeValid}
          className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          {busy ? "Preparing…" : "Download My Data"}
        </button>
      </div>

      {!rangeValid && (
        <p className="text-xs text-danger">
          The end date must be on or after the start date.
        </p>
      )}
      {error && (
        <p className="inline-flex items-center gap-2 text-xs text-danger">
          <StatusDot state="danger" />
          {error}
        </p>
      )}
    </div>
  );
}
