import { ReportDocument, SummaryStats, DataTable, Note, fmtPct, type ReportMeta } from "../pdf-layout.tsx";
import type { BoardSummaryResult } from "../board-summary.ts";
// Relative, not the "@/" alias — see the note in ./payroll-cost.tsx.
import { inr } from "../../payroll/format.ts";
import { scoreOutOfFive, formatBandLabelOutOfFive } from "../../appraisal/display.ts";

export function BoardSummaryPdf({ r, meta }: { r: BoardSummaryResult; meta: ReportMeta }) {
  const { headcount, hiresExits, appraisal, payroll, recruitment } = r;

  return (
    <ReportDocument meta={meta}>
      <SummaryStats
        stats={[
          { label: "Headcount", value: headcount.totalActive, hint: `${headcount.departmentCount} departments` },
          {
            label: "Movement",
            value: `${hiresExits.netChange >= 0 ? "+" : ""}${hiresExits.netChange}`,
            hint: `${hiresExits.hireCount} in / ${hiresExits.exitCount} out`,
          },
          { label: "Attrition", value: fmtPct(hiresExits.attritionPct) },
          // Same 5-point scale as everywhere else; the sub-result is raw.
          { label: "Avg appraisal", value: scoreOutOfFive(appraisal.average) ?? "—", hint: "of 5" },
          { label: "Cost to company", value: `INR ${inr(payroll.totalCostToCompany)}` },
        ]}
      />

      <DataTable
        title="Headline figures"
        rows={r.headlines}
        columns={[
          { label: "Measure", width: "40%", value: (h) => h.label },
          { label: "Value", width: "27%", align: "right", value: (h) => h.value },
          { label: "Source report", width: "33%", value: (h) => h.source },
        ]}
      />

      <DataTable
        title="Headcount by department"
        rows={headcount.byDepartment}
        maxRows={12}
        columns={[
          { label: "Department", width: "60%", value: (d) => d.department },
          { label: "Employees", width: "40%", align: "right", value: (d) => String(d.count) },
        ]}
      />

      <DataTable
        title="Appraisal distribution"
        rows={appraisal.bands}
        columns={[
          { label: "Band (of 5)", width: "40%", value: (b) => formatBandLabelOutOfFive(b.min, b.max) },
          { label: "Employees", width: "30%", align: "right", value: (b) => String(b.count) },
          { label: "Share", width: "30%", align: "right", value: (b) => fmtPct(b.sharePct) },
        ]}
        emptyMessage="No published appraisal scores in this period."
      />

      <DataTable
        title="Recruitment funnel"
        rows={recruitment.stages}
        columns={[
          { label: "Stage", width: "40%", value: (s) => s.stage },
          { label: "Reached", width: "30%", align: "right", value: (s) => String(s.reached) },
          { label: "Of all", width: "30%", align: "right", value: (s) => fmtPct(s.ofTotalPct) },
        ]}
        emptyMessage="No applications in this period."
      />

      <DataTable
        title="Payroll cost by month"
        rows={payroll.byMonth}
        columns={[
          { label: "Month", width: "34%", value: (m) => m.month },
          { label: "Payslips", width: "22%", align: "right", value: (m) => String(m.rows) },
          {
            label: "Cost to company",
            width: "44%",
            align: "right",
            value: (m) => inr(m.costToCompany),
          },
        ]}
        emptyMessage="No finalized payroll in this period."
      />

      <Note>
        Every figure on this page is read directly from the detailed report named
        beside it — Headcount &amp; Org Summary, New Hires &amp; Exits, Appraisal
        Score Distribution, Payroll Cost Summary and Recruitment Funnel — over
        this exact period. Nothing here is calculated a second time, so any line
        can be traced to its full report without reconciliation.{"\n"}
        Payroll counts FINALIZED runs only
        {payroll.excludedRowCount > 0
          ? `; ${payroll.excludedRowCount} unfinalized row(s) in this period are excluded and will raise the figure once approved.`
          : "."}
      </Note>
    </ReportDocument>
  );
}
