import { ReportDocument, SummaryStats, DataTable, Note, fmtPct, type ReportMeta } from "../pdf-layout.tsx";
import type { RecruitmentFunnelResult } from "../recruitment-funnel.ts";

export function RecruitmentFunnelPdf({
  r,
  meta,
}: {
  r: RecruitmentFunnelResult;
  meta: ReportMeta;
}) {
  return (
    <ReportDocument meta={meta}>
      <SummaryStats
        stats={[
          { label: "Applications", value: r.totalApplications },
          { label: "Hired", value: r.hiredCount, hint: fmtPct(r.overallConversionPct) },
          { label: "Rejected", value: r.rejectedCount, hint: fmtPct(r.rejectedPct) },
          {
            label: "Avg time to hire",
            value: r.avgTimeToHireDays === null ? "—" : `${r.avgTimeToHireDays}d`,
            hint:
              r.medianTimeToHireDays === null ? undefined : `median ${r.medianTimeToHireDays}d`,
          },
        ]}
      />

      <DataTable
        title="Pipeline funnel"
        rows={r.stages}
        columns={[
          { label: "Stage", width: "26%", value: (s) => s.stage },
          { label: "Reached", width: "16%", align: "right", value: (s) => String(s.reached) },
          {
            label: "Currently at",
            width: "18%",
            align: "right",
            value: (s) => String(s.atStage),
          },
          {
            label: "From previous",
            width: "20%",
            align: "right",
            value: (s) => fmtPct(s.conversionFromPrevPct),
          },
          {
            label: "Of all",
            width: "20%",
            align: "right",
            value: (s) => fmtPct(s.ofTotalPct),
          },
        ]}
        emptyMessage="No applications in this period."
      />

      <DataTable
        title="By department"
        rows={r.byDepartment}
        columns={[
          { label: "Department", width: "40%", value: (d) => d.department },
          {
            label: "Applications",
            width: "20%",
            align: "right",
            value: (d) => String(d.applications),
          },
          { label: "Hired", width: "13%", align: "right", value: (d) => String(d.hired) },
          { label: "Rejected", width: "14%", align: "right", value: (d) => String(d.rejected) },
          { label: "Conv.", width: "13%", align: "right", value: (d) => fmtPct(d.conversionPct) },
        ]}
      />

      <Note>
        &quot;Reached&quot; counts applications whose CURRENT stage is at or
        beyond that stage. This schema stores no per-application stage history,
        so how far a rejected candidate progressed before rejection cannot be
        recovered — the {r.rejectedCount} rejected application(s) are reported on
        their own line rather than being distributed back into the funnel.{"\n"}
        Time to hire is measured from application received to the application
        reaching HIRED.
      </Note>
    </ReportDocument>
  );
}
