import { ReportDocument, SummaryStats, DataTable, Note, fmtPct, type ReportMeta } from "../pdf-layout.tsx";
import type { WarningLettersResult } from "../warning-letters.ts";

export function WarningLettersPdf({ r, meta }: { r: WarningLettersResult; meta: ReportMeta }) {
  return (
    <ReportDocument meta={meta}>
      <SummaryStats
        stats={[
          { label: "Letters released", value: r.releasedCount },
          { label: "Employees affected", value: r.employeesAffected },
          { label: "Repeat cases", value: r.repeatEmployees.length, hint: "2+ in period" },
          {
            label: "Busiest month",
            value: r.busiestMonth ? r.busiestMonth.month : "—",
            hint: r.busiestMonth ? `${r.busiestMonth.count} released` : undefined,
          },
        ]}
      />

      <DataTable
        title="By department"
        rows={r.byDepartment}
        columns={[
          { label: "Department", width: "55%", value: (d) => d.department },
          { label: "Released", width: "22%", align: "right", value: (d) => String(d.count) },
          { label: "Share", width: "23%", align: "right", value: (d) => fmtPct(d.sharePct) },
        ]}
        emptyMessage="No warning letters released in this period."
      />

      {r.hasTrend && (
        <DataTable
          title="Monthly trend"
          rows={r.byMonth}
          columns={[
            { label: "Month", width: "50%", value: (m) => m.month },
            { label: "Released", width: "25%", align: "right", value: (m) => String(m.count) },
            {
              label: "",
              width: "25%",
              value: (m) => "█".repeat(Math.min(10, m.count)),
            },
          ]}
        />
      )}

      {r.repeatEmployees.length > 0 && (
        <DataTable
          title="Employees with more than one letter"
          rows={r.repeatEmployees}
          columns={[
            { label: "Code", width: "18%", value: (e) => e.employeeCode },
            { label: "Name", width: "42%", value: (e) => e.name },
            { label: "Department", width: "25%", value: (e) => e.department },
            { label: "Letters", width: "15%", align: "right", value: (e) => String(e.count) },
          ]}
        />
      )}

      <Note>
        RELEASED letters only, dated by their release date.{" "}
        {r.excludedDraftCount > 0
          ? `${r.excludedDraftCount} draft letter(s) were excluded — a draft has not been issued to the employee and is not a disciplinary action.`
          : "No drafts existed in this period."}
        {"\n"}
        This report counts letters. It says nothing about whether a letter was
        upheld, withdrawn or acknowledged.
      </Note>
    </ReportDocument>
  );
}
