import { ReportDocument, SummaryStats, DataTable, Note, fmtPct, fmtNum, type ReportMeta } from "../pdf-layout.tsx";
import type { AppraisalDistributionResult } from "../appraisal-distribution.ts";

export function AppraisalDistributionPdf({
  r,
  meta,
}: {
  r: AppraisalDistributionResult;
  meta: ReportMeta;
}) {
  return (
    <ReportDocument meta={meta}>
      <SummaryStats
        stats={[
          { label: "Scores published", value: r.scoredCount },
          { label: "Average", value: fmtNum(r.average) },
          { label: "Median", value: fmtNum(r.median) },
          { label: "Lowest", value: fmtNum(r.min) },
          { label: "Highest", value: fmtNum(r.max) },
        ]}
      />

      <DataTable
        title="Score distribution"
        rows={r.bands}
        columns={[
          { label: "Band", width: "40%", value: (b) => b.label },
          { label: "Employees", width: "25%", align: "right", value: (b) => String(b.count) },
          { label: "Share", width: "20%", align: "right", value: (b) => fmtPct(b.sharePct) },
          {
            label: "",
            width: "15%",
            value: (b) => "█".repeat(Math.min(6, Math.round((b.sharePct ?? 0) / 17))),
          },
        ]}
        emptyMessage="No published scores in this period."
      />

      <DataTable
        title="Average by department"
        rows={r.byDepartment}
        columns={[
          { label: "Department", width: "50%", value: (d) => d.department },
          { label: "Scored", width: "25%", align: "right", value: (d) => String(d.count) },
          { label: "Average", width: "25%", align: "right", value: (d) => fmtNum(d.average) },
        ]}
      />

      {r.byCycle.length > 1 && (
        <DataTable
          title="By appraisal cycle"
          rows={r.byCycle}
          columns={[
            { label: "Cycle", width: "50%", value: (c) => c.cyclePeriod },
            { label: "Scored", width: "25%", align: "right", value: (c) => String(c.count) },
            { label: "Average", width: "25%", align: "right", value: (c) => fmtNum(c.average) },
          ]}
        />
      )}

      <Note>
        Bands are half-open — 0–40, 40–60 and 60–80 exclude their upper bound;
        80–100 includes 100. Only PUBLISHED cycles are counted, and employees HR
        excluded from a cycle are omitted. Scores are the values already computed
        and published; nothing is recalculated for this report.
      </Note>
    </ReportDocument>
  );
}
