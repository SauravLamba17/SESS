import { ReportDocument, SummaryStats, DataTable, Note, type ReportMeta } from "../pdf-layout.tsx";
import {
  COST_COMPONENTS,
  COMPONENT_LABEL,
  type PayrollCostResult,
  type CostComponent,
} from "../payroll-cost.ts";
// Relative, not the "@/" alias: these templates are compiled standalone by
// prisma/verify-phase12-pdf.cjs to render-test every PDF, and tsc does not
// rewrite path aliases in its output.
import { inr } from "../../payroll/format.ts";

export function PayrollCostPdf({ r, meta }: { r: PayrollCostResult; meta: ReportMeta }) {
  const componentRows = COST_COMPONENTS.map((key: CostComponent) => ({
    label: COMPONENT_LABEL[key],
    amount: r.components[key],
  }));

  return (
    <ReportDocument meta={meta}>
      <SummaryStats
        stats={[
          { label: "Cost to company", value: `INR ${inr(r.totalCostToCompany)}` },
          { label: "Gross", value: `INR ${inr(r.totalGross)}` },
          { label: "Deductions", value: `INR ${inr(r.totalDeductions)}` },
          { label: "Net paid", value: `INR ${inr(r.totalNet)}` },
          {
            label: "Payslips",
            value: r.finalizedRowCount,
            hint: `${r.distinctEmployees} employees`,
          },
        ]}
      />

      <DataTable
        title="Cost by component"
        rows={componentRows}
        columns={[
          { label: "Component", width: "60%", value: (c) => c.label },
          { label: "Amount (INR)", width: "40%", align: "right", value: (c) => inr(c.amount) },
        ]}
        emptyMessage="No finalized payroll in this period."
      />

      <DataTable
        title="By month"
        rows={r.byMonth}
        columns={[
          { label: "Month", width: "22%", value: (m) => m.month },
          { label: "Payslips", width: "16%", align: "right", value: (m) => String(m.rows) },
          { label: "Gross", width: "21%", align: "right", value: (m) => inr(m.gross) },
          { label: "Net", width: "20%", align: "right", value: (m) => inr(m.net) },
          {
            label: "Cost to company",
            width: "21%",
            align: "right",
            value: (m) => inr(m.costToCompany),
          },
        ]}
      />

      <DataTable
        title="By department"
        rows={r.byDepartment}
        columns={[
          { label: "Department", width: "32%", value: (d) => d.department },
          { label: "Staff", width: "13%", align: "right", value: (d) => String(d.employees) },
          { label: "Gross", width: "18%", align: "right", value: (d) => inr(d.gross) },
          { label: "Net", width: "18%", align: "right", value: (d) => inr(d.net) },
          {
            label: "Cost to company",
            width: "19%",
            align: "right",
            value: (d) => inr(d.costToCompany),
          },
        ]}
      />

      <Note>
        FINALIZED payroll rows only.{" "}
        {r.excludedRowCount > 0
          ? `${r.excludedRowCount} draft or submitted row(s) in this period were excluded — those figures are provisional until a Super Admin finalizes them, so this total will rise once they are.`
          : "No draft or submitted rows existed in this period, so this total is complete."}
        {"\n"}
        Cost to company = gross + employer PF + bonus + reimbursements. It is
        deliberately not net pay, which excludes the employer&apos;s own
        contribution. TDS shown is the figure HR recorded from the company&apos;s
        accountant; this system computes no tax.{"\n"}
        Payroll is monthly, so a month is included in full whenever the
        reporting period touches any part of it — a part-month period does not
        pro-rate a payroll run.
      </Note>
    </ReportDocument>
  );
}
