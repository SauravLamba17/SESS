// Load-test seed — TEST DATABASE ONLY (guarded by ltdb.ts + lt-run.mjs).
// 80 users (1 employee-less Super Admin, 3 HR, 8 Managers, 68 Employees),
// 4 departments, Day + Night shifts, 3 years of history (Oct 2023 – Oct 2026).
// Payroll is built with the app's own assemblePayrollRow/computeGrossNet so
// every finalized total is exactly what the app would have produced.
//
//   node scripts/loadtest/lt-run.mjs --session -- node scripts/loadtest/seed.ts
process.env.TZ = "Asia/Kolkata";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { client, rng, chunk } from "./ltdb.ts";
import { assemblePayrollRow } from "../../lib/payroll/assemble.ts";
import { computeGrossNet } from "../../lib/payroll/compute.ts";
import { lateMinutesForShift } from "../../lib/attendance/validation.ts";

const db = client({ connectionLimit: 5 });
const R = rng(20261015);
const D = (v: number | string) => new Prisma.Decimal(v);
const r2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const id = () => randomUUID();

const DEPTS = ["Assembly", "Quality", "Packaging", "Maintenance"] as const;
const WINDOW_START = new Date(2023, 9, 1); // 1 Oct 2023
const ATT_END = new Date(2026, 9, 14); // 14 Oct 2026 (yesterday)
const PAY_MONTHS: string[] = [];
for (let y = 2023, m = 10; y < 2026 || (y === 2026 && m <= 9); m === 12 ? (y++, (m = 1)) : m++)
  PAY_MONTHS.push(`${y}-${String(m).padStart(2, "0")}`);

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const at = (d: Date, h: number, m: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
const monthStart = (p: string) => new Date(+p.slice(0, 4), +p.slice(5, 7) - 1, 1);
const monthEnd = (p: string) => new Date(+p.slice(0, 4), +p.slice(5, 7), 1); // exclusive

const HOLIDAYS: [string, string][] = [];
for (const y of [2023, 2024, 2025, 2026])
  for (const [md, n] of [["01-26", "Republic Day"], ["03-14", "Holi"], ["08-15", "Independence Day"], ["10-02", "Gandhi Jayanti"], ["11-01", "Diwali"], ["12-25", "Christmas"]] as const) {
    const d = `${y}-${md}`;
    if (d >= "2023-10-01" && d <= "2026-12-31") HOLIDAYS.push([d, n]);
  }
const holidaySet = new Set(HOLIDAYS.map((h) => h[0]));

async function insert<T>(label: string, model: { createMany: (a: { data: T[] }) => Promise<unknown> }, rows: T[], size = 2000) {
  for (const part of chunk(rows, size)) await model.createMany({ data: part });
  console.log(`  ${label.padEnd(22)} ${rows.length}`);
}

async function main() {
  const t0 = Date.now();
  if ((await db.employee.count()) > 0) throw new Error("Test DB already seeded — refusing to double-seed");

  // ── Shifts ──
  const DAY = { id: id(), name: "Day Shift", startTime: "09:00", endTime: "17:00", gracePeriodMinutes: 10, createdBy: "lt_hr_1" };
  const NIGHT = { id: id(), name: "Night Shift", startTime: "18:00", endTime: "03:00", gracePeriodMinutes: 10, createdBy: "lt_hr_1" };
  await db.shift.createMany({ data: [DAY, NIGHT] });

  // ── People ──
  type Emp = {
    id: string; code: string; name: string; dept: string; role: "HR" | "MANAGER" | "EMPLOYEE";
    managerId: string | null; shift: typeof DAY; joining: Date; off: Date | null; clerk: string;
    basic: number; raise: boolean; consent: boolean;
  };
  const emps: Emp[] = [];
  const mk = (n: number, role: Emp["role"], dept: string, managerId: string | null): Emp => {
    const joinedInWindow = role === "EMPLOYEE" && R.chance(0.22);
    const joining = joinedInWindow
      ? addDays(WINDOW_START, R.int(30, 900))
      : new Date(R.int(2018, 2023), R.int(0, 8), R.int(1, 28));
    const code = `LT-${String(n).padStart(4, "0")}`;
    return {
      id: id(), code, name: `${role === "HR" ? "HR" : role === "MANAGER" ? "Manager" : "Staff"} ${n}`, dept, role, managerId,
      shift: role === "EMPLOYEE" && R.chance(0.25) ? NIGHT : DAY, joining, off: null, clerk: `lt_user_${code}`,
      basic: role === "MANAGER" ? R.int(55, 75) * 1000 : role === "HR" ? R.int(45, 60) * 1000 : R.int(18, 35) * 1000,
      raise: R.chance(0.5), consent: role === "EMPLOYEE" && R.chance(0.45),
    };
  };
  let n = 1;
  for (let i = 0; i < 3; i++) emps.push(mk(n++, "HR", DEPTS[i], null));
  const managers: Emp[] = [];
  for (const d of DEPTS) for (let k = 0; k < 2; k++) { const m = mk(n++, "MANAGER", d, null); managers.push(m); emps.push(m); }
  for (let i = 0; i < 68; i++) {
    const d = DEPTS[i % 4];
    const m = managers.filter((x) => x.dept === d)[i % 2];
    emps.push(mk(n++, "EMPLOYEE", d, m.id));
  }
  // Five leavers inside the window.
  for (const e of emps.filter((x) => x.role === "EMPLOYEE").slice(0, 5)) {
    const off = addDays(new Date(2024, 5, 1), R.int(0, 700));
    if (off > e.joining) e.off = off;
  }
  const byId = new Map(emps.map((e) => [e.id, e]));
  const SA_CLERK = "lt_user_SUPERADMIN";
  const HR_CLERK = emps[0].clerk;

  await db.employee.createMany({
    data: emps.map((e) => ({
      id: e.id, employeeCode: e.code, name: e.name, department: e.dept,
      designation: e.role === "MANAGER" ? "Team Lead" : e.role === "HR" ? "HR Executive" : "Operator",
      shiftId: e.shift.id, managerId: null, joiningDate: e.joining, email: `${e.code.toLowerCase()}@loadtest.invalid`,
      active: e.off === null, offboardedAt: e.off,
      scheduledRedactionAt: e.off ? new Date(e.off.getFullYear() + 5, e.off.getMonth(), e.off.getDate()) : null,
    })),
  });
  // managerId in a second pass (self-relation).
  for (const m of managers)
    await db.employee.updateMany({ where: { id: { in: emps.filter((e) => e.managerId === m.id).map((e) => e.id) } }, data: { managerId: m.id } });

  const userId = new Map<string, string>();
  const users = [{ id: id(), clerkId: SA_CLERK, role: "SUPER_ADMIN" as const, employeeId: null }];
  for (const e of emps) { const u = { id: id(), clerkId: e.clerk, role: e.role, employeeId: e.id }; users.push(u as never); userId.set(e.id, u.id); }
  await insert("User", db.user, users);
  console.log(`  Employee               ${emps.length}  (HR 3, Managers 8, Staff 68; ${emps.filter((e) => e.off).length} offboarded)`);

  await insert("Holiday", db.holiday, HOLIDAYS.map(([d, name]) => ({ id: id(), name, date: new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)), createdBy: HR_CLERK })));

  // ── Formula + appraisal cycles ──
  const weights = { punctuality: 20, production: 35, quality: 35, feedback: 10, warningPenaltyPoints: 2, punctualityFrequencyWeight: 70, punctualitySeverityWeight: 30, punctualitySeverityCapMinutes: 60 };
  await db.appraisalFormula.create({ data: { department: null, weightsJson: weights, updatedBy: SA_CLERK } });

  // ── Leave (decided before attendance so approved days are skipped) ──
  const leaveDays = new Set<string>();
  const leaves: Prisma.LeaveRequestCreateManyInput[] = [];
  for (const e of emps) {
    const mgr = e.managerId ? byId.get(e.managerId)! : null;
    for (let y = 0; y < 12; y++) {
      const s = addDays(WINDOW_START, R.int(0, 1100));
      if (s < e.joining || (e.off && s > e.off) || s > new Date(2026, 10, 30)) continue;
      const len = R.int(0, 2);
      const future = s > ATT_END;
      const status = future ? "PENDING" : R.chance(0.88) ? "APPROVED" : "REJECTED";
      leaves.push({ id: id(), employeeId: e.id, startDate: s, endDate: addDays(s, len), reason: R.pick(["Family function", "Medical", "Personal work", "Travel", "Festival"]), status, approvedBy: status === "PENDING" ? null : (mgr ?? emps[0]).clerk, createdAt: addDays(s, -R.int(2, 15)) });
      if (status === "APPROVED") for (let k = 0; k <= len; k++) leaveDays.add(`${e.id}|${ymd(addDays(s, k))}`);
    }
  }
  await insert("LeaveRequest", db.leaveRequest, leaves);

  // ── Attendance / production / quality / idle ──
  const att: Prisma.AttendanceCreateManyInput[] = [];
  const prod: Prisma.ProductionCreateManyInput[] = [];
  const qual: Prisma.QualityReportCreateManyInput[] = [];
  const idle: Prisma.IdleLogCreateManyInput[] = [];
  for (let d = new Date(WINDOW_START); d <= ATT_END; d = addDays(d, 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6 || holidaySet.has(ymd(d))) continue;
    for (const e of emps) {
      if (d < e.joining || (e.off && d > e.off)) continue;
      if (leaveDays.has(`${e.id}|${ymd(d)}`) || R.chance(0.03)) continue;
      const night = e.shift === NIGHT;
      const late = R.chance(0.1);
      const inAt = night
        ? at(d, 17, 45 + (late ? R.int(26, 70) : R.int(0, 24)))
        : at(d, 8, 40 + (late ? R.int(31, 80) : R.int(0, 29)));
      const outAt = night ? at(addDays(d, 1), 2, R.int(45, 75)) : at(d, 17, R.int(0, 55));
      const lm = lateMinutesForShift(inAt, e.shift.startTime, e.shift.gracePeriodMinutes, e.shift.endTime);
      att.push({ id: id(), employeeId: e.id, date: d, checkIn: inAt, checkOut: outAt, channel: "WEB", lateFlag: lm !== null, lateMinutes: lm, checkInNote: "Starting line work" });
      if (e.role === "EMPLOYEE") {
        prod.push({ id: id(), employeeId: e.id, date: d, unitsProduced: R.int(70, 125), targetUnits: 100 });
        if (dow === 5) qual.push({ id: id(), employeeId: e.id, date: d, defectCount: R.int(0, 6), qualityScore: R.int(68, 100), reviewedBy: byId.get(e.managerId!)!.clerk });
        if (e.consent && d >= new Date(2024, 0, 1)) idle.push({ id: id(), employeeId: e.id, date: d, idleMinutes: R.int(15, 90), activeMinutes: R.int(330, 450) });
      }
    }
  }
  await insert("Attendance", db.attendance, att, 3000);
  await insert("Production", db.production, prod, 3000);
  await insert("QualityReport", db.qualityReport, qual, 3000);
  await insert("IdleLog", db.idleLog, idle, 3000);
  const consentEmps = emps.filter((e) => e.consent);
  await insert("ConsentRecord", db.consentRecord, consentEmps.map((e) => ({ id: id(), employeeId: e.id, consentType: "IDLE_TRACKING", givenOn: new Date(2024, 0, 1) })));
  await insert("AgentToken", db.agentToken, consentEmps.filter((e) => !e.off).map((e) => ({ id: id(), employeeId: e.id, token: `lt_agent_${randomUUID()}`, lastSeenAt: at(ATT_END, 17, 0) })));

  // ── Targets ──
  const targets: Prisma.MonthlyTargetCreateManyInput[] = [];
  for (const e of emps.filter((x) => x.role === "EMPLOYEE"))
    for (const p of [...PAY_MONTHS, "2026-10"]) if (monthEnd(p) > e.joining && (!e.off || monthStart(p) <= e.off))
      targets.push({ id: id(), employeeId: e.id, period: p, targetUnits: 2100, setBy: byId.get(e.managerId!)!.clerk });
  await insert("MonthlyTarget", db.monthlyTarget, targets);

  // ── Salary structures (+ one superseded version for ~half) ──
  const RAISE_AT = new Date(2025, 3, 1);
  const struct = (e: Emp, after: boolean) => {
    const basic = D(after && e.raise ? Math.round(e.basic * 1.08) : e.basic);
    return { basic, hra: r2(basic.mul("0.4")), specialAllowance: r2(basic.mul("0.15")) };
  };
  await insert("SalaryStructure", db.salaryStructure, emps.map((e) => ({ id: id(), employeeId: e.id, ...struct(e, true), effectiveFrom: e.raise && e.joining < RAISE_AT ? RAISE_AT : e.joining, setBy: HR_CLERK })));
  await insert("SalaryStructureHistory", db.salaryStructureHistory, emps.filter((e) => e.raise && e.joining < RAISE_AT).map((e) => ({ id: id(), employeeId: e.id, ...struct(e, false), effectiveFrom: e.joining, effectiveTo: RAISE_AT, versionNumber: 1, setBy: HR_CLERK, supersededBy: HR_CLERK })));

  // ── Expense claims ──
  type Claim = Prisma.ExpenseClaimCreateManyInput & { _period: string };
  const claims: Claim[] = [];
  for (const e of emps)
    for (const p of [...PAY_MONTHS, "2026-10"]) {
      if (!(monthEnd(p) > e.joining && (!e.off || monthStart(p) <= e.off)) || !R.chance(0.35)) continue;
      const date = addDays(monthStart(p), R.int(0, 13));
      const current = p === "2026-10";
      const status = current ? R.pick(["PENDING", "APPROVED"] as const) : R.chance(0.9) ? "APPROVED" : "REJECTED";
      const mgr = e.managerId ? byId.get(e.managerId)! : emps[0];
      claims.push({ id: id(), employeeId: e.id, category: R.pick(["TRAVEL", "FOOD", "ACCOMMODATION", "COMMUNICATION", "MISCELLANEOUS"] as const), amount: D(`${R.int(150, 4800)}.${String(R.int(0, 99)).padStart(2, "0")}`), date, description: "Site visit expenses", status, approvedBy: status === "PENDING" ? null : mgr.clerk, approvedAt: status === "PENDING" ? null : addDays(date, 2), _period: p });
    }

  // ── Advances: 6 fully recovered in 2024, 4 still ACTIVE with one installment left ──
  const staff = emps.filter((e) => e.role === "EMPLOYEE" && !e.off && e.joining < new Date(2023, 9, 1));
  type Adv = { id: string; employeeId: string; principal: number; monthly: number; remaining: Prisma.Decimal; from: string; issuedAt: Date };
  const advances: Adv[] = [
    ...staff.slice(0, 6).map((e) => ({ id: id(), employeeId: e.id, principal: 30000, monthly: 5000, remaining: D(30000), from: "2024-02", issuedAt: new Date(2024, 0, 20) })),
    ...staff.slice(6, 10).map((e) => ({ id: id(), employeeId: e.id, principal: 20000, monthly: 5000, remaining: D(20000), from: "2026-06", issuedAt: new Date(2026, 4, 25) })),
  ];

  // ── Finalized payroll, month by month, with the app's own arithmetic ──
  const payroll: Prisma.PayrollCreateManyInput[] = [];
  const claimToPayroll = new Map<string, string>();
  for (const p of PAY_MONTHS) {
    const [y, m] = p.split("-").map(Number);
    for (const e of emps) {
      if (!(monthEnd(p) > e.joining && (!e.off || monthStart(p) <= e.off))) continue;
      const myClaims = claims.filter((c) => c.employeeId === e.id && c._period === p && c.status === "APPROVED");
      const adv = advances.find((a) => a.employeeId === e.id && p >= a.from && a.remaining.greaterThan(0));
      const row = assemblePayrollRow({
        period: p, structure: struct(e, monthStart(p) >= RAISE_AT), joiningDate: e.joining, offboardedAt: e.off,
        claims: myClaims.map((c) => ({ id: c.id!, amount: new Prisma.Decimal(c.amount as Prisma.Decimal) })),
        advance: adv ? { id: adv.id, monthlyDeduction: D(adv.monthly), remainingBalance: adv.remaining } : null, settlement: false,
      });
      // HR-entered statutory lines (never computed by the app — entered here as HR would).
      const pfEmployee = r2(row.basic.mul("0.12"));
      const esi = row.gross.lessThanOrEqualTo(21000) ? r2(row.gross.mul("0.0075")) : D(0);
      const professionalTax = D(200);
      const tds = row.gross.greaterThan(60000) ? D(2500) : D(0);
      const bonus = m === 10 || (m === 11 && y === 2025) ? D(5000) : D(0);
      const t = computeGrossNet({ basic: row.basic, hra: row.hra, specialAllowance: row.specialAllowance, pfEmployee, esi, professionalTax, tds, loanDeduction: row.loanDeduction, bonus, reimbursements: row.reimbursements });
      const pid = id();
      for (const c of row.claimIds) claimToPayroll.set(c, pid);
      if (adv) adv.remaining = adv.remaining.minus(row.loanDeduction);
      const fin = new Date(y, m, 3, 11, 0);
      payroll.push({ id: pid, employeeId: e.id, month: p, basic: row.basic, hra: row.hra, specialAllowance: row.specialAllowance, bonus, daysWorked: row.daysWorked, daysInMonth: row.daysInMonth, pfEmployee, pfEmployer: pfEmployee, esi, professionalTax, tds, tdsSource: tds.isZero() ? "" : `CA-provided, FY${y}`, loanDeduction: row.loanDeduction, reimbursements: row.reimbursements, gross: t.gross, deductions: t.deductions, net: t.net, status: "FINALIZED", processedBy: HR_CLERK, finalizedBy: SA_CLERK, finalizedAt: fin });
    }
  }
  await insert("Payroll", db.payroll, payroll);
  await insert("ExpenseClaim", db.expenseClaim, claims.map(({ _period, ...c }) => ({ ...c, includedInPayrollId: claimToPayroll.get(c.id!) ?? null })));
  await insert("SalaryAdvance", db.salaryAdvance, advances.map((a) => ({ id: a.id, employeeId: a.employeeId, principalAmount: D(a.principal), monthlyDeduction: D(a.monthly), remainingBalance: a.remaining, status: a.remaining.isZero() ? "CLOSED" : "ACTIVE", issuedBy: HR_CLERK, issuedAt: a.issuedAt })));

  // ── Appraisal: 12 published quarterly cycles + 1 open cycle for the load test ──
  const cycles: Prisma.AppraisalCycleCreateManyInput[] = [];
  const scores: Prisma.AppraisalScoreCreateManyInput[] = [];
  for (let y = 2023, q = 4, k = 0; k < 12; k++, q === 4 ? (y++, (q = 1)) : q++) {
    const cid = id();
    cycles.push({ id: cid, period: `${y}-Q${q}`, department: null, weightsJson: weights, createdBy: HR_CLERK, published: true, createdAt: new Date(y, q * 3, 5) });
    const qEnd = new Date(y, q * 3, 1);
    for (const e of emps) if (e.joining < qEnd && (!e.off || e.off >= new Date(y, (q - 1) * 3, 1))) {
      const c = { punctuality: R.int(55, 100), production: R.int(50, 100), quality: R.int(60, 100), feedback: R.int(50, 100) };
      scores.push({ id: id(), employeeId: e.id, cycleId: cid, componentScoresJson: c, finalScore: Math.round((c.punctuality * 20 + c.production * 35 + c.quality * 35 + c.feedback * 10) / 100), managerFeedbackScore: c.feedback, managerFeedback: "Consistent work this quarter." });
    }
  }
  cycles.push({ id: id(), period: "2026-09", department: null, weightsJson: weights, createdBy: HR_CLERK, published: false });
  await insert("AppraisalCycle", db.appraisalCycle, cycles);
  await insert("AppraisalScore", db.appraisalScore, scores, 3000);

  // ── Warning letters ──
  const warnings: Prisma.WarningLetterCreateManyInput[] = [];
  for (let i = 0; i < 40; i++) {
    const e = R.pick(emps.filter((x) => x.role === "EMPLOYEE"));
    const created = addDays(new Date(Math.max(e.joining.getTime(), WINDOW_START.getTime())), R.int(10, 300));
    const released = i < 32;
    const ack = released && R.chance(0.6);
    warnings.push({ id: id(), employeeId: e.id, issuedBy: byId.get(e.managerId!)!.clerk, reason: R.pick(["Repeated late arrival", "Safety procedure breach", "Unauthorised absence"]), status: released ? "RELEASED" : "DRAFT", releasedBy: released ? HR_CLERK : null, releasedAt: released ? addDays(created, 2) : null, acknowledged: ack, attestedName: ack ? e.name : null, attestedAt: ack ? addDays(created, 4) : null, createdAt: created });
  }
  await insert("WarningLetter", db.warningLetter, warnings);

  // ── Recruitment ──
  const reqs = DEPTS.flatMap((d, i) => [
    { id: id(), title: `${d} Operator`, department: d, description: "Line role.", openings: 3, status: "OPEN" as const, createdBy: HR_CLERK, createdAt: new Date(2026, 6, 1 + i) },
    { id: id(), title: `${d} Supervisor`, department: d, description: "Supervisory role.", openings: 1, status: "CLOSED" as const, createdBy: HR_CLERK, createdAt: new Date(2025, 2, 1 + i), closedAt: new Date(2025, 5, 1) },
  ]);
  await insert("JobRequisition", db.jobRequisition, reqs);
  const cands: Prisma.CandidateCreateManyInput[] = [];
  const apps: Prisma.ApplicationCreateManyInput[] = [];
  for (let i = 0; i < 180; i++) {
    const cid = id();
    const created = addDays(new Date(2025, 2, 1), R.int(0, 560));
    cands.push({ id: cid, name: `Candidate ${i + 1}`, email: `cand${i + 1}@loadtest.invalid`, phone: `90000${String(i).padStart(5, "0")}`, resumeUrl: `lt/resume-${i}.pdf`, source: R.pick(["careers", "referral", "walk-in"]), createdAt: created });
    const stage = R.pick(["APPLIED", "SCREENING", "INTERVIEW", "REJECTED", "REJECTED", "OFFER", "HIRED"] as const);
    apps.push({ id: id(), candidateId: cid, jobRequisitionId: R.pick(reqs).id, stage, rejectedReason: stage === "REJECTED" ? "Not a fit at this time" : null, createdAt: created, termsAcceptedAt: created, termsVersion: "2026-08" });
  }
  await insert("Candidate", db.candidate, cands);
  await insert("Application", db.application, apps);
  await insert("InterviewFeedback", db.interviewFeedback, apps.filter((a) => a.stage !== "APPLIED").slice(0, 90).map((a) => ({ id: id(), applicationId: a.id!, interviewerUserId: managers[0].clerk, rating: R.int(2, 5), notes: "Structured interview.", interviewDate: addDays(a.createdAt as Date, 7) })));

  // ── Engagement ──
  await insert("ShoutOut", db.shoutOut, Array.from({ length: 150 }, () => { const a = R.pick(emps), b = R.pick(emps); return { id: id(), fromEmployeeId: a.id, toEmployeeId: b.id === a.id ? emps[0].id : b.id, message: "Thanks for the help on the line!", createdAt: addDays(WINDOW_START, R.int(0, 1100)) }; }));
  const surveys = Array.from({ length: 6 }, (_, i) => ({ id: id(), question: `Pulse question ${i + 1}`, scaleMin: 1, scaleMax: 5, createdBy: HR_CLERK, active: i === 5, createdAt: addDays(WINDOW_START, i * 180) }));
  await insert("PulseSurvey", db.pulseSurvey, surveys);
  const resp: Prisma.PulseSurveyResponseCreateManyInput[] = [], recs: Prisma.SurveyResponseRecordCreateManyInput[] = [];
  for (const s of surveys) for (const e of emps) if (R.chance(0.6)) { resp.push({ id: id(), surveyId: s.id, ratingValue: R.int(1, 5) }); recs.push({ id: id(), surveyId: s.id, employeeId: e.id }); }
  await insert("PulseSurveyResponse", db.pulseSurveyResponse, resp);
  await insert("SurveyResponseRecord", db.surveyResponseRecord, recs);
  await insert("ClientMail", db.clientMail, Array.from({ length: 240 }, () => { const e = R.pick(emps.filter((x) => x.role === "EMPLOYEE")); return { id: id(), employeeId: e.id, subject: "Client follow-up", summary: "Logged by manager", taggedByManagerId: e.managerId, date: addDays(WINDOW_START, R.int(0, 1100)) }; }));

  // ── Notifications + audit trail for the seeded writes ──
  const notes: Prisma.NotificationCreateManyInput[] = [];
  for (const p of payroll) notes.push({ id: id(), recipientUserId: userId.get(p.employeeId)!, employeeId: p.employeeId, type: "PAYSLIP_READY", message: `Your payslip for ${p.month} is ready to download.`, read: p.month < "2026-09", createdAt: p.finalizedAt as Date });
  for (const l of leaves.filter((x) => x.status !== "PENDING")) notes.push({ id: id(), recipientUserId: userId.get(l.employeeId)!, employeeId: l.employeeId, type: `LEAVE_${l.status}`, message: `Your leave was ${String(l.status).toLowerCase()}.`, read: true, createdAt: addDays(l.createdAt as Date, 1) });
  await insert("Notification", db.notification, notes, 3000);

  const audit: Prisma.AuditLogCreateManyInput[] = [];
  for (const e of emps) audit.push({ id: id(), actorUserId: HR_CLERK, action: "EMPLOYEE_ONBOARDED", targetEntity: e.id, timestamp: e.joining });
  for (const l of leaves.filter((x) => x.status !== "PENDING")) audit.push({ id: id(), actorUserId: l.approvedBy!, action: `LEAVE_${l.status}`, targetEntity: l.id!, timestamp: addDays(l.createdAt as Date, 1) });
  for (const c of claims.filter((x) => x.status !== "PENDING")) audit.push({ id: id(), actorUserId: c.approvedBy!, action: `EXPENSE_${c.status}`, targetEntity: c.id!, timestamp: c.approvedAt as Date });
  for (const p of PAY_MONTHS) for (const a of ["PAYROLL_RUN_CREATED", "PAYROLL_RUN_SUBMITTED", "PAYROLL_RUN_FINALIZED"]) audit.push({ id: id(), actorUserId: a.endsWith("FINALIZED") ? SA_CLERK : HR_CLERK, action: a, targetEntity: p, timestamp: new Date(+p.slice(0, 4), +p.slice(5, 7), 2) });
  for (const w of warnings.filter((x) => x.status === "RELEASED")) audit.push({ id: id(), actorUserId: HR_CLERK, action: "WARNING_RELEASED", targetEntity: w.id!, timestamp: w.releasedAt as Date });
  for (const c of cycles) audit.push({ id: id(), actorUserId: HR_CLERK, action: c.published ? "APPRAISAL_PUBLISHED" : "APPRAISAL_CYCLE_CREATED", targetEntity: c.id!, timestamp: new Date() });
  await insert("AuditLog", db.auditLog, audit, 3000);

  console.log(`\nseeded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => { console.error("SEED FAILED:", e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
