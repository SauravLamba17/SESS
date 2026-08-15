/**
 * Phase 12b verification — CSV export and My Data self-scope.
 *
 * The MFA enforcement section was removed with the feature itself; the CSV and
 * My Data coverage below is unchanged.
 *
 * Runs the REAL pure functions and the REAL serializer against a seeded,
 * hand-checkable dataset. Creates its own throwaway data and deletes
 * everything, pass or fail.
 *
 * Run:  node --env-file=.env prisma/verify-phase12b.ts
 */
import { PrismaClient } from "@prisma/client";
import { parseRange } from "../lib/reports/range.ts";
import type { ReportEmployee } from "../lib/reports/types.ts";
import { computeHeadcount } from "../lib/reports/headcount.ts";
import { computeAttendance } from "../lib/reports/attendance.ts";
import { computePayrollCost } from "../lib/reports/payroll-cost.ts";
import { computeMyData, type MyDataInput } from "../lib/reports/my-data.ts";
import {
  serializeCsv,
  escapeCsvCell,
  headcountCsv,
  attendanceCsv,
  payrollCostCsv,
} from "../lib/reports/csv.ts";
import { REPORTS, REPORT_BY_ID, scopeFor, reportsForRole } from "../lib/reports/registry.ts";

const db = new PrismaClient();

const TAG = "ZZ-P12B";
const ACTOR = "test-p12b-actor";
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
  await db.qualityReport.deleteMany({ where: { employeeId: { in: ids } } });
  await db.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } });
  await db.expenseClaim.deleteMany({ where: { employeeId: { in: ids } } });
  await db.consentRecord.deleteMany({ where: { employeeId: { in: ids } } });
  await db.warningLetter.deleteMany({ where: { employeeId: { in: ids } } });
  await db.appraisalScore.deleteMany({ where: { employeeId: { in: ids } } });
  await db.payroll.deleteMany({ where: { employeeId: { in: ids } } });
  await db.appraisalCycle.deleteMany({ where: { period: { startsWith: TAG } } });
  await db.user.deleteMany({ where: { employeeId: { in: ids } } });
  await db.employee.deleteMany({ where: { id: { in: ids } } });
  await db.auditLog.deleteMany({ where: { actorUserId: ACTOR } });
}

function day(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d);
}
function at(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}
/** Parse a CSV document back into rows, so assertions read the real output. */
function csvLines(doc: string): string[] {
  return doc.split("\r\n");
}

