"use client";

import { useState } from "react";
import { Download, Loader2, Sheet } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import type { ReportDef, ScopeMode } from "@/lib/reports/registry";

const inputClass =
  "rounded border border-border bg-background px-2.5 py-1.5 text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const SCOPE_LABEL: Record<Exclude<ScopeMode, "none">, string> = {
  org: "Organisation-wide",
  team: "Your direct reports",
  department: "Your department",
  // Self-service reports are filtered out of this list by reportsForRole();
  // the label exists so the map stays exhaustive over ScopeMode.
  self: "Your own records",
};

/**
 * The reports list, shared by all three portals. Each row is a date range and
 * a download button — deliberately not a report builder.
 *
 * The list it receives is already filtered to the caller's role by the page,
 * and the API re-checks on every request: this component hiding a card is
 * presentation, never enforcement.
 */
export function ReportList({
  reports,
  scopes,
  defaultStart,
  defaultEnd,
}: {
  reports: ReportDef[];
  scopes: Record<string, Exclude<ScopeMode, "none">>;
  defaultStart: string;
  defaultEnd: string;
}) {
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rangeValid = start !== "" && end !== "" && start <= end;

  /**
   * One download path for both formats — same endpoint, same query, only
   * `format` differs. The server runs the report's single compute function
   * once and renders whichever format was asked for, so the CSV a user
   * downloads always matches the PDF beside it.
   */
  async function download(report: ReportDef, format: "pdf" | "csv") {
    setError(null);
    if (!rangeValid) {
      setError("Choose a start date on or before the end date.");
      return;
    }
    setBusy(`${report.id}:${format}`);
    try {
      const res = await fetch(
        `/api/reports/${report.id}?startDate=${start}&endDate=${end}&format=${format}`,
      );
      if (!res.ok) {
        // The API always answers { error, code } on failure.
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Could not generate the ${report.title} report.`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${report.id}-${start}-to-${end}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Network error while generating the report.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader title="Reporting period" />
        <div className="flex flex-wrap items-end gap-4 p-4">
          <div>
            <label
              htmlFor="rs"
              className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted"
            >
              Start date
            </label>
            <input
              id="rs"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label
              htmlFor="re"
              className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted"
            >
              End date
            </label>
            <input
              id="re"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className={inputClass}
            />
          </div>
          <p className="pb-1.5 text-xs text-text-muted">
            Applies to every report below. Defaults to the current month; maximum
            2 years.
          </p>
        </div>
        {!rangeValid && (
          <p className="border-t border-border px-4 py-2 text-xs text-danger">
            The end date must be on or after the start date.
          </p>
        )}
      </Panel>

      {error && (
        <Panel className="flex items-center gap-3 px-4 py-3">
          <StatusDot state="danger" />
          <span className="text-sm text-danger">{error}</span>
        </Panel>
      )}

      <Panel>
        <PanelHeader title={`Available reports · ${reports.length}`} />
        <div className="divide-y divide-border">
          {reports.map((r) => (
            <div
              key={r.id}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 sm:max-w-2xl">
                <p className="text-sm text-text">{r.title}</p>
                <p className="mt-0.5 text-xs text-text-muted">{r.description}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-text-muted">
                  Scope: {SCOPE_LABEL[scopes[r.id]]}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => download(r, "pdf")}
                  disabled={busy !== null || !rangeValid}
                  className="inline-flex items-center gap-2 rounded bg-accent px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                >
                  {busy === `${r.id}:pdf` ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Download size={13} />
                  )}
                  {busy === `${r.id}:pdf` ? "Generating…" : "Download PDF"}
                </button>
                {/* CSV offered only where the registry says so — Board Summary
                    is a narrative page and has no CSV form. */}
                {r.csv && (
                  <button
                    type="button"
                    onClick={() => download(r, "csv")}
                    disabled={busy !== null || !rangeValid}
                    className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                  >
                    {busy === `${r.id}:csv` ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Sheet size={13} />
                    )}
                    {busy === `${r.id}:csv` ? "Generating…" : "Download CSV"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {reports.length === 0 && (
            <p className="px-4 py-8 text-sm text-text-muted">
              No reports are available for your role.
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
