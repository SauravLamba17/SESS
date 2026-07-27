"use client";

import { useState } from "react";

/**
 * The "validate range → fetch → blob → click-to-download → revoke" sequence,
 * owned once.
 *
 * Both report surfaces ran a byte-identical copy of this, including the
 * object-URL revoke that keeps the blob from leaking for the life of the tab.
 * A divergence there is invisible in review and only shows up as a browser
 * slowly growing — exactly the kind of thing that should exist once.
 *
 * `busy` is a STRING key rather than a boolean because the reports list has two
 * buttons per row (PDF and CSV) and has to spin only the one that was clicked.
 * The single-button caller passes a constant key and just checks for non-null.
 *
 * The range is validated as plain "YYYY-MM-DD" string comparison, which is
 * correct for that format and is what both callers already did — the server
 * re-validates properly via lib/reports/range.ts regardless.
 */
export function useFileDownload(start: string, end: string) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rangeValid = start !== "" && end !== "" && start <= end;

  async function download(opts: {
    /** Distinguishes concurrent buttons; any stable string. */
    key: string;
    url: string;
    filename: string;
    /** Shown when the API answers non-2xx without its own `error` field. */
    failMessage: string;
    networkMessage: string;
  }) {
    setError(null);
    if (!rangeValid) {
      setError("Choose a start date on or before the end date.");
      return;
    }
    setBusy(opts.key);
    try {
      const res = await fetch(opts.url);
      if (!res.ok) {
        // The API always answers { error, code } on failure.
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? opts.failMessage);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = opts.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(opts.networkMessage);
    } finally {
      setBusy(null);
    }
  }

  return { busy, error, rangeValid, download };
}
