import "server-only";
import { db } from "@/lib/db";
import type { DateRange } from "./range.ts";
import { monthsInRange } from "./range.ts";
import type { ReportId } from "./registry.ts";
import type { ReportScope } from "./scope.ts";
import type { ReportMeta } from "./pdf-layout.tsx";
import { renderReport } from "./pdf-layout.tsx";

import { computeHeadcount } from "./headcount.ts";
import { computeAttendance } from "./attendance.ts";
import { computeHiresExits } from "./hires-exits.ts";
import { computeProduction } from "./production.ts";
import { computeAppraisalDistribution, type AppraisalScoreRow } from "./appraisal-distribution.ts";
import { computePayrollCost, type PayrollCostRow } from "./payroll-cost.ts";
import { computeRecruitmentFunnel, type ApplicationRow } from "./recruitment-funnel.ts";
import { computeIdleTime } from "./idle-time.ts";
import { computeWarningLetters } from "./warning-letters.ts";
import { computeBoardSummary } from "./board-summary.ts";
import { computeMyData, type MyDataInput } from "./my-data.ts";
import {
  headcountCsv,
  attendanceCsv,
  hiresExitsCsv,
  productionCsv,
  appraisalDistributionCsv,
  payrollCostCsv,
  recruitmentFunnelCsv,
  idleTimeCsv,
  warningLettersCsv,
  type CsvSection,
} from "./csv.ts";

import { HeadcountPdf } from "./pdf/headcount.tsx";
import { AttendancePdf } from "./pdf/attendance.tsx";
import { HiresExitsPdf } from "./pdf/hires-exits.tsx";
import { ProductionPdf } from "./pdf/production.tsx";
import { AppraisalDistributionPdf } from "./pdf/appraisal-distribution.tsx";
import { PayrollCostPdf } from "./pdf/payroll-cost.tsx";
import { RecruitmentFunnelPdf } from "./pdf/recruitment-funnel.tsx";
import { IdleTimePdf } from "./pdf/idle-time.tsx";
import { WarningLettersPdf } from "./pdf/warning-letters.tsx";
import { BoardSummaryPdf } from "./pdf/board-summary.tsx";
import { MyDataPdf } from "./pdf/my-data.tsx";

/**
 * One definition per report: fetch → compute → render.
 *
 * The employees in scope are ALREADY fetched by resolveReportScope() (query 1),
 * so a report that needs nothing else issues no further queries at all. Every
 * fetch below is set-based over `employeeId: { in: ids }` — adding employees
 * adds rows to a result, never queries, so no report becomes N+1 as headcount
 * grows. The per-report query counts are stated in each `queries` field and
 * asserted by prisma/verify-phase12.ts.
 *
 * Generic result type is `unknown` at the boundary and narrowed inside each
 * definition — the route never needs to know a report's result shape, it just
 * pipes compute() into pdf().
 */

export interface ReportRun {
  /** JSON-serialisable result, for the API's preview mode. */
  result: unknown;
  pdf: () => Promise<Buffer>;
  /**
   * CSV sections, or null for the two PDF-only reports (Board Summary, My
   * Data). Built from the SAME `result` object the PDF renders — the compute
   * function runs once per request and both formats read its output, so a CSV
   * can never disagree with the PDF of the same report and range.
   */
  csv: (() => CsvSection[]) | null;
}

function inRange(range: DateRange) {
  return { gte: range.start, lt: range.endExclusive };
}

// ── Shared fetches, used by both a standalone report and the board summary ──

async function fetchAppraisalScores(
  employeeIds: string[],
  range: DateRange,
): Promise<AppraisalScoreRow[]> {
  const rows = await db.appraisalScore.findMany({
    where: {
      employeeId: { in: employeeIds },
      excluded: false,
      finalScore: { not: null },
      cycle: { published: true, createdAt: inRange(range) },
    },
    select: {
      employeeId: true,
      finalScore: true,
      employee: { select: { name: true, employeeCode: true, department: true } },
      cycle: { select: { period: true } },
    },
  });
  return rows.map((r) => ({
    employeeId: r.employeeId,
    name: r.employee.name,
    employeeCode: r.employee.employeeCode,
    department: r.employee.department,
    cyclePeriod: r.cycle.period,
    finalScore: r.finalScore!,
  }));
}

