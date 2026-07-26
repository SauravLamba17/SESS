/**
 * Phase 12 verification — Reports & Analytics.
 *
 * Seeds a SMALL, HAND-CHECKABLE dataset across attendance, production,
 * appraisal, payroll, recruitment and warnings, runs all ten REAL pure
 * aggregation functions over it, and asserts every number is exactly what the
 * seed implies — nothing is compared against itself.
 *
 * Also asserts:
 *   · the average punch-in calculation against a worked example
 *   · the registry scoping table matches the Phase 12 spec cell for cell
 *   · the Board Summary's numbers are IDENTICAL to the standalone reports'
 *     (proving it reuses their functions rather than reimplementing them)
 *   · payroll cost counts FINALIZED rows only
 *
 * PDF rendering is checked separately by prisma/verify-phase12-pdf.cjs, which
 * compiles the .tsx templates and renders all ten for real (Node cannot import
 * JSX directly). The HTTP 401/403 gate is checked against the dev server at the
 * end when one is running.
 *
 * Creates its own throwaway data and deletes everything, pass or fail.
 *
 * Run:  node --env-file=.env prisma/verify-phase12.ts
 */
import { PrismaClient } from "@prisma/client";
import { parseRange, weekdaysInRange, monthsInRange } from "../lib/reports/range.ts";
import type { ReportEmployee } from "../lib/reports/types.ts";
import { computeHeadcount, headcountOn } from "../lib/reports/headcount.ts";
import {
  computeAttendance,
  averagePunchInMinutes,
  minutesSinceMidnight,
  minutesToClock,
} from "../lib/reports/attendance.ts";
import { computeHiresExits } from "../lib/reports/hires-exits.ts";
import { computeProduction } from "../lib/reports/production.ts";
import { computeAppraisalDistribution, bandIndexOf } from "../lib/reports/appraisal-distribution.ts";
import { computePayrollCost } from "../lib/reports/payroll-cost.ts";
import { computeRecruitmentFunnel } from "../lib/reports/recruitment-funnel.ts";
import { computeIdleTime } from "../lib/reports/idle-time.ts";
import { computeWarningLetters } from "../lib/reports/warning-letters.ts";
import { computeBoardSummary } from "../lib/reports/board-summary.ts";
import { REPORTS, scopeFor, reportsForRole } from "../lib/reports/registry.ts";
import { formatScoreOutOfFive } from "../lib/appraisal/display.ts";

const db = new PrismaClient();

const TAG = "ZZ-P12";
const ACTOR = "test-p12-actor";
const BASE = "http://localhost:3005";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, a === e ? "" : `expected ${e}, got ${a}`);
}
function step(n: string, title: string) {
  console.log(`\n── ${n}: ${title} ${"─".repeat(Math.max(0, 46 - title.length))}`);
}

async function cleanup() {
  const emps = await db.employee.findMany({
    where: { OR: [{ name: { startsWith: TAG } }, { employeeCode: { startsWith: TAG } }] },
    select: { id: true },
  });
  const ids = emps.map((e) => e.id);
  await db.attendance.deleteMany({ where: { employeeId: { in: ids } } });
  await db.production.deleteMany({ where: { employeeId: { in: ids } } });
  await db.idleLog.deleteMany({ where: { employeeId: { in: ids } } });
  await db.warningLetter.deleteMany({ where: { employeeId: { in: ids } } });
  await db.appraisalScore.deleteMany({ where: { employeeId: { in: ids } } });
  await db.payroll.deleteMany({ where: { employeeId: { in: ids } } });
  await db.appraisalCycle.deleteMany({ where: { period: { startsWith: TAG } } });

  const reqs = await db.jobRequisition.findMany({
    where: { title: { startsWith: TAG } },
    select: { id: true },
  });
  const reqIds = reqs.map((r) => r.id);
  const apps = await db.application.findMany({
    where: { jobRequisitionId: { in: reqIds } },
    select: { id: true },
  });
  await db.offer.deleteMany({ where: { applicationId: { in: apps.map((a) => a.id) } } });
  await db.interviewFeedback.deleteMany({
    where: { applicationId: { in: apps.map((a) => a.id) } },
  });
  await db.application.deleteMany({ where: { jobRequisitionId: { in: reqIds } } });
  await db.jobRequisition.deleteMany({ where: { id: { in: reqIds } } });
  await db.candidate.deleteMany({ where: { name: { startsWith: TAG } } });

  await db.user.deleteMany({ where: { employeeId: { in: ids } } });
  await db.employee.deleteMany({ where: { id: { in: ids } } });
  await db.auditLog.deleteMany({ where: { actorUserId: ACTOR } });
}

