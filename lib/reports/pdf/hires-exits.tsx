import { ReportDocument, SummaryStats, DataTable, Note, fmtPct, type ReportMeta } from "../pdf-layout.tsx";
import type { HiresExitsResult } from "../hires-exits.ts";
import { ymd } from "../range.ts";

export function HiresExitsPdf({ r, meta }: { r: HiresExitsResult; meta: ReportMeta }) {
  return (
    <ReportDocument meta={meta}>
      <SummaryStats
        stats={[
          { label: "New hires", value: r.hireCount },
          { label: "Exits", value: r.exitCount },
          {
            label: "Net change",
            value: `${r.netChange >= 0 ? "+" : ""}${r.netChange}`,
          },
          {
            label: "Attrition",
            value: fmtPct(r.attritionPct),
            hint: `avg headcount ${r.avgHeadcount}`,
          },
        ]}
      />

      <DataTable
        title="By department"
        rows={r.byDepartment}
        columns={[
          { label: "Department", width: "46%", value: (d) => d.department },
          { label: "Hires", width: "18%", align: "right", value: (d) => String(d.hires) },
          { label: "Exits", width: "18%", align: "right", value: (d) => String(d.exits) },
          {
            label: "Net",
            width: "18%",
            align: "right",
            value: (d) => `${d.net >= 0 ? "+" : ""}${d.net}`,
          },
        ]}
      />

      <DataTable
        title="New hires"
        rows={r.hires}
        maxRows={50}
        columns={[
          { label: "Date", width: "18%", value: (h) => ymd(h.date) },
          { label: "Code", width: "16%", value: (h) => h.employeeCode },
          { label: "Name", width: "38%", value: (h) => h.name },
          { label: "Department", width: "28%", value: (h) => h.department },
        ]}
        emptyMessage="No hires in this period."
      />

      <DataTable
        title="Exits"
        rows={r.exits}
        maxRows={50}
        columns={[
          { label: "Last day", width: "18%", value: (x) => ymd(x.date) },
          { label: "Code", width: "16%", value: (x) => x.employeeCode },
          { label: "Name", width: "38%", value: (x) => x.name },
          { label: "Department", width: "28%", value: (x) => x.department },
        ]}
        emptyMessage="No exits in this period."
      />

      {r.byMonth.length > 1 && (
        <DataTable
          title="Monthly movement"
          rows={r.byMonth}
          columns={[
            { label: "Month", width: "40%", value: (m) => m.month },
            { label: "Hires", width: "30%", align: "right", value: (m) => String(m.hires) },
            { label: "Exits", width: "30%", align: "right", value: (m) => String(m.exits) },
          ]}
        />
      )}

      <Note>
        Attrition is exits divided by the average of the headcount at the start
        and end of the period. An exit is dated by the employee&apos;s last
        working day.
      </Note>
    </ReportDocument>
  );
}