async function fetchPayrollRows(
  employeeIds: string[],
  range: DateRange,
): Promise<PayrollCostRow[]> {
  // Payroll is monthly: a month is included when the period touches any part
  // of it. Every status is fetched — computePayrollCost() applies the
  // FINALIZED-only rule itself and reports how many rows it excluded.
  const rows = await db.payroll.findMany({
    where: { employeeId: { in: employeeIds }, month: { in: monthsInRange(range) } },
    select: {
      employeeId: true,
      month: true,
      status: true,
      basic: true,
      hra: true,
      specialAllowance: true,
      bonus: true,
      reimbursements: true,
      pfEmployee: true,
      pfEmployer: true,
      esi: true,
      professionalTax: true,
      tds: true,
      loanDeduction: true,
      gross: true,
      deductions: true,
      net: true,
      employee: { select: { department: true } },
    },
  });
  return rows.map((r) => ({
    employeeId: r.employeeId,
    department: r.employee.department,
    month: r.month,
    status: r.status,
    basic: r.basic.toFixed(2),
    hra: r.hra.toFixed(2),
    specialAllowance: r.specialAllowance.toFixed(2),
    bonus: r.bonus.toFixed(2),
    reimbursements: r.reimbursements.toFixed(2),
    pfEmployee: r.pfEmployee.toFixed(2),
    pfEmployer: r.pfEmployer.toFixed(2),
    esi: r.esi.toFixed(2),
    professionalTax: r.professionalTax.toFixed(2),
    tds: r.tds.toFixed(2),
    loanDeduction: r.loanDeduction.toFixed(2),
    gross: r.gross.toFixed(2),
    deductions: r.deductions.toFixed(2),
    net: r.net.toFixed(2),
  }));
}

