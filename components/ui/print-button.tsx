"use client";

import { Printer } from "lucide-react";

/**
 * Opens the browser print dialog. The @media print rules in globals.css strip
 * navigation, filters and buttons so the page prints as clean tabular data.
 *
 * Deliberately NOT a PDF generator: real documents (payslips, Form 16, offer
 * letters) already have proper @react-pdf/renderer templates. This is for
 * on-screen reports that occasionally need to go on paper.
 */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent print:hidden"
    >
      <Printer size={13} /> {label}
    </button>
  );
}
