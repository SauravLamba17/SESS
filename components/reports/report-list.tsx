"use client";

import { useState } from "react";
import { useFileDownload } from "./use-file-download";
import { ReportPreview, type ReportPreviewData } from "./report-preview";
import { ChevronDown, Download, Eye, Loader2, Sheet } from "lucide-react";
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
 * The reports list, shared by all three portals. Each row is a date range, a
 * preview and a download — deliberately not a report builder.
 *
 * The list it receives is already filtered to the caller's role by the page,
 * and the API re-checks on every request: this component hiding a card is
 * presentation, never enforcement. That applies to PREVIEW exactly as it does
 * to download — preview calls the same endpoint, which resolves scope before
 * it ever looks at `format`, so there is no second, weaker path to the data.
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
  const {
    busy,
    error,
    rangeValid,
    download: run,
    preview: fetchPreview,
  } = useFileDownload(start, end);

  /**
   * Which report's preview is expanded, and the data behind it.
   *
   * An inline expandable panel rather than a modal, on purpose: this codebase
   * has no shared Modal component, and its one existing modal
   * (components/employee/clock-in-widget.tsx) guards a BLOCKING action that
   * must be answered before anything else can happen. A preview blocks
   * nothing. Building an overlay — focus trap, escape handling, scroll lock —
   * for a read-only panel would be a new UI system with one consumer, while
   * expanding in place fits the list's existing divide-y rows and keeps the
   * shared date range and the other reports visible while you read.
   */
  const [openId, setOpenId] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, ReportPreviewData>>({});

  function url(report: ReportDef, format: "pdf" | "csv" | "json") {
    return `/api/reports/${report.id}?startDate=${start}&endDate=${end}&format=${format}`;
  }

  /**
   * One download path for both formats — same endpoint, same query, only
   * `format` differs. The server runs the report's single compute function
   * once and renders whichever format was asked for, so the CSV a user
   * downloads always matches the PDF beside it — and the preview above it.
   */
  function download(report: ReportDef, format: "pdf" | "csv") {
    return run({
      key: `${report.id}:${format}`,
      url: url(report, format),
      filename: `${report.id}-${start}-to-${end}.${format}`,
      failMessage: `Could not generate the ${report.title} report.`,
      networkMessage: "Network error while generating the report.",
    });
  }

  /**
   * Toggle the preview. Re-fetches each time it is opened rather than caching
   * across range changes: the dates above are shared by every row, so a cached
   * result could otherwise be shown beneath a range it was not computed for.
   */
  async function togglePreview(report: ReportDef) {
    if (openId === report.id) {
      setOpenId(null);
      return;
    }
    const result = await fetchPreview<ReportPreviewData>({
      key: `${report.id}:preview`,
      url: url(report, "json"),
      failMessage: `Could not preview the ${report.title} report.`,
      networkMessage: "Network error while previewing the report.",
    });
    // null means the hook already surfaced the failure — including the 403 a
    // role-scoped refusal produces, which is the same refusal the download
    // gets because it is the same check on the same endpoint.
    if (!result) return;
    setData((d) => ({ ...d, [report.id]: result }));
    setOpenId(report.id);
  }

  /** The two download buttons, rendered in the row AND inside the preview. */
  function DownloadButtons({ r }: { r: ReportDef }) {
    return (
      <>
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
      </>
    );
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
              onChange={(e) => {
                setStart(e.target.value);
                // An open preview was computed for the OLD range; close it
                // rather than leave stale figures on screen under new dates.
                setOpenId(null);
              }}
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
              onChange={(e) => {
                setEnd(e.target.value);
                setOpenId(null);
              }}
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
          {reports.map((r) => {
            const open = openId === r.id;
            return (
              <div key={r.id} className="px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
                      onClick={() => togglePreview(r)}
                      disabled={busy !== null || !rangeValid}
                      aria-expanded={open}
                      className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                    >
                      {busy === `${r.id}:preview` ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : open ? (
                        <ChevronDown size={13} />
                      ) : (
                        <Eye size={13} />
                      )}
                      {busy === `${r.id}:preview`
                        ? "Loading…"
                        : open
                          ? "Hide preview"
                          : "Preview"}
                    </button>
                    <DownloadButtons r={r} />
                  </div>
                </div>

                {open && data[r.id] && (
                  <ReportPreview data={data[r.id]}>
                    <DownloadButtons r={r} />
                  </ReportPreview>
                )}
              </div>
            );
          })}
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