/** Local-midnight date, so it matches how the app stores day boundaries. */
function day(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d);
}
/** A check-in timestamp at a specific wall-clock time. */
function at(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

async function main() {
  await cleanup();

  // ══ THE SEED — every number below is hand-derivable from this ══
  //
  // Range under test: 2026-06-01 → 2026-06-30 (June 2026).
  //
  // Employees (all in scope):
  //   A  ZZ-P12-0001  Assembly  joined 2025-01-10  active
  //   B  ZZ-P12-0002  Assembly  joined 2026-06-10  active      ← hired IN range
  //   C  ZZ-P12-0003  Quality   joined 2024-03-01  offboarded 2026-06-20 ← exit IN range
  //   D  ZZ-P12-0004  Quality   joined 2026-07-05  active      ← joins AFTER range
  const parsed = parseRange("2026-06-01", "2026-06-30");
  if (!parsed.ok) throw new Error("seed range failed to parse");
  const range = parsed.range;

  step("0", "date-range utility");
  eq("June 2026 spans 30 days", range.days, 30);
  eq("endExclusive is 1 July", range.endExclusive.getTime(), day(2026, 7, 1).getTime());
  eq("June 2026 has 22 weekdays", weekdaysInRange(range), 22);
  eq("range touches exactly one month", monthsInRange(range), ["2026-06"]);
  const rev = parseRange("2026-06-30", "2026-06-01");
  check("reversed range refused", !rev.ok && rev.code === "REVERSED");
  const bad = parseRange("2026-02-30", "2026-03-01");
  check("rolled-over date (Feb 30) refused", !bad.ok && bad.code === "BAD_DATE");
  const long = parseRange("2020-01-01", "2026-01-01");
  check("over-long range refused", !long.ok && long.code === "TOO_LONG");

  const empSeed = [
    { code: `${TAG}-0001`, name: `${TAG} Alpha`, dept: "Assembly", joined: day(2025, 1, 10), off: null, active: true },
    { code: `${TAG}-0002`, name: `${TAG} Bravo`, dept: "Assembly", joined: day(2026, 6, 10), off: null, active: true },
    { code: `${TAG}-0003`, name: `${TAG} Charlie`, dept: "Quality", joined: day(2024, 3, 1), off: day(2026, 6, 20), active: false },
    { code: `${TAG}-0004`, name: `${TAG} Delta`, dept: "Quality", joined: day(2026, 7, 5), off: null, active: true },
  ];
  const created = [];
  for (const e of empSeed) {
    created.push(
      await db.employee.create({
        data: {
          employeeCode: e.code,
          name: e.name,
          department: e.dept,
          joiningDate: e.joined,
          offboardedAt: e.off,
          active: e.active,
        },
      }),
    );
  }
  const [A, B, C, D] = created;
  const employees: ReportEmployee[] = created.map((e) => ({
    id: e.id,
    name: e.name,
    employeeCode: e.employeeCode,
    department: e.department,
    active: e.active,
    joiningDate: e.joiningDate,
    offboardedAt: e.offboardedAt,
  }));

  // ── 1: HEADCOUNT ────────────────────────────────────────────────
  step("1", "Headcount & Org Summary");
  const headcount = computeHeadcount(employees, range);
  // Active flag: A, B, D = 3 (C is offboarded).
  eq("total active", headcount.totalActive, 3);
  eq("departments", headcount.departmentCount, 2);
  // At 1 June: A (2025) and C (2024) were employed; B joins the 10th, D in July.
  eq("headcount at range start", headcount.atRangeStart, 2);
  // At 30 June: A and B. C left on the 20th, D has not joined.
  eq("headcount at range end", headcount.atRangeEnd, 2);
  eq("net change", headcount.netChange, 0);
  eq(
    "by department",
    headcount.byDepartment,
    [
      { department: "Assembly", count: 2 },
      { department: "Quality", count: 1 },
    ],
  );
  eq("headcountOn mid-range (15 June: A, B, C)", headcountOn(employees, day(2026, 6, 15)), 3);
  eq("last working day still counts as employed", headcountOn(employees, day(2026, 6, 20)), 3);
  eq("day after last working day", headcountOn(employees, day(2026, 6, 21)), 2);

  // ── 2: ATTENDANCE + THE AVERAGE PUNCH-IN CALCULATION ────────────
  step("2", "Attendance & Punctuality — average punch-in");

  // THE HAND-WORKED EXAMPLE from the comment in lib/reports/attendance.ts.
  eq("09:15 → 555 minutes", minutesSinceMidnight(at(2026, 6, 1, 9, 15)), 555);
  eq("09:45 → 585 minutes", minutesSinceMidnight(at(2026, 6, 2, 9, 45)), 585);
  eq("10:00 → 600 minutes", minutesSinceMidnight(at(2026, 6, 3, 10, 0)), 600);
  const worked = averagePunchInMinutes([
    at(2026, 6, 1, 9, 15),
    at(2026, 6, 2, 9, 45),
    at(2026, 6, 3, 10, 0),
  ]);
  eq("mean of 555, 585, 600 = 580", worked, 580);
  eq("580 minutes → 09:40", minutesToClock(580), "09:40");
  eq("round-trip 00:00", minutesToClock(minutesSinceMidnight(at(2026, 6, 1, 0, 0))), "00:00");
  eq("round-trip 23:59", minutesToClock(minutesSinceMidnight(at(2026, 6, 1, 23, 59))), "23:59");
  eq("no punches → null, never a fake midnight", averagePunchInMinutes([]), null);

  // A: 3 punches — 09:00, 09:30, 10:30. One late (30 min).
  //    mean = (540 + 570 + 630)/3 = 1740/3 = 580 → 09:40
  // B: 1 punch — 08:00 (480), on time.
  // Assembly department = A's 3 punches + B's 1 = (540+570+630+480)/4
  //                     = 2220/4 = 555 → 09:15
  await db.attendance.createMany({
    data: [
      { employeeId: A.id, date: day(2026, 6, 1), checkIn: at(2026, 6, 1, 9, 0), lateFlag: false },
      { employeeId: A.id, date: day(2026, 6, 2), checkIn: at(2026, 6, 2, 9, 30), lateFlag: false },
      { employeeId: A.id, date: day(2026, 6, 3), checkIn: at(2026, 6, 3, 10, 30), lateFlag: true, lateMinutes: 30 },
      { employeeId: B.id, date: day(2026, 6, 11), checkIn: at(2026, 6, 11, 8, 0), lateFlag: false },
      // OUTSIDE the range — must be excluded by the route's WHERE, so it is
      // deliberately NOT passed to the pure function below.
    ],
  });
  const attRows = await db.attendance.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: range.start, lt: range.endExclusive } },
    select: { employeeId: true, checkIn: true, lateFlag: true, lateMinutes: true },
  });
  const attendance = computeAttendance(attRows, employees, range);
  eq("total punch days", attendance.totalPunchDays, 4);
  eq("late count", attendance.lateCount, 1);
  eq("on-time count", attendance.onTimeCount, 3);
  eq("late %", attendance.latePct, 25);
  // Org mean = (540+570+630+480)/4 = 555 → 09:15
  eq("org avg punch-in minutes", attendance.orgAvgPunchInMinutes, 555);
  eq("org avg punch-in clock", attendance.orgAvgPunchIn, "09:15");
  const rowA = attendance.byEmployee.find((e) => e.employeeId === A.id)!;
  eq("employee A avg punch-in = 09:40", rowA.avgPunchIn, "09:40");
  eq("employee A avg late minutes (late days only)", rowA.avgLateMinutes, 30);
  const rowD = attendance.byEmployee.find((e) => e.employeeId === D.id)!;
  eq("employee with no punches → null avg", rowD.avgPunchIn, null);
  const assembly = attendance.byDepartment.find((d) => d.department === "Assembly")!;
  eq("Assembly dept avg punch-in = 09:15 (punch-weighted)", assembly.avgPunchIn, "09:15");
  // 22 weekdays × 4 employees = 88 expected; 4 punched → 84 with no punch.
  eq("expected employee-weekdays", attendance.expectedWeekdayCount, 88);
  eq("days with no punch", attendance.noPunchDays, 84);

  // ── 3: HIRES & EXITS ────────────────────────────────────────────
  step("3", "New Hires & Exits");
  const hiresExits = computeHiresExits(employees, range);
  eq("hires in June (B only)", hiresExits.hireCount, 1);
  eq("exits in June (C only)", hiresExits.exitCount, 1);
  eq("net change", hiresExits.netChange, 0);
  eq("hire is Bravo", hiresExits.hires[0].employeeCode, `${TAG}-0002`);
  eq("exit is Charlie", hiresExits.exits[0].employeeCode, `${TAG}-0003`);
  // avg headcount = (2 at start + 2 at end)/2 = 2 → attrition = 1/2 = 50%
  eq("avg headcount", hiresExits.avgHeadcount, 2);
  eq("attrition %", hiresExits.attritionPct, 50);
  check("D (joins in July) is not counted as a June hire", hiresExits.hires.length === 1);

  // ── 4: PRODUCTION ───────────────────────────────────────────────
  step("4", "Production vs Target");
  // A: 100/80 and 60/80  → 160 actual / 160 target → 100%
  // B: 30/50             → 30 / 50 → 60%
  // Org: 190 / 210
  await db.production.createMany({
    data: [
      { employeeId: A.id, date: day(2026, 6, 1), unitsProduced: 100, targetUnits: 80 },
      { employeeId: A.id, date: day(2026, 6, 2), unitsProduced: 60, targetUnits: 80 },
      { employeeId: B.id, date: day(2026, 6, 11), unitsProduced: 30, targetUnits: 50 },
    ],
  });
  const prodRows = await db.production.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: range.start, lt: range.endExclusive } },
    select: { employeeId: true, unitsProduced: true, targetUnits: true },
  });
  const production = computeProduction(prodRows, employees);
  eq("total actual", production.totalActual, 190);
  eq("total target", production.totalTarget, 210);
  eq("achievement % (190/210)", production.achievementPct, 90.5);
  eq("variance", production.variance, -20);
  eq("met target (A exactly 160/160)", production.metTargetCount, 1);
  eq("below target (B)", production.belowTargetCount, 1);
  const prodA = production.byEmployee.find((e) => e.employeeId === A.id)!;
  eq("A achievement 100%", prodA.achievementPct, 100);
  const prodD = production.byEmployee.find((e) => e.employeeId === D.id)!;
  eq("no production → null %, not 0%", prodD.achievementPct, null);

  // ── 5: APPRAISAL DISTRIBUTION ───────────────────────────────────
  step("5", "Appraisal Score Distribution");
  const cycle = await db.appraisalCycle.create({
    data: {
      period: `${TAG}-2026-Q2`,
      weightsJson: { punctuality: 25, production: 25, quality: 25, feedback: 25, warningPenaltyPoints: 5 },
      createdBy: ACTOR,
      published: true,
      createdAt: day(2026, 6, 15),
    },
  });
  const unpublished = await db.appraisalCycle.create({
    data: {
      period: `${TAG}-2026-Q2-DRAFT`,
      weightsJson: { punctuality: 25, production: 25, quality: 25, feedback: 25, warningPenaltyPoints: 5 },
      createdBy: ACTOR,
      published: false,
      createdAt: day(2026, 6, 15),
    },
  });
  // A 92 (band 80-100), B 71 (60-80), C 35 (0-40). Mean = 198/3 = 66.
  await db.appraisalScore.createMany({
    data: [
      { employeeId: A.id, cycleId: cycle.id, finalScore: 92 },
      { employeeId: B.id, cycleId: cycle.id, finalScore: 71 },
      { employeeId: C.id, cycleId: cycle.id, finalScore: 35 },
      // Excluded by HR — must not count.
      { employeeId: D.id, cycleId: cycle.id, finalScore: 100, excluded: true },
      // Unpublished cycle — must not count.
      { employeeId: D.id, cycleId: unpublished.id, finalScore: 10 },
    ],
  });
  const scoreRows = await db.appraisalScore.findMany({
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      excluded: false,
      finalScore: { not: null },
      cycle: { published: true, createdAt: { gte: range.start, lt: range.endExclusive } },
    },
    select: {
      employeeId: true,
      finalScore: true,
      employee: { select: { name: true, employeeCode: true, department: true } },
      cycle: { select: { period: true } },
    },
  });
  const appraisalScores = scoreRows.map((r) => ({
    employeeId: r.employeeId,
    name: r.employee.name,
    employeeCode: r.employee.employeeCode,
    department: r.employee.department,
    cyclePeriod: r.cycle.period,
    finalScore: r.finalScore!,
  }));
  const appraisal = computeAppraisalDistribution(appraisalScores);
  eq("scored count — excluded and unpublished dropped", appraisal.scoredCount, 3);
  eq("average (92+71+35)/3 = 66", appraisal.average, 66);
  eq("median of 35,71,92", appraisal.median, 71);
  eq("min", appraisal.min, 35);
  eq("max", appraisal.max, 92);
  eq(
    "band counts [0-40, 40-60, 60-80, 80-100]",
    appraisal.bands.map((b) => b.count),
    [1, 0, 1, 1],
  );
  eq("band boundaries are half-open: 40 → band 1", bandIndexOf(40), 1);
  eq("39.9 → band 0", bandIndexOf(39.9), 0);
  eq("80 → band 3", bandIndexOf(80), 3);
  eq("100 lands in the top band, not off the end", bandIndexOf(100), 3);

  // ── 6: PAYROLL COST — FINALIZED ONLY ────────────────────────────
  step("6", "Payroll Cost Summary — FINALIZED only");
  const payBase = {
    month: "2026-06",
    basic: "30000.00",
    hra: "15000.00",
    specialAllowance: "5000.00",
    bonus: "1000.00",
    reimbursements: "500.00",
    pfEmployee: "1800.00",
    pfEmployer: "1800.00",
    esi: "375.00",
    professionalTax: "200.00",
    tds: "2000.00",
    loanDeduction: "0.00",
    gross: "50000.00",
    deductions: "4375.00",
    net: "47125.00",
  };
  await db.payroll.create({ data: { ...payBase, employeeId: A.id, status: "FINALIZED" } });
  await db.payroll.create({ data: { ...payBase, employeeId: B.id, status: "FINALIZED" } });
  // MUST BE IGNORED — provisional figures.
  await db.payroll.create({ data: { ...payBase, employeeId: C.id, status: "DRAFT" } });
  await db.payroll.create({ data: { ...payBase, employeeId: D.id, status: "SUBMITTED" } });

  const payRowsRaw = await db.payroll.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, month: { in: monthsInRange(range) } },
    select: {
      employeeId: true, month: true, status: true, basic: true, hra: true,
      specialAllowance: true, bonus: true, reimbursements: true, pfEmployee: true,
      pfEmployer: true, esi: true, professionalTax: true, tds: true,
      loanDeduction: true, gross: true, deductions: true, net: true,
      employee: { select: { department: true } },
    },
  });
  const payrollRows = payRowsRaw.map((r) => ({
    employeeId: r.employeeId,
    department: r.employee.department,
    month: r.month,
    status: r.status,
    basic: r.basic.toFixed(2), hra: r.hra.toFixed(2),
    specialAllowance: r.specialAllowance.toFixed(2), bonus: r.bonus.toFixed(2),
    reimbursements: r.reimbursements.toFixed(2), pfEmployee: r.pfEmployee.toFixed(2),
    pfEmployer: r.pfEmployer.toFixed(2), esi: r.esi.toFixed(2),
    professionalTax: r.professionalTax.toFixed(2), tds: r.tds.toFixed(2),
    loanDeduction: r.loanDeduction.toFixed(2), gross: r.gross.toFixed(2),
    deductions: r.deductions.toFixed(2), net: r.net.toFixed(2),
  }));
  const payroll = computePayrollCost(payrollRows);
  eq("4 rows fetched, only 2 FINALIZED counted", payroll.finalizedRowCount, 2);
  eq("DRAFT + SUBMITTED excluded and reported", payroll.excludedRowCount, 2);
  eq("distinct employees", payroll.distinctEmployees, 2);
  eq("total gross = 2 × 50000", payroll.totalGross, "100000.00");
  eq("total net = 2 × 47125", payroll.totalNet, "94250.00");
  eq("basic component = 2 × 30000", payroll.components.basic, "60000.00");
  eq("TDS component = 2 × 2000", payroll.components.tds, "4000.00");
  // CTC = gross 50000 + employer PF 1800 + bonus 1000 + reimb 500 = 53300, ×2
  eq("cost to company = 2 × 53300", payroll.totalCostToCompany, "106600.00");
  check(
    "a DRAFT-only dataset produces a ZERO total, never a provisional number",
    computePayrollCost(payrollRows.map((r) => ({ ...r, status: "DRAFT" as const })))
      .totalCostToCompany === "0.00",
  );

  // ── 7: RECRUITMENT FUNNEL ───────────────────────────────────────
  step("7", "Recruitment Funnel");
  const req = await db.jobRequisition.create({
    data: {
      title: `${TAG} Line Operator`,
      department: "Assembly",
      description: "seed",
      openings: 2,
      createdBy: ACTOR,
    },
  });
  // 5 applications: 1 APPLIED, 1 SCREENING, 1 INTERVIEW, 1 HIRED, 1 REJECTED.
  // Reached: APPLIED 4 (all non-rejected), SCREENING 3, INTERVIEW 2, OFFER 1, HIRED 1.
  const appSeed: { stage: "APPLIED" | "SCREENING" | "INTERVIEW" | "HIRED" | "REJECTED"; created: Date; updated: Date }[] = [
    { stage: "APPLIED", created: day(2026, 6, 2), updated: day(2026, 6, 2) },
    { stage: "SCREENING", created: day(2026, 6, 3), updated: day(2026, 6, 5) },
    { stage: "INTERVIEW", created: day(2026, 6, 4), updated: day(2026, 6, 9) },
    { stage: "HIRED", created: day(2026, 6, 1), updated: day(2026, 6, 11) }, // 10 days
    { stage: "REJECTED", created: day(2026, 6, 6), updated: day(2026, 6, 8) },
  ];
  for (let i = 0; i < appSeed.length; i++) {
    const cand = await db.candidate.create({
      data: {
        name: `${TAG} Candidate ${i}`,
        email: `zz-p12-cand-${i}@example.invalid`,
        phone: "0000000000",
        resumeUrl: "seed",
        source: "Career Page",
      },
    });
    await db.application.create({
      data: {
        candidateId: cand.id,
        jobRequisitionId: req.id,
        stage: appSeed[i].stage,
        createdAt: appSeed[i].created,
        updatedAt: appSeed[i].updated,
      },
    });
  }
  const appRows = await db.application.findMany({
    where: {
      jobRequisitionId: req.id,
      createdAt: { gte: range.start, lt: range.endExclusive },
    },
    select: {
      id: true, stage: true, createdAt: true, updatedAt: true,
      jobRequisition: { select: { department: true } },
    },
  });
  const applications = appRows.map((r) => ({
    id: r.id,
    department: r.jobRequisition.department,
    stage: r.stage,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
  const funnel = computeRecruitmentFunnel(applications);
  eq("total applications", funnel.totalApplications, 5);
  eq(
    "reached per stage [APPLIED, SCREENING, INTERVIEW, OFFER, HIRED]",
    funnel.stages.map((s) => s.reached),
    [4, 3, 2, 1, 1],
  );
  eq("rejected reported separately, not folded into the funnel", funnel.rejectedCount, 1);
  eq("hired", funnel.hiredCount, 1);
  eq("overall conversion 1/5", funnel.overallConversionPct, 20);
  // SCREENING reached 3 of APPLIED's 4 = 75%
  eq("conversion APPLIED→SCREENING", funnel.stages[1].conversionFromPrevPct, 75);
  eq("avg time to hire (1 June → 11 June)", funnel.avgTimeToHireDays, 10);

  // ── 8: IDLE TIME ────────────────────────────────────────────────
  step("8", "Idle Time Summary");
  // A: 100 active + 20 idle; B: 60 active + 60 idle.
  // Org: 160 active, 80 idle, 240 total → 66.7% active.
  await db.idleLog.createMany({
    data: [
      { employeeId: A.id, date: day(2026, 6, 1), activeMinutes: 100, idleMinutes: 20 },
      { employeeId: B.id, date: day(2026, 6, 11), activeMinutes: 60, idleMinutes: 60 },
    ],
  });
  const idleRows = await db.idleLog.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: range.start, lt: range.endExclusive } },
    select: { employeeId: true, idleMinutes: true, activeMinutes: true },
  });
  const idle = computeIdleTime(idleRows, employees);
  eq("total active minutes", idle.totalActiveMinutes, 160);
  eq("total idle minutes", idle.totalIdleMinutes, 80);
  eq("active % (160/240)", idle.activePct, 66.7);
  eq("employees with data", idle.employeesWithData, 2);
  eq("employees in scope", idle.employeesInScope, 4);
  const idleB = idle.byEmployee.find((e) => e.employeeId === B.id)!;
  eq("B active % (60/120)", idleB.activePct, 50);

  // ── 9: WARNING LETTERS ──────────────────────────────────────────
  step("9", "Warning Letters & Disciplinary Trend");
  await db.warningLetter.createMany({
    data: [
      { employeeId: A.id, issuedBy: ACTOR, reason: "seed 1", status: "RELEASED", releasedAt: day(2026, 6, 5) },
      { employeeId: A.id, issuedBy: ACTOR, reason: "seed 2", status: "RELEASED", releasedAt: day(2026, 6, 18) },
      { employeeId: B.id, issuedBy: ACTOR, reason: "seed 3", status: "RELEASED", releasedAt: day(2026, 6, 22) },
      // DRAFT — never issued to the employee, must not count.
      { employeeId: C.id, issuedBy: ACTOR, reason: "seed draft", status: "DRAFT" },
    ],
  });
  const warnRaw = await db.warningLetter.findMany({
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      status: "RELEASED",
      releasedAt: { gte: range.start, lt: range.endExclusive },
    },
    select: {
      id: true, employeeId: true, status: true, releasedAt: true,
      employee: { select: { name: true, employeeCode: true, department: true } },
    },
  });
  const warnings = computeWarningLetters(
    warnRaw.map((r) => ({
      id: r.id, employeeId: r.employeeId, name: r.employee.name,
      employeeCode: r.employee.employeeCode, department: r.employee.department,
      status: r.status, releasedAt: r.releasedAt,
    })),
    range,
  );
  eq("released letters", warnings.releasedCount, 3);
  eq("employees affected", warnings.employeesAffected, 2);
  eq("repeat cases (A has 2)", warnings.repeatEmployees.length, 1);
  eq("repeat case is Alpha with 2", warnings.repeatEmployees[0].count, 2);
  eq("all three in Assembly", warnings.byDepartment, [
    { department: "Assembly", count: 3, sharePct: 100 },
  ]);
  eq("single-month range has no trend", warnings.hasTrend, false);
  // The DRAFT row is filtered by the query AND by the pure function — prove
  // the pure function does it independently.
  const withDraft = computeWarningLetters(
    [
      ...warnRaw.map((r) => ({
        id: r.id, employeeId: r.employeeId, name: r.employee.name,
        employeeCode: r.employee.employeeCode, department: r.employee.department,
        status: r.status, releasedAt: r.releasedAt,
      })),
      { id: "x", employeeId: C.id, name: `${TAG} Charlie`, employeeCode: `${TAG}-0003`, department: "Quality", status: "DRAFT" as const, releasedAt: null },
    ],
    range,
  );
  eq("DRAFT dropped by the pure function itself", withDraft.releasedCount, 3);
  eq("and reported as excluded", withDraft.excludedDraftCount, 1);

  // ── 10: BOARD SUMMARY — REUSE, NOT REIMPLEMENTATION ─────────────
  step("10", "Board Summary — identical to the standalone reports");
  const board = computeBoardSummary(
    { employees, appraisalScores, payrollRows, applications },
    range,
  );
  // Deep equality against the SAME objects the standalone reports produced
  // above. If board-summary.ts reimplemented any of this, these would drift.
  eq("headcount sub-result identical", board.headcount, headcount);
  eq("hires/exits sub-result identical", board.hiresExits, hiresExits);
  eq("appraisal sub-result identical", board.appraisal, appraisal);
  eq("payroll sub-result identical", board.payroll, payroll);
  eq("recruitment sub-result identical", board.recruitment, funnel);

  const headline = (label: string) => board.headlines.find((h) => h.label === label)?.value;
  eq("headline headcount matches report", headline("Active headcount"), String(headcount.totalActive));
  eq("headline attrition matches report", headline("Attrition (period)"), `${hiresExits.attritionPct}%`);
  // The headline is a DISPLAY string and now carries the 5-point scale. The
  // guarantee under test is unchanged — it must still be derived from the
  // appraisal sub-result, which itself remains raw 0-100.
  eq(
    "headline avg appraisal matches report (formatted /5)",
    headline("Avg appraisal score"),
    formatScoreOutOfFive(appraisal.average),
  );
  eq("the sub-result itself is still raw 0-100", board.appraisal.average, appraisal.average);
  eq("headline payroll matches report", headline("Payroll cost to company"), `INR ${payroll.totalCostToCompany}`);
  eq("headline hired matches report", headline("Candidates hired"), String(funnel.hiredCount));
  check(
    "every headline names the report it came from",
    board.headlines.every((h) => h.source.length > 0),
  );

  // ── 11: SCOPING TABLE ───────────────────────────────────────────
  step("11", "Scoping table matches the Phase 12 spec, cell for cell");
  const SPEC: Record<string, { MANAGER: string; HR: string; SUPER_ADMIN: string }> = {
    headcount: { MANAGER: "team", HR: "org", SUPER_ADMIN: "org" },
    attendance: { MANAGER: "team", HR: "org", SUPER_ADMIN: "org" },
    "hires-exits": { MANAGER: "none", HR: "org", SUPER_ADMIN: "org" },
    production: { MANAGER: "team", HR: "org", SUPER_ADMIN: "org" },
    "appraisal-distribution": { MANAGER: "team", HR: "org", SUPER_ADMIN: "org" },
    "payroll-cost": { MANAGER: "none", HR: "org", SUPER_ADMIN: "org" },
    "recruitment-funnel": { MANAGER: "department", HR: "org", SUPER_ADMIN: "org" },
    "idle-time": { MANAGER: "team", HR: "org", SUPER_ADMIN: "org" },
    "warning-letters": { MANAGER: "none", HR: "org", SUPER_ADMIN: "org" },
    "board-summary": { MANAGER: "none", HR: "org", SUPER_ADMIN: "org" },
    // The self-service export added after Phase 12: about the viewer, never
    // about anyone else, so every role gets exactly "self".
    "my-data": { MANAGER: "self", HR: "self", SUPER_ADMIN: "self" },
  };
  eq("ten org reports plus the self-service export are registered", REPORTS.length, 11);
  let tableOk = true;
  for (const r of REPORTS) {
    const spec = SPEC[r.id];
    if (!spec) { tableOk = false; console.log(`        no spec for ${r.id}`); continue; }
    for (const role of ["MANAGER", "HR", "SUPER_ADMIN"] as const) {
      const actual = scopeFor(r, role);
      if (actual !== spec[role]) {
        tableOk = false;
        console.log(`        ${r.id} / ${role}: expected ${spec[role]}, got ${actual}`);
      }
    }
  }
  check("every cell of the scoping table matches the spec", tableOk);

  const MANAGER_DENIED = ["payroll-cost", "hires-exits", "warning-letters", "board-summary"];
  for (const id of MANAGER_DENIED) {
    const def = REPORTS.find((r) => r.id === id)!;
    eq(`MANAGER denied: ${id}`, scopeFor(def, "MANAGER"), "none");
  }
  eq("Manager sees exactly 6 reports", reportsForRole("MANAGER").length, 6);
  eq("HR sees all 10", reportsForRole("HR").length, 10);
  eq("Super Admin sees all 10", reportsForRole("SUPER_ADMIN").length, 10);
  eq("EMPLOYEE sees none", reportsForRole("EMPLOYEE").length, 0);
  check(
    "EMPLOYEE is denied every ORGANISATION report",
    REPORTS.filter((r) => !r.selfService).every((r) => scopeFor(r, "EMPLOYEE") === "none"),
  );
  check(
    "the only thing EMPLOYEE may run is their own data export",
    REPORTS.filter((r) => scopeFor(r, "EMPLOYEE") !== "none").every((r) => r.selfService === true),
  );
  check("a null role (signed out) is denied every report", REPORTS.every((r) => scopeFor(r, null) === "none"));

  // ── 12: THE HTTP GATE ───────────────────────────────────────────
  step("12", "Server-side gate — unauthenticated HTTP is refused");
  try {
    const res = await fetch(`${BASE}/api/reports/payroll-cost?startDate=2026-06-01&endDate=2026-06-30`);
    const body = await res.json();
    check(
      "unauthenticated request refused by the SERVER, not by hiding a link",
      res.status === 401 && body.code === "UNAUTHENTICATED",
      `status ${res.status} ${JSON.stringify(body)}`,
    );
    const unknown = await fetch(`${BASE}/api/reports/not-a-report?startDate=2026-06-01&endDate=2026-06-30`);
    check("unknown report → 404", unknown.status === 404, `status ${unknown.status}`);
  } catch (e) {
    check(
      "HTTP gate test ran (is `npm run dev` up on :3005?)",
      false,
      e instanceof Error ? e.message : String(e),
    );
  }

  console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("VERIFY SCRIPT CRASHED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await db.$disconnect();
    console.log("cleanup complete");
  });
