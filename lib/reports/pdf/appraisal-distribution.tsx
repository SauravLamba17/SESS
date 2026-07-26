import { ReportDocument, SummaryStats, DataTable, Note, fmtPct, type ReportMeta } from "../pdf-layout.tsx";
import type { AppraisalDistributionResult } from "../appraisal-distribution.ts";
// DISPLAY ONLY — the result object still carries real 0-100 values, and the
// banding in appraisal-distribution.ts still buckets on them.
import {
  scoreOutOfFive,
  formatBandLabelOutOfFive,
} from "../../appraisal/display.ts";

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
          { label: "Average", value: scoreOutOfFive(r.average) ?? "—", hint: "of 5" },
          { label: "Median", value: scoreOutOfFive(r.median) ?? "—", hint: "of 5" },
          { label: "Lowest", value: scoreOutOfFive(r.min) ?? "—", hint: "of 5" },
          { label: "Highest", value: scoreOutOfFive(r.max) ?? "—", hint: "of 5" },
        ]}
      />

      <DataTable
        title="Score distribution"
        rows={r.bands}
        columns={[
          { label: "Band", width: "40%", value: (b) => formatBandLabelOutOfFive(b.min, b.max) },
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
          {
            label: "Average (of 5)",
            width: "25%",
            align: "right",
            value: (d) => scoreOutOfFive(d.average) ?? "—",
          },
        ]}
      />

      {r.byCycle.length > 1 && (
        <DataTable
          title="By appraisal cycle"
          rows={r.byCycle}
          columns={[
            { label: "Cycle", width: "50%", value: (c) => c.cyclePeriod },
            { label: "Scored", width: "25%", align: "right", value: (c) => String(c.count) },
            {
              label: "Average (of 5)",
              width: "25%",
              align: "right",
              value: (c) => scoreOutOfFive(c.average) ?? "—",
            },
          ]}
        />
      )}

      <Note>
        Scores are shown on the 5-point scale employees see. They are computed
        and stored on a 0-100 basis; this report divides by 20 for display only
        and recalculates nothing.{"\n"}
        Bands are half-open — 0.0–2.0, 2.0–3.0 and 3.0–4.0 exclude their upper
        bound; 4.0–5.0 includes 5.0. Only PUBLISHED cycles are counted, and
        employees HR excluded from a cycle are omitted.
      </Note>
    </ReportDocument>
  );
}
