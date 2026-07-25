import { ReportDocument, SummaryStats, DataTable, Note, fmtPct, type ReportMeta } from "../pdf-layout.tsx";
import { hm, type IdleTimeResult } from "../idle-time.ts";

export function IdleTimePdf({ r, meta }: { r: IdleTimeResult; meta: ReportMeta }) {
  return (
    <ReportDocument meta={meta}>
      <SummaryStats
        stats={[
          { label: "Active time", value: hm(r.totalActiveMinutes) },
          { label: "Idle time", value: hm(r.totalIdleMinutes) },
          { label: "Active share", value: fmtPct(r.activePct) },
          {
            label: "Employees tracked",
            value: `${r.employeesWithData} / ${r.employeesInScope}`,
            hint: "reported any data",
          },
        ]}
      />

      <DataTable
        title="By department"
        rows={r.byDepartment}
        columns={[
          { label: "Department", width: "34%", value: (d) => d.department },
          {
            label: "Tracked",
            width: "14%",
            align: "right",
            value: (d) => String(d.employeesTracked),
          },
          { label: "Active", width: "18%", align: "right", value: (d) => hm(d.activeMinutes) },
          { label: "Idle", width: "18%", align: "right", value: (d) => hm(d.idleMinutes) },
          { label: "Active %", width: "16%", align: "right", value: (d) => fmtPct(d.activePct) },
        ]}
        emptyMessage="No idle-tracking data in this period."
      />

      <DataTable
        title="By employee"
        rows={r.byEmployee.filter((e) => e.totalMinutes > 0)}
        maxRows={60}
        columns={[
          { label: "Code", width: "14%", value: (e) => e.employeeCode },
          { label: "Name", width: "26%", value: (e) => e.name },
          { label: "Dept", width: "18%", value: (e) => e.department },
          { label: "Days", width: "9%", align: "right", value: (e) => String(e.daysWithData) },
          { label: "Active", width: "12%", align: "right", value: (e) => hm(e.activeMinutes) },
          { label: "Idle", width: "11%", align: "right", value: (e) => hm(e.idleMinutes) },
          { label: "Active %", width: "10%", align: "right", value: (e) => fmtPct(e.activePct) },
        ]}
        emptyMessage="No employee reported idle-tracking data in this period."
      />

      <Note>
        Totals over the whole period only. This report contains no per-day
        series, no time-of-day breakdown and no productivity score — the same
        constraint the tracking itself is built around. Employees with no data
        have no agent installed, no active consent, or did not run it; they are
        counted in scope but contribute nothing to the averages.
      </Note>
    </ReportDocument>
  );
}
