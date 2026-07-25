import { ReportDocument, SummaryStats, DataTable, Note, fmtPct, type ReportMeta } from "../pdf-layout.tsx";
import type { ProductionResult } from "../production.ts";

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}`;
}

export function ProductionPdf({ r, meta }: { r: ProductionResult; meta: ReportMeta }) {
  return (
    <ReportDocument meta={meta}>
      <SummaryStats
        stats={[
          { label: "Units produced", value: r.totalActual },
          { label: "Target", value: r.totalTarget },
          { label: "Achievement", value: fmtPct(r.achievementPct) },
          { label: "Variance", value: signed(r.variance) },
          {
            label: "Met target",
            value: r.metTargetCount,
            hint: `${r.belowTargetCount} below`,
          },
        ]}
      />

      <DataTable
        title="By department"
        rows={r.byDepartment}
        columns={[
          { label: "Department", width: "34%", value: (d) => d.department },
          { label: "Staff", width: "12%", align: "right", value: (d) => String(d.employees) },
          { label: "Actual", width: "16%", align: "right", value: (d) => String(d.actual) },
          { label: "Target", width: "16%", align: "right", value: (d) => String(d.target) },
          {
            label: "Achieved",
            width: "12%",
            align: "right",
            value: (d) => fmtPct(d.achievementPct),
          },
          { label: "Var", width: "10%", align: "right", value: (d) => signed(d.variance) },
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
          { label: "Days", width: "8%", align: "right", value: (e) => String(e.days) },
          { label: "Actual", width: "12%", align: "right", value: (e) => String(e.actual) },
          { label: "Target", width: "12%", align: "right", value: (e) => String(e.target) },
          {
            label: "Achieved",
            width: "10%",
            align: "right",
            value: (e) => fmtPct(e.achievementPct),
          },
        ]}
      />

      <Note>
        Target is the figure recorded on each production entry, summed over the
        period — not a monthly target pro-rated to the range. An employee with
        no target recorded shows &quot;—&quot; and is excluded from the met/below
        counts.
      </Note>
    </ReportDocument>
  );
}
