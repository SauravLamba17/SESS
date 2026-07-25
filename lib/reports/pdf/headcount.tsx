import { ReportDocument, SummaryStats, DataTable, fmtPct, type ReportMeta } from "../pdf-layout.tsx";
import type { HeadcountResult } from "../headcount.ts";
import { pct } from "../types.ts";

export function HeadcountPdf({ r, meta }: { r: HeadcountResult; meta: ReportMeta }) {
  return (
    <ReportDocument meta={meta}>
      <SummaryStats
        stats={[
          { label: "Active headcount", value: r.totalActive },
          { label: "Departments", value: r.departmentCount },
          { label: "At period start", value: r.atRangeStart },
          { label: "At period end", value: r.atRangeEnd },
          {
            label: "Net change",
            value: `${r.netChange >= 0 ? "+" : ""}${r.netChange}`,
            hint: r.netChange === 0 ? "no movement" : r.netChange > 0 ? "growth" : "reduction",
          },
        ]}
      />

      <DataTable
        title="Headcount by department"
        rows={r.byDepartment}
        columns={[
          { label: "Department", width: "55%", value: (d) => d.department },
          { label: "Employees", width: "20%", align: "right", value: (d) => String(d.count) },
          {
            label: "Share",
            width: "25%",
            align: "right",
            value: (d) => fmtPct(pct(d.count, r.totalActive)),
          },
        ]}
        emptyMessage="No active employees in scope."
      />
    </ReportDocument>
  );
}
