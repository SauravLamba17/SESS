"use client";

import { Panel } from "@/components/ui/panel";

/**
 * On-screen preview of a report's computed result.
 *
 * ─── ONE RENDERER, NOT TEN ───────────────────────────────────────────────
 * Every report's result is the same SHAPE of thing: a handful of scalar
 * headline figures plus one or more arrays of flat rows. Headcount has
 * totalActive/netChange + byDepartment; Attendance has lateCount/latePct +
 * byEmployee/byDepartment; and so on for the other eight. So this walks the
 * result object rather than hard-coding a layout per report — scalars become
 * stat tiles, arrays become tables.
 *
 * That is deliberate, and it is the honest option: a bespoke preview per
 * report would be ten components that can each drift from what the PDF
 * actually prints. This renders the SAME `result` object the PDF and CSV are
 * built from, so a field the preview shows is by definition a field the
 * document contains.
 *
 * It also means a new report gets a working preview for free, with no UI work
 * — the failure mode is a plain-looking table, never a wrong number.
 *
 * Rows are capped (see MAX_ROWS): this is a preview, and the CSV beside it is
 * the full dataset. The cap is stated on screen rather than silently applied.
 */

/** Beyond this, the table is truncated and the omission is stated. */
const MAX_ROWS = 25;

/** "byDepartment" -> "By Department", "latePct" -> "Late Pct". */
function humanise(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

/** Render one cell/scalar the way the documents do: plainly, never invented. */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    // Keep decimals where the value genuinely has them (percentages, averages)
    // and group thousands where it does not (counts, rupees).
    return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
  }
  if (typeof v === "string") return v === "" ? "—" : v;
  return JSON.stringify(v);
}

type Row = Record<string, unknown>;

function isRowArray(v: unknown): v is Row[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => typeof x === "object" && x !== null && !Array.isArray(x))
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-surface-raised px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-text">{value}</div>
    </div>
  );
}

function DataTable({ label, rows }: { label: string; rows: Row[] }) {
  const columns = Object.keys(rows[0]);
  const shown = rows.slice(0, MAX_ROWS);
  const omitted = rows.length - shown.length;

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-text">{humanise(label)}</span>
        <span className="font-mono text-[10px] text-text-muted">
          {rows.length} row{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      {/* Wide tables scroll inside their own box rather than stretching the row. */}
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-text-muted">
              {columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                  {humanise(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c} className="whitespace-nowrap px-3 py-1.5 font-mono text-text-muted">
                    {formatValue(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {omitted > 0 && (
        <p className="mt-1 text-[10px] text-text-muted">
          Showing the first {MAX_ROWS} of {rows.length}. {omitted} more row
          {omitted === 1 ? " is" : "s are"} in the PDF and CSV.
        </p>
      )}
    </div>
  );
}

export interface ReportPreviewData {
  ok: true;
  report: string;
  title: string;
  scope: string;
  range: { startDate: string; endDate: string; days: number };
  result: unknown;
}

export function ReportPreview({
  data,
  children,
}: {
  data: ReportPreviewData;
  /** Download buttons, so the user can act without leaving the preview. */
  children?: React.ReactNode;
}) {
  const result = (data.result ?? {}) as Row;
  const entries = Object.entries(result);

  // Scalars (and small nested objects, flattened) become headline tiles;
  // arrays of rows become tables underneath.
  const tiles: { label: string; value: string }[] = [];
  const tables: { label: string; rows: Row[] }[] = [];

  for (const [key, value] of entries) {
    if (isRowArray(value)) {
      tables.push({ label: key, rows: value });
      continue;
    }
    if (Array.isArray(value)) {
      // Empty array, or an array of scalars — state it rather than drop it.
      tiles.push({
        label: humanise(key),
        value: value.length === 0 ? "none" : value.map(formatValue).join(", "),
      });
      continue;
    }
    if (value !== null && typeof value === "object") {
      // e.g. largestDepartment: { department, count } — flatten one level so
      // the figure is visible instead of "[object Object]".
      for (const [k2, v2] of Object.entries(value as Row)) {
        tiles.push({ label: `${humanise(key)} · ${humanise(k2)}`, value: formatValue(v2) });
      }
      continue;
    }
    tiles.push({ label: humanise(key), value: formatValue(value) });
  }

  return (
    <Panel className="mt-3 bg-surface-raised/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{data.title} — preview</p>
          <p className="mt-0.5 font-mono text-[10px] text-text-muted">
            {data.range.startDate} → {data.range.endDate} · {data.range.days} day
            {data.range.days === 1 ? "" : "s"} · {data.scope}
          </p>
        </div>
        {/* Download straight from here — no need to close and hunt for a button. */}
        {children && <div className="flex shrink-0 flex-wrap gap-2">{children}</div>}
      </div>

      {entries.length === 0 ? (
        <p className="mt-3 text-xs text-text-muted">
          This report returned no data for the selected period.
        </p>
      ) : (
        <>
          {tiles.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {tiles.map((t) => (
                <StatTile key={t.label} label={t.label} value={t.value} />
              ))}
            </div>
          )}
          {tables.map((t) => (
            <DataTable key={t.label} label={t.label} rows={t.rows} />
          ))}
        </>
      )}

      <p className="mt-3 border-t border-border pt-2 text-[10px] text-text-muted">
        These are the same figures the PDF and CSV contain — the server computes
        the report once and renders whichever format is requested.
      </p>
    </Panel>
  );
}
