import { ReportDocument, SummaryStats, DataTable, Note, fmtNum, type ReportMeta } from "../pdf-layout.tsx";
import type { MyDataResult } from "../my-data.ts";
import { ymd } from "../range.ts";
import { inr } from "../../payroll/format.ts";
import { formatScoreOutOfFive } from "../../appraisal/display.ts";
// Relative + .ts, like its neighbours: this template is rendered outside Next
// by the verify scripts, where the "@/" alias does not resolve.
import { clockHHMM } from "../../time-display.ts";

/**
 * Reports render on the SERVER, so getHours() read the process timezone — UTC
 * on Vercel — and every punch in an employee's own data export was 5h30m
 * early. Pinned to the org timezone; see lib/time-display.ts.
 */
function clock(d: Date | null): string {
  return clockHHMM(d) ?? "—";
}

export function MyDataPdf({ r, meta }: { r: MyDataResult; meta: ReportMeta }) {
  const p = r.profile;
  return (
    <ReportDocument meta={meta}>
      <SummaryStats
        stats={[
          { label: "Attendance days", value: r.attendanceSummary.days, hint: `${r.attendanceSummary.late} late` },
          { label: "Production days", value: r.productionSummary.days },
          { label: "Quality reviews", value: r.qualitySummary.reviews, hint: `avg ${fmtNum(r.qualitySummary.averageScore)}` },
          { label: "Appraisals", value: r.appraisals.length, hint: "published only" },
          { label: "Warnings", value: r.warnings.length, hint: "released only" },
        ]}
      />

      <DataTable
        title="Profile"
        rows={[
          { k: "Name", v: p.name },
          { k: "Employee code", v: p.employeeCode },
          { k: "Department", v: p.department },
          { k: "Designation", v: p.designation ?? "—" },
          { k: "Reports to", v: p.managerName ?? "—" },
          { k: "Shift", v: p.shiftName ?? "—" },
          { k: "Joining date", v: ymd(p.joiningDate) },
          { k: "Emergency contact", v: p.emergencyContact ?? "—" },
          { k: "Email", v: p.email ?? "—" },
          { k: "Status", v: p.active ? "Active" : `Offboarded ${p.offboardedAt ? ymd(p.offboardedAt) : ""}` },
        ]}
        columns={[
          { label: "Field", width: "35%", value: (x) => x.k },
          { label: "Value", width: "65%", value: (x) => x.v },
        ]}
      />

      <DataTable
        title="Attendance"
        rows={r.attendance}
        maxRows={80}
        columns={[
          { label: "Date", width: "18%", value: (a) => ymd(a.date) },
          { label: "In", width: "13%", value: (a) => clock(a.checkIn) },
          { label: "Out", width: "13%", value: (a) => clock(a.checkOut) },
          { label: "Channel", width: "18%", value: (a) => a.channel },
          { label: "Late", width: "20%", value: (a) => (a.lateFlag ? `Yes${a.lateMinutes != null ? ` (${a.lateMinutes}m)` : ""}` : "No") },
          { label: "Flagged", width: "18%", value: (a) => (a.flaggedForReview ? "Under review" : "—") },
        ]}
      />

      <DataTable
        title="Leave requests"
        rows={r.leave}
        maxRows={40}
        columns={[
          { label: "From", width: "18%", value: (l) => ymd(l.startDate) },
          { label: "To", width: "18%", value: (l) => ymd(l.endDate) },
          { label: "Status", width: "18%", value: (l) => l.status },
          { label: "Reason", width: "46%", value: (l) => l.reason },
        ]}
      />

      <DataTable
        title="Production"
        rows={r.production}
        maxRows={60}
        columns={[
          { label: "Date", width: "34%", value: (x) => ymd(x.date) },
          { label: "Units produced", width: "33%", align: "right", value: (x) => String(x.unitsProduced) },
          { label: "Target", width: "33%", align: "right", value: (x) => String(x.targetUnits) },
        ]}
      />

      <DataTable
        title="Quality reviews"
        rows={r.quality}
        maxRows={60}
        columns={[
          { label: "Date", width: "34%", value: (q) => ymd(q.date) },
          { label: "Defects", width: "33%", align: "right", value: (q) => String(q.defectCount) },
          { label: "Score", width: "33%", align: "right", value: (q) => String(q.qualityScore) },
        ]}
      />

      <DataTable
        title="Appraisal scores (published only)"
        rows={r.appraisals}
        columns={[
          { label: "Cycle", width: "28%", value: (a) => a.cyclePeriod },
          {
            label: "Score",
            width: "17%",
            align: "right",
            value: (a) => formatScoreOutOfFive(a.finalScore),
          },
          { label: "Manager feedback", width: "55%", value: (a) => a.managerFeedback ?? "—" },
        ]}
        emptyMessage="No published appraisal scores in this period."
      />

      <DataTable
        title="Warning letters (released only)"
        rows={r.warnings}
        columns={[
          { label: "Released", width: "20%", value: (w) => (w.releasedAt ? ymd(w.releasedAt) : "—") },
          { label: "Acknowledged", width: "22%", value: (w) => (w.acknowledged ? (w.attestedAt ? ymd(w.attestedAt) : "Yes") : "No") },
          { label: "Reason", width: "58%", value: (w) => w.reason },
        ]}
        emptyMessage="No warning letters were issued to you in this period."
      />

      <DataTable
        title="Consent records"
        rows={r.consents}
        columns={[
          { label: "Type", width: "40%", value: (c) => c.consentType },
          { label: "Given on", width: "30%", value: (c) => ymd(c.givenOn) },
          { label: "Expires", width: "30%", value: (c) => (c.retentionExpiry ? ymd(c.retentionExpiry) : "no expiry") },
        ]}
        emptyMessage="No consent records on file."
      />

      <DataTable
        title="Expense claims"
        rows={r.expenses}
        maxRows={40}
        columns={[
          { label: "Date", width: "16%", value: (e) => ymd(e.date) },
          { label: "Category", width: "20%", value: (e) => e.category },
          { label: "Amount", width: "17%", align: "right", value: (e) => inr(e.amount) },
          { label: "Status", width: "17%", value: (e) => e.status },
          { label: "Description", width: "30%", value: (e) => e.description },
        ]}
        emptyMessage="No expense claims in this period."
      />

      <DataTable
        title="Payslips available (index only)"
        rows={r.payslips}
        columns={[
          { label: "Month", width: "34%", value: (s) => s.month },
          { label: "Status", width: "33%", value: (s) => s.status },
          { label: "Net pay", width: "33%", align: "right", value: (s) => inr(s.net) },
        ]}
        emptyMessage="No payslips in this period."
      />

      <Note>
        This document lists what SESS holds about you for the period shown. It is
        a summary, not a set of certificates: your payslips and Form 16 are
        downloaded individually from the Payslips &amp; Financials page, and this
        table only names which exist.{"\n"}
        Appraisal scores appear only once a cycle is PUBLISHED, and warning
        letters only once RELEASED — anything still in progress is not yours
        yet and is deliberately absent.{"\n"}
        Long sections are capped for length; the row counts above the tables are
        the true totals for the period.
      </Note>
    </ReportDocument>
  );
}