async function fetchApplications(
  scope: Extract<ReportScope, { ok: true }>,
  range: DateRange,
): Promise<ApplicationRow[]> {
  // Applications hang off a JobRequisition, not an Employee — so this is the
  // ONE report scoped by department rather than by employee id, exactly as
  // lib/recruitment/access.ts already scopes the pipeline pages.
  const rows = await db.application.findMany({
    where: {
      createdAt: inRange(range),
      ...(scope.department ? { jobRequisition: { department: scope.department } } : {}),
    },
    select: {
      id: true,
      stage: true,
      createdAt: true,
      updatedAt: true,
      jobRequisition: { select: { department: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    department: r.jobRequisition.department,
    stage: r.stage,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

// ── The dispatcher ─────────────────────────────────────────────────────────

export async function runReport(
  id: ReportId,
  scope: Extract<ReportScope, { ok: true }>,
  range: DateRange,
  meta: ReportMeta,
): Promise<ReportRun> {
  const employees = scope.employees;
  const ids = employees.map((e) => e.id);

  switch (id) {
    case "headcount": {
      const result = computeHeadcount(employees, range);
      return {
        result,
        pdf: () => renderReport(<HeadcountPdf r={result} meta={meta} />),
        csv: () => headcountCsv(result),
      };
    }

    case "attendance": {
      const rows = await db.attendance.findMany({
        where: { employeeId: { in: ids }, date: inRange(range) },
        select: { employeeId: true, checkIn: true, lateFlag: true, lateMinutes: true },
      });
      const result = computeAttendance(rows, employees, range);
      return {
        result,
        pdf: () => renderReport(<AttendancePdf r={result} meta={meta} />),
        csv: () => attendanceCsv(result),
      };
    }

    case "hires-exits": {
      const result = computeHiresExits(employees, range);
      return {
        result,
        pdf: () => renderReport(<HiresExitsPdf r={result} meta={meta} />),
        csv: () => hiresExitsCsv(result),
      };
    }

    case "production": {
      const rows = await db.production.findMany({
        where: { employeeId: { in: ids }, date: inRange(range) },
        select: { employeeId: true, unitsProduced: true, targetUnits: true },
      });
      const result = computeProduction(rows, employees);
      return {
        result,
        pdf: () => renderReport(<ProductionPdf r={result} meta={meta} />),
        csv: () => productionCsv(result),
      };
    }

    case "appraisal-distribution": {
      const scores = await fetchAppraisalScores(ids, range);
      const result = computeAppraisalDistribution(scores);
      return {
        result,
        pdf: () => renderReport(<AppraisalDistributionPdf r={result} meta={meta} />),
        csv: () => appraisalDistributionCsv(result),
      };
    }

    case "payroll-cost": {
      const rows = await fetchPayrollRows(ids, range);
      const result = computePayrollCost(rows);
      return {
        result,
        pdf: () => renderReport(<PayrollCostPdf r={result} meta={meta} />),
        csv: () => payrollCostCsv(result),
      };
    }

    case "recruitment-funnel": {
      const apps = await fetchApplications(scope, range);
      const result = computeRecruitmentFunnel(apps);
      return {
        result,
        pdf: () => renderReport(<RecruitmentFunnelPdf r={result} meta={meta} />),
        csv: () => recruitmentFunnelCsv(result),
      };
    }

    case "idle-time": {
      const rows = await db.idleLog.findMany({
        where: { employeeId: { in: ids }, date: inRange(range) },
        select: { employeeId: true, idleMinutes: true, activeMinutes: true },
      });
      const result = computeIdleTime(rows, employees);
      return {
        result,
        pdf: () => renderReport(<IdleTimePdf r={result} meta={meta} />),
        csv: () => idleTimeCsv(result),
      };
    }

    case "warning-letters": {
      const rows = await db.warningLetter.findMany({
        where: { employeeId: { in: ids }, status: "RELEASED", releasedAt: inRange(range) },
        select: {
          id: true,
          employeeId: true,
          status: true,
          releasedAt: true,
          employee: { select: { name: true, employeeCode: true, department: true } },
        },
      });
      const result = computeWarningLetters(
        rows.map((r) => ({
          id: r.id,
          employeeId: r.employeeId,
          name: r.employee.name,
          employeeCode: r.employee.employeeCode,
          department: r.employee.department,
          status: r.status,
          releasedAt: r.releasedAt,
        })),
        range,
      );
      return {
        result,
        pdf: () => renderReport(<WarningLettersPdf r={result} meta={meta} />),
        csv: () => warningLettersCsv(result),
      };
    }

    case "board-summary": {
      // Three fetches in parallel; employees came free with the scope query.
      const [appraisalScores, payrollRows, applications] = await Promise.all([
        fetchAppraisalScores(ids, range),
        fetchPayrollRows(ids, range),
        fetchApplications(scope, range),
      ]);
      const result = computeBoardSummary(
        { employees, appraisalScores, payrollRows, applications },
        range,
      );
      // PDF only: a board page is a narrative, and its detail is already
      // downloadable as CSV from the nine reports it summarises.
      return {
        result,
        pdf: () => renderReport(<BoardSummaryPdf r={result} meta={meta} />),
        csv: null,
      };
    }

    case "my-data": {
      // scope.mode is "self", so this id came from the SESSION, never a
      // request field. Empty scope means no employee record is linked.
      const meId = scope.selfEmployeeId;
      const self = employees[0];
      if (!meId || !self) {
        const empty = computeMyData(EMPTY_MY_DATA, range);
        return {
          result: empty,
          pdf: () => renderReport(<MyDataPdf r={empty} meta={meta} />),
          csv: null,
        };
      }
      const result = computeMyData(await fetchMyData(meId, range), range);
      return {
        result,
        pdf: () => renderReport(<MyDataPdf r={result} meta={meta} />),
        // PDF only, per the brief: a personal reference document, not a
        // dataset to manipulate.
        csv: null,
      };
    }
  }
}

/** Used only when no Employee row is linked to the account. */
const EMPTY_MY_DATA: MyDataInput = {
  profile: {
    name: "—",
    employeeCode: "—",
    department: "—",
    designation: null,
    joiningDate: new Date(0),
    emergencyContact: null,
    email: null,
    shiftName: null,
    managerName: null,
    active: false,
    offboardedAt: null,
  },
  attendance: [], leave: [], production: [], quality: [], appraisals: [],
  warnings: [], consents: [], expenses: [], payslips: [],
};

/**
 * Everything SESS holds about ONE employee, in nine parallel queries.
 *
 * `employeeId` is the caller's own id from resolveReportScope's "self" mode —
 * this function is never called with an id taken from a request.
 */
async function fetchMyData(employeeId: string, range: DateRange): Promise<MyDataInput> {
  const window = inRange(range);
  const [
    employee, attendance, leave, production, quality, appraisals, warnings, consents, expenses, payslips,
  ] = await Promise.all([
    db.employee.findUnique({
      where: { id: employeeId },
      select: {
        name: true, employeeCode: true, department: true, designation: true,
        joiningDate: true, emergencyContact: true, email: true, active: true,
        offboardedAt: true,
        shift: { select: { name: true } },
        manager: { select: { name: true } },
      },
    }),
    db.attendance.findMany({
      where: { employeeId, date: window },
      orderBy: { date: "desc" },
      select: {
        date: true, checkIn: true, checkOut: true, lateFlag: true,
        lateMinutes: true, channel: true, flaggedForReview: true,
      },
    }),
    db.leaveRequest.findMany({
      where: { employeeId, startDate: window },
      orderBy: { startDate: "desc" },
      select: { startDate: true, endDate: true, reason: true, status: true, createdAt: true },
    }),
    db.production.findMany({
      where: { employeeId, date: window },
      orderBy: { date: "desc" },
      select: { date: true, unitsProduced: true, targetUnits: true },
    }),
    db.qualityReport.findMany({
      where: { employeeId, date: window },
      orderBy: { date: "desc" },
      select: { date: true, defectCount: true, qualityScore: true },
    }),
    // PUBLISHED cycles only — filtered again inside computeMyData().
    db.appraisalScore.findMany({
      where: { employeeId, excluded: false, cycle: { published: true, createdAt: window } },
      select: {
        finalScore: true, managerFeedback: true, excluded: true,
        cycle: { select: { period: true, published: true } },
      },
    }),
    // RELEASED letters only — filtered again inside computeMyData().
    db.warningLetter.findMany({
      where: { employeeId, status: "RELEASED", releasedAt: window },
      orderBy: { releasedAt: "desc" },
      select: {
        reason: true, status: true, releasedAt: true, acknowledged: true, attestedAt: true,
      },
    }),
    db.consentRecord.findMany({
      where: { employeeId },
      orderBy: { givenOn: "desc" },
      select: { consentType: true, givenOn: true, retentionExpiry: true },
    }),
    db.expenseClaim.findMany({
      where: { employeeId, date: window },
      orderBy: { date: "desc" },
      select: {
        date: true, category: true, amount: true, description: true, status: true,
      },
    }),
    db.payroll.findMany({
      where: { employeeId, month: { in: monthsInRange(range) } },
      orderBy: { month: "desc" },
      select: { month: true, status: true, net: true },
    }),
  ]);

  return {
    profile: {
      name: employee?.name ?? "—",
      employeeCode: employee?.employeeCode ?? "—",
      department: employee?.department ?? "—",
      designation: employee?.designation ?? null,
      joiningDate: employee?.joiningDate ?? new Date(0),
      emergencyContact: employee?.emergencyContact ?? null,
      email: employee?.email ?? null,
      shiftName: employee?.shift?.name ?? null,
      managerName: employee?.manager?.name ?? null,
      active: employee?.active ?? false,
      offboardedAt: employee?.offboardedAt ?? null,
    },
    attendance,
    leave,
    production,
    quality,
    appraisals: appraisals.map((a) => ({
      cyclePeriod: a.cycle.period,
      published: a.cycle.published,
      excluded: a.excluded,
      finalScore: a.finalScore,
      managerFeedback: a.managerFeedback,
    })),
    warnings,
    consents,
    expenses: expenses.map((e) => ({
      date: e.date,
      category: e.category,
      amount: e.amount.toFixed(2),
      description: e.description,
      status: e.status,
    })),
    payslips: payslips.map((p) => ({
      month: p.month,
      status: p.status,
      net: p.net.toFixed(2),
    })),
  };
}
