import Link from "next/link";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { StatusDot, type StatusState } from "@/components/ui/status-dot";
import { AttendanceCorrection } from "@/components/hr/attendance-correction";
import { db } from "@/lib/db";
import { parseRange, currentMonthRange, ymd } from "@/lib/reports/range";
import { ErrorPanel } from "@/components/ui/notice";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Hours after check-in beyond which a still-open row is treated as a forgotten
 * clock-out rather than someone still working. Longer than the longest shift
 * (18:00–03:00 is 9h) with room for overtime, so a genuine long day is not
 * flagged.
 */
const FORGOTTEN_CHECKOUT_HOURS = 14;

type View = "all" | "exceptions";

function hhmm(d: Date | null): string | null {
  if (!d) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmt(d: Date | null): string {
  return hhmm(d) ?? "—";
}

async function load(params: {
  startDate?: string;
  endDate?: string;
  view: View;
  page: number;
}) {
  // Default to the current month — never an unbounded fetch of all history.
  const parsed =
    params.startDate && params.endDate
      ? parseRange(params.startDate, params.endDate)
      : ({ ok: true as const, range: currentMonthRange() });
  if (!parsed.ok) {
    return {
      error: parsed.message,
      range: currentMonthRange(),
      rows: [],
      total: 0,
      stats: { punches: 0, late: 0, flagged: 0, openRows: 0 },
    };
  }
  const range = parsed.range;
  const forgottenBefore = new Date(Date.now() - FORGOTTEN_CHECKOUT_HOURS * 3_600_000);

  try {
    const inRange = { gte: range.start, lt: range.endExclusive };

    // The exceptions view is the union of two distinct problems: a punch that
    // failed IP/geofence validation, and a row still open long after check-in.
    const exceptionWhere = {
      date: inRange,
      OR: [
        { flaggedForReview: true },
        { AND: [{ checkOut: null }, { checkIn: { not: null, lt: forgottenBefore } }] },
      ],
    };
    const where = params.view === "exceptions" ? exceptionWhere : { date: inRange };

    const [rows, total, punches, late, flagged, openRows] = await Promise.all([
      db.attendance.findMany({
        where,
        select: {
          id: true,
          date: true,
          checkIn: true,
          checkOut: true,
          channel: true,
          lateFlag: true,
          lateMinutes: true,
          flaggedForReview: true,
          reviewReason: true,
          employee: {
            select: {
              id: true,
              name: true,
              employeeCode: true,
              department: true,
              active: true,
              shift: { select: { name: true, startTime: true, endTime: true } },
            },
          },
        },
        orderBy: [{ date: "desc" }, { checkIn: "desc" }],
        skip: (params.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      db.attendance.count({ where }),
      // Aggregates over the RANGE, computed by the database — never by
      // fetching rows and counting them here.
      db.attendance.count({ where: { date: inRange } }),
      db.attendance.count({ where: { date: inRange, lateFlag: true } }),
      db.attendance.count({ where: { date: inRange, flaggedForReview: true } }),
      db.attendance.count({
        where: { date: inRange, checkOut: null, checkIn: { not: null, lt: forgottenBefore } },
      }),
    ]);

    return { error: null, range, rows, total, stats: { punches, late, flagged, openRows } };
  } catch (err) {
    console.error("[hr/attendance] failed:", err);
    return {
      error: "Attendance data is unavailable right now.",
      range,
      rows: [],
      total: 0,
      stats: { punches: 0, late: 0, flagged: 0, openRows: 0 },
    };
  }
}

export default async function AttendanceOversight({
  searchParams,
}: {
  searchParams: { startDate?: string; endDate?: string; view?: string; page?: string };
}) {
  const view: View = searchParams.view === "exceptions" ? "exceptions" : "all";
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const { error, range, rows, total, stats } = await load({
    startDate: searchParams.startDate,
    endDate: searchParams.endDate,
    view,
    page,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({
      startDate: range.startLabel,
      endDate: range.endLabel,
      view,
      ...over,
    });
    return `/hr/attendance?${p.toString()}`;
  };

  const input =
    "rounded border border-border bg-background px-2.5 py-1.5 text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <>
      <PageHeader
        title="Attendance Oversight"
        description="Organisation-wide attendance for a date range, with exception handling and manual correction. Every correction is written to the audit log."
      />

      {error && (
        <ErrorPanel>{error}</ErrorPanel>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Punches in range" value={stats.punches} state="good" status={`${range.days} days`} />
        <StatCard
          label="Late arrivals"
          value={stats.late}
          state={stats.late > 0 ? "warn" : "good"}
          status={stats.punches > 0 ? `${Math.round((stats.late / stats.punches) * 100)}% of punches` : "—"}
        />
        <StatCard
          label="Flagged for review"
          value={stats.flagged}
          state={stats.flagged > 0 ? "danger" : "good"}
          status="IP / geofence"
        />
        <StatCard
          label="Missing clock-out"
          value={stats.openRows}
          state={stats.openRows > 0 ? "warn" : "good"}
          status={`open > ${FORGOTTEN_CHECKOUT_HOURS}h`}
        />
      </div>

      {/* GET form — the filter lives in the URL, so a filtered view is
          shareable and the back button behaves. Same pattern as the audit log. */}
      <Panel className="mb-5 p-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="sd" className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
              From
            </label>
            <input id="sd" name="startDate" type="date" defaultValue={range.startLabel} className={`${input} font-mono`} />
          </div>
          <div>
            <label htmlFor="ed" className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
              To
            </label>
            <input id="ed" name="endDate" type="date" defaultValue={range.endLabel} className={`${input} font-mono`} />
          </div>
          <div>
            <label htmlFor="vw" className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
              View
            </label>
            <select id="vw" name="view" defaultValue={view} className={input}>
              <option value="all">All records</option>
              <option value="exceptions">Exceptions only</option>
            </select>
          </div>
          <button
            type="submit"
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Apply
          </button>
          <Link href="/hr/attendance" className="rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text">
            This month
          </Link>
          <p className="ml-auto text-[11px] text-text-muted">
            Defaults to the current month — attendance is never fetched unbounded.
          </p>
        </form>
      </Panel>

      <Panel>
        <PanelHeader
          title={`${view === "exceptions" ? "Exceptions" : "Attendance"} · ${total} record${total === 1 ? "" : "s"}`}
          action={
            <div className="flex items-center gap-3">
              <Link
                href={qs({ view: view === "exceptions" ? "all" : "exceptions", page: "1" })}
                className="text-xs text-accent hover:underline"
              >
                {view === "exceptions" ? "Show all records" : "Show exceptions only"}
              </Link>
              {totalPages > 1 && (
                <span className="font-mono text-xs text-text-muted">
                  page {page} of {totalPages}
                </span>
              )}
            </div>
          }
        />

        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-text-muted">
            {view === "exceptions"
              ? "No flagged or unclosed records in this period. Nothing to review."
              : "No attendance records in this period."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Shift</th>
                  <th className="px-4 py-3 font-medium">In</th>
                  <th className="px-4 py-3 font-medium">Out</th>
                  <th className="px-4 py-3 font-medium">Channel</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Correction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const openTooLong =
                    r.checkIn !== null &&
                    r.checkOut === null &&
                    r.checkIn.getTime() < Date.now() - FORGOTTEN_CHECKOUT_HOURS * 3_600_000;
                  const state: StatusState = r.flaggedForReview
                    ? "danger"
                    : openTooLong
                      ? "warn"
                      : r.lateFlag
                        ? "warn"
                        : "good";
                  return (
                    <tr key={r.id} className="align-top hover:bg-surface-raised/50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-text-muted">
                        {ymd(r.date)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-text">{r.employee.name}</div>
                        <div className="font-mono text-[11px] text-text-muted">
                          {r.employee.employeeCode} · {r.employee.department}
                          {!r.employee.active && " · offboarded"}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-text-muted">
                        {r.employee.shift
                          ? `${r.employee.shift.name} ${r.employee.shift.startTime}–${r.employee.shift.endTime}`
                          : "unassigned"}
                      </td>
                      <td className="px-4 py-3 font-mono text-text">{fmt(r.checkIn)}</td>
                      <td className="px-4 py-3 font-mono text-text">
                        {r.checkOut ? (
                          fmt(r.checkOut)
                        ) : (
                          <span className={openTooLong ? "text-warn" : "text-text-muted"}>
                            {openTooLong ? "not closed" : "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-text-muted">{r.channel}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2">
                          <StatusDot state={state} />
                          <span className="text-[11px] text-text-muted">
                            {r.flaggedForReview
                              ? "Flagged"
                              : openTooLong
                                ? "Missing clock-out"
                                : r.lateFlag
                                  ? `Late${r.lateMinutes != null ? ` ${r.lateMinutes}m` : ""}`
                                  : "On time"}
                          </span>
                        </span>
                        {r.flaggedForReview && r.reviewReason && (
                          <div className="mt-0.5 max-w-[18rem] text-[10px] text-danger">
                            {r.reviewReason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <AttendanceCorrection
                          attendanceId={r.id}
                          initialCheckIn={hhmm(r.checkIn)}
                          initialCheckOut={hhmm(r.checkOut)}
                          flagged={r.flaggedForReview}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs">
            {page > 1 ? (
              <Link href={qs({ page: String(page - 1) })} className="rounded border border-border px-2.5 py-1 text-text-muted hover:text-text">
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            {page < totalPages ? (
              <Link href={qs({ page: String(page + 1) })} className="rounded border border-border px-2.5 py-1 text-text-muted hover:text-text">
                Next →
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}

        <p className="border-t border-border px-4 py-3 text-xs text-text-muted">
          A correction rewrites the stored clock times and recalculates lateness
          from the employee&apos;s shift. Both the old and new values are recorded
          under{" "}
          <span className="font-mono">ATTENDANCE_MANUALLY_CORRECTED</span> in the
          audit log, with the reason given — the corrected row no longer holds
          what it previously said, so that entry is the only surviving record of
          the change.
        </p>
      </Panel>
    </>
  );
}
