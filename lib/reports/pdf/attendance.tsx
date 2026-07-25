import {
  ReportDocument,
  SummaryStats,
  DataTable,
  Note,
  fmtPct,
  type ReportMeta,
} from "../pdf-layout.tsx";
import type { AttendanceResult } from "../attendance.ts";

export function AttendancePdf({ r, meta }: { r: AttendanceResult; meta: ReportMeta }) {
  return (
    <ReportDocument meta={meta}>
      <SummaryStats
        stats={[
          { label: "Days punched", value: r.totalPunchDays },
          { label: "On time", value: r.onTimeCount, hint: fmtPct(r.onTimePct) },
          { label: "Late", value: r.lateCount, hint: fmtPct(r.latePct) },
          {
            label: "Avg punch-in",
            value: r.orgAvgPunchIn ?? "—",
            hint: r.orgAvgPunchInMethod === "circular" ? "circular mean ○" : "org-wide mean",
          },
          { label: "No punch recorded", value: r.noPunchDays, hint: "weekdays" },
        ]}
      />

      <DataTable
        title="By department"
        rows={r.byDepartment}
        columns={[
          { label: "Department", width: "34%", value: (d) => d.department },
          { label: "Staff", width: "11%", align: "right", value: (d) => String(d.employees) },
          { label: "Days", width: "13%", align: "right", value: (d) => String(d.punchDays) },
          { label: "Late", width: "12%", align: "right", value: (d) => String(d.lateCount) },
          { label: "Late %", width: "14%", align: "right", value: (d) => fmtPct(d.latePct) },
          {
            label: "Avg punch-in",
            width: "16%",
            align: "right",
            value: (d) =>
              d.avgPunchIn === null
                ? "—"
                : `${d.avgPunchIn}${d.avgPunchInMethod === "circular" ? " ○" : ""}`,
          },
        ]}
      />

      <DataTable
        title="By employee"
        rows={r.byEmployee}
        maxRows={60}
        columns={[
          { label: "Code", width: "14%", value: (e) => e.employeeCode },
          { label: "Name", width: "26%", value: (e) => e.name },
          { label: "Dept", width: "18%", value: (e) => e.department },
          { label: "Days", width: "9%", align: "right", value: (e) => String(e.punchDays) },
          { label: "Late", width: "9%", align: "right", value: (e) => String(e.lateCount) },
          {
            label: "Avg late",
            width: "12%",
            align: "right",
            value: (e) => (e.avgLateMinutes === null ? "—" : `${e.avgLateMinutes}m`),
          },
          {
            label: "Avg punch-in",
            width: "12%",
            align: "right",
            value: (e) =>
              e.avgPunchIn === null
                ? "—"
                : `${e.avgPunchIn}${e.avgPunchInMethod === "circular" ? " ○" : ""}`,
          },
        ]}
      />

      <Note>
        Average punch-in is computed in minutes since midnight and converted back
        to HH:MM. Department figures are punch-weighted, not an average of
        per-person averages.{"\n"}
        {r.hasOvernightShift
          ? "This scope includes employees on a shift that crosses midnight, so their averages use a CIRCULAR mean — an arithmetic mean of 23:00 and 01:00 would report 12:00 rather than midnight. Day-shift figures use the plain arithmetic mean."
          : "All shifts in this scope run within a single calendar day, so a plain arithmetic mean is used throughout."}
        {"\n"}
        &quot;No punch recorded&quot; counts weekdays in the period with no
        attendance row ({r.expectedWeekdayCount} expected employee-days minus{" "}
        {r.totalPunchDays} punched). It includes approved leave and public
        holidays — it is not a count of unauthorised absence.
      </Note>
    </ReportDocument>
  );
}
