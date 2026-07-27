"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";
import { useFileDownload } from "./use-file-download";

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
  const { busy, error, rangeValid, download: run } = useFileDownload(start, end);

  function download() {
    return run({
      key: "my-data",
      url: `/api/reports/my-data?startDate=${start}&endDate=${end}`,
      filename: `my-data-${start}-to-${end}.pdf`,
      failMessage: "Could not generate your data export.",
      networkMessage: "Network error while generating your export.",
    });
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
          disabled={busy !== null || !rangeValid}
          className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {busy !== null ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          {busy !== null ? "Preparing…" : "Download My Data"}
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
