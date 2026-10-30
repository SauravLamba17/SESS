import { ReportDocument, SummaryStats, DataTable, Note, fmtPct, type ReportMeta } from "../pdf-layout.tsx";
import { PRODUCTION_TARGET_NA_NOTE, type ProductionResult } from "../production.ts";

function signed(n: number | null): string {
  return n === null ? "N/A" : `${n >= 0 ? "+" : ""}${n}`;
}

function target(n: number | null): string {
  return n === null ? "N/A" : String(n);
}

export function ProductionPdf({ r, meta }: { r: ProductionResult; meta: ReportMeta }) {
  return (
    <ReportDocument meta={meta}>
      <SummaryStats
        stats={[
          { label: "Units produced", value: r.totalActual },
          { label: "Target", value: target(r.totalTarget) },
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
          { label: "Target", width: "16%", align: "right", value: (d) => target(d.target) },
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
          { label: "Target", width: "12%", align: "right", value: (e) => target(e.target) },
          {
            label: "Achieved",
            width: "10%",
            align: "right",
            value: (e) => fmtPct(e.achievementPct),
          },
        ]}
      />

      <Note>
        {r.targetsApply
          ? "Target is each employee's monthly target for the months in this period. An employee with no target shows - and is left out of the met/below counts."
          : PRODUCTION_TARGET_NA_NOTE}
      </Note>
    </ReportDocument>
  );
}