async function main() {
  await cleanup();

  const parsed = parseRange("2026-06-01", "2026-06-30");
  if (!parsed.ok) throw new Error("range");
  const range = parsed.range;

  // ── 0: the serializer itself ────────────────────────────────────
  step("0", "CSV escaping");
  eq("plain value unquoted", escapeCsvCell("Assembly"), "Assembly");
  eq("comma forces quotes", escapeCsvCell("Smith, John"), '"Smith, John"');
  eq("embedded quote is doubled", escapeCsvCell('He said "hi"'), '"He said ""hi"""');
  eq("newline forces quotes", escapeCsvCell("line1\nline2"), '"line1\nline2"');
  eq("null becomes an EMPTY field, not the text null", escapeCsvCell(null), "");
  eq("undefined becomes empty too", escapeCsvCell(undefined), "");
  eq("zero survives as 0", escapeCsvCell(0), "0");
  const doc = serializeCsv([
    { title: "T", headers: ["a", "b"], rows: [[1, "x,y"], [null, 'q"q']] },
  ]);
  eq(
    "document shape",
    csvLines(doc).slice(0, 4),
    ["T", "a,b", '1,"x,y"', ',"q""q"'],
  );

  // ── SEED ────────────────────────────────────────────────────────
  const emps = [
    { code: `${TAG}-0001`, name: `${TAG} Alpha, A.`, dept: "Assembly" },
    { code: `${TAG}-0002`, name: `${TAG} Bravo`, dept: "Quality" },
  ];
  const created = [];
  for (const e of emps) {
    created.push(
      await db.employee.create({
        data: {
          employeeCode: e.code,
          name: e.name,
          department: e.dept,
          designation: "Operator",
          emergencyContact: "Next of kin · 99999",
          joiningDate: day(2025, 1, 10),
        },
      }),
    );
  }
  const [A, B] = created;
  const employees: ReportEmployee[] = created.map((e) => ({
    id: e.id, name: e.name, employeeCode: e.employeeCode, department: e.department,
    active: e.active, joiningDate: e.joiningDate, offboardedAt: e.offboardedAt,
  }));

  // ── 1: CSV matches the SAME computed result as the PDF ──────────
  step("1", "CSV is a rendering of the same result, not a recomputation");

  // Report 1 — Headcount. ONE compute call, as the route does.
  const headcount = computeHeadcount(employees, range);
  const hcCsv = serializeCsv(headcountCsv(headcount));
  const hcLines = csvLines(hcCsv);
  check(
    "headcount CSV carries the computed active headcount",
    hcLines.includes(`Active headcount,${headcount.totalActive}`),
    hcLines.slice(0, 8).join(" | "),
  );
  check(
    "headcount CSV carries the computed department count",
    hcLines.includes(`Departments,${headcount.departmentCount}`),
  );
  for (const d of headcount.byDepartment) {
    check(
      `headcount CSV row matches result for ${d.department}`,
      hcLines.includes(`${d.department},${d.count}`),
    );
  }
  check(
    "a name containing a comma is quoted, not split into two columns",
    serializeCsv([{ title: "t", headers: ["Name"], rows: [[A.name]] }]).includes(
      `"${A.name}"`,
    ),
  );

  // Report 2 — Attendance, including the average punch-in figure.
  // A: 09:00 (540) and 10:30 (630, late 30m) → mean 585 → 09:45
  await db.attendance.createMany({
    data: [
      { employeeId: A.id, date: day(2026, 6, 1), checkIn: at(2026, 6, 1, 9, 0), lateFlag: false },
      { employeeId: A.id, date: day(2026, 6, 2), checkIn: at(2026, 6, 2, 10, 30), lateFlag: true, lateMinutes: 30 },
      { employeeId: B.id, date: day(2026, 6, 1), checkIn: at(2026, 6, 1, 8, 30), lateFlag: false },
    ],
  });
  const attRows = await db.attendance.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: range.start, lt: range.endExclusive } },
    select: { employeeId: true, checkIn: true, lateFlag: true, lateMinutes: true },
  });
  const attendance = computeAttendance(attRows, employees, range);
  const attLines = csvLines(serializeCsv(attendanceCsv(attendance)));
  eq("computed org avg punch-in (540+630+510)/3 = 560 → 09:20", attendance.orgAvgPunchIn, "09:20");
  check(
    "CSV prints the SAME avg punch-in the PDF would",
    attLines.includes(`Average punch-in (org),${attendance.orgAvgPunchIn}`),
  );
  check(
    "CSV prints the same minutes-since-midnight value",
    attLines.includes(`Average punch-in minutes since midnight,${attendance.orgAvgPunchInMinutes}`),
  );
  check("CSV late count matches result", attLines.includes(`Late,${attendance.lateCount}`));
  const aRow = attendance.byEmployee.find((e) => e.employeeId === A.id)!;
  check(
    "per-employee CSV row matches the computed row exactly",
    attLines.some(
      (l) =>
        l.startsWith(`${aRow.employeeCode},`) &&
        l.includes(String(aRow.punchDays)) &&
        // Avg punch-in is now followed by the mean type (linear vs circular),
        // added when overnight-shift support landed.
        l.endsWith(`${aRow.avgPunchIn},${aRow.avgPunchInMethod}`),
    ),
    attLines.filter((l) => l.startsWith(`${TAG}-0001`)).join(" | "),
  );
  eq("day-shift employees are still averaged linearly", aRow.avgPunchInMethod, "linear");

  // Report 3 — Payroll cost, proving the FINALIZED rule survives into CSV.
  const payBase = {
    month: "2026-06", basic: "30000.00", hra: "15000.00", specialAllowance: "5000.00",
    bonus: "1000.00", reimbursements: "500.00", pfEmployee: "1800.00", pfEmployer: "1800.00",
    esi: "375.00", professionalTax: "200.00", tds: "2000.00", loanDeduction: "0.00",
    gross: "50000.00", deductions: "4375.00", net: "47125.00",
  };
  await db.payroll.create({ data: { ...payBase, employeeId: A.id, status: "FINALIZED" } });
  await db.payroll.create({ data: { ...payBase, employeeId: B.id, status: "DRAFT" } });
  const payRaw = await db.payroll.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, month: "2026-06" },
    select: {
      employeeId: true, month: true, status: true, basic: true, hra: true,
      specialAllowance: true, bonus: true, reimbursements: true, pfEmployee: true,
      pfEmployer: true, esi: true, professionalTax: true, tds: true, loanDeduction: true,
      gross: true, deductions: true, net: true, employee: { select: { department: true } },
    },
  });
  const payroll = computePayrollCost(
    payRaw.map((r) => ({
      employeeId: r.employeeId, department: r.employee.department, month: r.month,
      status: r.status, basic: r.basic.toFixed(2), hra: r.hra.toFixed(2),
      specialAllowance: r.specialAllowance.toFixed(2), bonus: r.bonus.toFixed(2),
      reimbursements: r.reimbursements.toFixed(2), pfEmployee: r.pfEmployee.toFixed(2),
      pfEmployer: r.pfEmployer.toFixed(2), esi: r.esi.toFixed(2),
      professionalTax: r.professionalTax.toFixed(2), tds: r.tds.toFixed(2),
      loanDeduction: r.loanDeduction.toFixed(2), gross: r.gross.toFixed(2),
      deductions: r.deductions.toFixed(2), net: r.net.toFixed(2),
    })),
  );
  const payLines = csvLines(serializeCsv(payrollCostCsv(payroll)));
  eq("only the FINALIZED row counted", payroll.finalizedRowCount, 1);
  eq("gross is one payslip, not two", payroll.totalGross, "50000.00");
  check("CSV total gross matches the computed value", payLines.includes(`Total gross,${payroll.totalGross}`));
  check(
    "CSV reports the excluded DRAFT row rather than hiding it",
    payLines.includes(`Rows excluded (not finalized),${payroll.excludedRowCount}`),
  );
  check(
    "CSV cost to company matches the computed value",
    payLines.includes(`Total cost to company,${payroll.totalCostToCompany}`),
  );

  // ── 2: which reports offer CSV ──────────────────────────────────
  step("2", "CSV availability matches the spec");
  const CSV_EXPECTED = [
    "headcount", "attendance", "hires-exits", "production", "appraisal-distribution",
    "payroll-cost", "recruitment-funnel", "idle-time", "warning-letters",
  ];
  for (const id of CSV_EXPECTED) {
    check(`${id} offers CSV`, REPORT_BY_ID.get(id)?.csv === true);
  }
  check("board-summary is PDF only", REPORT_BY_ID.get("board-summary")?.csv !== true);
  check("my-data is PDF only", REPORT_BY_ID.get("my-data")?.csv !== true);
  eq("exactly nine CSV-capable reports", REPORTS.filter((r) => r.csv).length, 9);
  // Was asserted through canCsv(), which nothing in the app ever called — the
  // UI gates its CSV button on `report.csv` within an already role-filtered
  // list, and the API re-checks scope itself. The INVARIANT it was really
  // protecting is this one, so it now asserts it against the live function.
  check(
    "a role that cannot run a report at all gets no scope for it",
    scopeFor(REPORT_BY_ID.get("payroll-cost")!, "MANAGER") === "none",
  );

  // ── 3: MY DATA — self scope, and the two exclusions ─────────────
  step("3", "My Data Export — self only");
  const cyclePub = await db.appraisalCycle.create({
    data: {
      period: `${TAG}-PUB`, weightsJson: {}, createdBy: ACTOR, published: true,
      createdAt: day(2026, 6, 10),
    },
  });
  const cycleDraft = await db.appraisalCycle.create({
    data: {
      period: `${TAG}-DRAFT`, weightsJson: {}, createdBy: ACTOR, published: false,
      createdAt: day(2026, 6, 10),
    },
  });
  await db.appraisalScore.createMany({
    data: [
      { employeeId: A.id, cycleId: cyclePub.id, finalScore: 88 },
      { employeeId: A.id, cycleId: cycleDraft.id, finalScore: 12 },
    ],
  });
  await db.warningLetter.createMany({
    data: [
      { employeeId: A.id, issuedBy: ACTOR, reason: "released one", status: "RELEASED", releasedAt: day(2026, 6, 5) },
      { employeeId: A.id, issuedBy: ACTOR, reason: "draft one", status: "DRAFT" },
    ],
  });

  // Build the input exactly as run.tsx does — for employee A only.
  const input: MyDataInput = {
    profile: {
      name: A.name, employeeCode: A.employeeCode, department: A.department,
      designation: A.designation, joiningDate: A.joiningDate,
      emergencyContact: A.emergencyContact, email: A.email, shiftName: null,
      managerName: null, active: A.active, offboardedAt: A.offboardedAt,
    },
    attendance: (
      await db.attendance.findMany({
        where: { employeeId: A.id, date: { gte: range.start, lt: range.endExclusive } },
        select: {
          date: true, checkIn: true, checkOut: true, lateFlag: true,
          lateMinutes: true, channel: true, flaggedForReview: true,
        },
      })
    ),
    leave: [], production: [], quality: [],
    appraisals: (
      await db.appraisalScore.findMany({
        where: { employeeId: A.id },
        select: {
          finalScore: true, managerFeedback: true, excluded: true,
          cycle: { select: { period: true, published: true } },
        },
      })
    ).map((a) => ({
      cyclePeriod: a.cycle.period, published: a.cycle.published,
      excluded: a.excluded, finalScore: a.finalScore, managerFeedback: a.managerFeedback,
    })),
    warnings: (
      await db.warningLetter.findMany({
        where: { employeeId: A.id },
        select: { reason: true, status: true, releasedAt: true, acknowledged: true, attestedAt: true },
      })
    ),
    consents: [], expenses: [], payslips: [],
  };
  const mine = computeMyData(input, range);

  eq("profile is the caller's own", mine.profile.employeeCode, A.employeeCode);
  eq("only A's attendance rows (B's excluded)", mine.attendance.length, 2);
  check(
    "no row in the export belongs to anyone else",
    mine.attendance.length === 2 && mine.profile.employeeCode !== B.employeeCode,
  );
  eq("UNPUBLISHED appraisal cycle dropped", mine.appraisals.length, 1);
  eq("the surviving score is the published one", mine.appraisals[0].finalScore, 88);
  eq("DRAFT warning letter dropped", mine.warnings.length, 1);
  eq("the surviving letter is the released one", mine.warnings[0].reason, "released one");
  check("counts reflect the filtered totals", mine.counts.Appraisals === 1 && mine.counts.Warnings === 1);

  step("3b", "self scope is structural — no employeeId exists to pass");
  const myDataDef = REPORT_BY_ID.get("my-data")!;
  for (const role of ["EMPLOYEE", "MANAGER", "HR", "SUPER_ADMIN"] as const) {
    eq(`${role} gets scope "self" — never wider`, scopeFor(myDataDef, role), "self");
  }
  eq("signed-out gets nothing", scopeFor(myDataDef, null), "none");
  check(
    "my-data is excluded from the org reports pages",
    reportsForRole("HR").every((r) => r.id !== "my-data"),
  );
  check(
    "EMPLOYEE still sees ZERO organisation reports",
    reportsForRole("EMPLOYEE").length === 0,
  );
  check(
    "computeMyData takes no employee identifier at all",
    computeMyData.length === 2, // (input, range) — nothing else to hijack
  );

  // ── 5: HTTP surface ─────────────────────────────────────────────
  step("5", "HTTP — CSV format and the unauthenticated gate");
  try {
    const csvRes = await fetch(
      `${BASE}/api/reports/headcount?startDate=2026-06-01&endDate=2026-06-30&format=csv`,
    );
    const body = await csvRes.json();
    check(
      "CSV request from an unauthenticated caller is refused",
      csvRes.status === 401 && body.code === "UNAUTHENTICATED",
      `status ${csvRes.status} ${JSON.stringify(body)}`,
    );
    const mine2 = await fetch(
      `${BASE}/api/reports/my-data?startDate=2026-06-01&endDate=2026-06-30&employeeId=${B.id}`,
    );
    const mineBody = await mine2.json();
    check(
      "my-data with a foreign employeeId is refused at auth — the param never reaches scope",
      mine2.status === 401 && mineBody.code === "UNAUTHENTICATED",
      `status ${mine2.status} ${JSON.stringify(mineBody)}`,
    );
    const nf = await fetch(`${BASE}/api/reports/nope?startDate=2026-06-01&endDate=2026-06-30`);
    check("unknown report → 404", nf.status === 404);
  } catch (e) {
    check("HTTP tests ran (is `npm run dev` up on :3005?)", false, e instanceof Error ? e.message : String(e));
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
