// Backend load test — TEST DATABASE ONLY. Run through lt-run.mjs (transaction-pooler URL):
//   node scripts/loadtest/lt-run.mjs -- node --import ./scripts/loadtest/register.mjs scripts/loadtest/harness.ts <scenario|all>
//
// Each simulated Vercel instance is its own PrismaClient with connection_limit=1
// on the transaction pooler (pgbouncer=true) — production's settings. App lib
// code reaches "its" instance through db-proxy.ts.
//
// Where a route keeps its logic inline (punch, payroll run/finalize, appraisal
// compute, bulk import, the four dashboards), the harness runs that route's
// query sequence with the same lib/ helpers — the auth check is the only step
// left out, because there is no Clerk session (by design: no auth bypass).
process.env.TZ = "Asia/Kolkata";

import { writeFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { Prisma, type PrismaClient } from "@prisma/client";
import { client, pct, queryEvents, chunk } from "./ltdb.ts";
import { instanceStore } from "./db-proxy.ts";
import { db } from "@/lib/db";
import { getEmployeeByClerkId, getUserByClerkId, getActiveEmployees } from "@/lib/data/scope";
import { attendanceValidationMode, moduleToggleValues } from "@/lib/system-settings";
import { validatePunch, resolvePunch, lateMinutesForShift, MAX_OPEN_SHIFT_HOURS } from "@/lib/attendance/validation";
import { loadOwnAttendance } from "@/lib/attendance/own-summary";
import { loadToday } from "@/lib/engagement/today";
import { getHrDashboardTotals, getPendingLeaveCount } from "@/lib/cache/dashboard";
import { getDepartments } from "@/lib/cache/departments";
import { getTeamRoster } from "@/lib/cache/employees";
import { ownIdleTotals } from "@/lib/idle/aggregate";
import { computeHeadcount, headcountOn } from "@/lib/reports/headcount";
import { computeRecruitmentFunnel } from "@/lib/reports/recruitment-funnel";
import { parseRange, ymd, monthKey } from "@/lib/reports/range";
import { currentPeriod, startOfDay } from "@/lib/period";
import { assemblePayrollRow } from "@/lib/payroll/assemble";
import { recoverLoans } from "@/lib/payroll/loan-recovery";
import { notifyEach } from "@/lib/notify";
import { resolvePeriodRange } from "@/lib/appraisal/period-range";
import { computeAppraisal, type AppraisalWeights } from "@/lib/appraisal/compute";
import { lockCycleForWrite } from "@/lib/appraisal/cycle-lock";
import { validateCsv } from "@/lib/employees/csv-import";
import { onboardEmployee } from "@/lib/employees/onboard";
import { runReport } from "@/lib/reports/run";
import { REPORTS } from "@/lib/reports/registry";
import { shiftCrossesMidnight } from "@/lib/attendance/validation";
import { loadAdminDashboard } from "@/lib/dashboard/admin";
import { loadManagerDashboard } from "@/lib/dashboard/manager";
import { loadEmployeeDashboard } from "@/lib/dashboard/employee";
import { loadRecentNotifications } from "@/lib/dashboard/notifications";
import * as before from "./before/pages.ts";

// ── instances, sampling, measurement ────────────────────────────────────────
// One simulated Vercel instance = one PrismaClient. `base` emits a query event
// per round trip (with Prisma's own duration); `db` is the same client with a
// timing extension, and is what app code gets through the proxy.
type Inst = { base: PrismaClient; db: PrismaClient; cl: number };
type Ctx = { maxCallMs: number };
const reqStore = new AsyncLocalStorage<Ctx>();
const timing = (base: PrismaClient) => base.$extends({ query: { async $allOperations({ args, query }) {
  const t = performance.now();
  try { return await query(args); }
  finally { const ctx = reqStore.getStore(); if (ctx) ctx.maxCallMs = Math.max(ctx.maxCallMs, performance.now() - t); }
} } }) as unknown as PrismaClient;
const instances = (n: number, cl = 1): Inst[] => Array.from({ length: n }, () => {
  const base = client({ connectionLimit: cl, poolTimeout: 60, countQueries: true });
  return { base, db: timing(base), cl };
});
const closeAll = (xs: Inst[]) => Promise.all(xs.map((c) => c.base.$disconnect()));
/** Connect every instance before measuring (10 at a time, up to 4 tries each); connect failures are reported, not hidden. */
async function warm(xs: Inst[]) {
  let failures = 0;
  for (const batch of chunk(xs, 10)) await Promise.all(batch.map(async (c) => {
    for (let k = 0; ; k++) { try { await c.base.$queryRaw`SELECT 1`; return; } catch (e) { failures++; if (k === 3) throw e; } }
  }));
  return { instances: xs.length, connectionLimit: xs[0]?.cl, connectFailuresBeforeRetry: failures };
}

// Distance model, set by the baseline. With pgbouncer=true Prisma sends every call as
// BEGIN · DEALLOCATE ALL · statement · COMMIT — the wrappers are 1 network round trip
// each, the statement 2 (parse, then bind/execute). RT_MS = SELECT 1 time ÷ its round
// trips. Estimated Mumbai time = measured − RT×RT_MS + RT×5 ms (an ESTIMATE).
let C = NaN, RT_MS = NaN, TS_IS_START = true;
const MUMBAI_MS_PER_RT = 5;
type Ev = { ts: number; dur: number; wrap: boolean };
const roundTrips = (evs: Ev[]) => evs.reduce((a, e) => a + (e.wrap ? 1 : 2), 0);
/** Round trips on the request's critical path: all of them when they ran one after another (connection_limit=1), fewer when they overlapped. */
function criticalRT(evs: Ev[]) {
  if (!evs.length) return 0;
  const iv = evs.map((e) => (TS_IS_START ? [e.ts, e.ts + e.dur] : [e.ts - e.dur, e.ts])).sort((a, b) => a[0] - b[0]);
  let busy = 0, [s0, e0] = iv[0];
  for (const [s1, e1] of iv.slice(1)) { if (s1 > e0) { busy += e0 - s0; s0 = s1; e0 = e1; } else e0 = Math.max(e0, e1); }
  busy += e0 - s0;
  const sum = evs.reduce((a, e) => a + e.dur, 0);
  return roundTrips(evs) * (sum > 0 ? Math.min(1, busy / sum) : 1);
}

/** Postgres backends for this database, sampled every 250 ms on a separate session-mode client. */
async function sampler() {
  const s = client({ url: process.env.DATABASE_URL_SESSION, connectionLimit: 1 });
  let peak = 0, peakActive = 0, samples = 0, stop = false;
  const loop = (async () => {
    while (!stop) {
      try {
        const [r] = await s.$queryRaw<{ n: number; a: number }[]>`
          SELECT count(*)::int AS n, count(*) FILTER (WHERE state <> 'idle')::int AS a
          FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend'`;
        peak = Math.max(peak, r.n); peakActive = Math.max(peakActive, r.a); samples++;
      } catch { /* a missed sample is not a test failure */ }
      await new Promise((r) => setTimeout(r, 250));
    }
  })();
  return { done: async () => { stop = true; await loop; await s.$disconnect(); return { peak, peakActive, samples }; } };
}

type Op = { ms: number; ok: boolean; q: number; rt: number; rtCrit: number; maxCallMs: number };
type Stat = { name: string; requests: number; ok: number; errors: Record<string, number>; ops: Op[]; wallMs: number; extra?: Record<string, unknown>; conn?: unknown };
function stat(name: string): Stat { return { name, requests: 0, ok: 0, errors: {}, ops: [], wallMs: 0 }; }
/** One request on instance c. Records time, success, round trips (query events) and the longest single Prisma call. */
async function timed<T>(s: Stat, c: Inst, fn: () => Promise<T>, also?: Stat): Promise<T | undefined> {
  const ev = queryEvents.get(c.base)!, i0 = ev.length, ctx: Ctx = { maxCallMs: 0 };
  const t = performance.now();
  let v: T | undefined, ok = false, err = "";
  try { v = await reqStore.run(ctx, () => instanceStore.run(c.db, fn)); ok = true; }
  catch (e) { err = (e as { code?: string }).code ?? String((e as Error).message ?? e).slice(0, 90); }
  const ms = performance.now() - t;
  await new Promise((r) => setTimeout(r, 5)); // query events land just after the result
  const mine = ev.slice(i0);
  const op: Op = { ms, ok, q: mine.filter((e) => !e.wrap).length, rt: roundTrips(mine), rtCrit: criticalRT(mine), maxCallMs: ctx.maxCallMs };
  for (const x of also ? [s, also] : [s]) { x.requests++; x.ops.push(op); if (ok) x.ok++; else x.errors[err] = (x.errors[err] ?? 0) + 1; }
  return v;
}
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const p3 = (xs: number[]) => { const a = sorted(xs); return { p50: Math.round(pct(a, 50)), p95: Math.round(pct(a, 95)), max: Math.round(a.at(-1) ?? NaN) }; };
const estMumbai = (o: Op) => Math.max(o.rtCrit * MUMBAI_MS_PER_RT, o.ms - o.rtCrit * RT_MS + o.rtCrit * MUMBAI_MS_PER_RT);
const core = (s: Stat) => ({
  requests: s.requests,
  successRate: s.requests ? +(100 * s.ok / s.requests).toFixed(2) : null,
  errors: s.errors,
  queriesPerOp: p3(s.ops.map((o) => o.q)),
  roundTripsPerOp: p3(s.ops.map((o) => o.rt)),
  measuredMs: p3(s.ops.map((o) => o.ms)),
  estMumbaiMs: p3(s.ops.map(estMumbai)),
  // A request would have hit P2024 at pool_timeout=10 if one Prisma call waited >10 s for the
  // connection, i.e. took >10 s beyond its own one-query cost C.
  wouldFailAt10s: { measured: s.ops.filter((o) => o.maxCallMs - C > 10_000).length, estMumbai: s.ops.filter((o) => estMumbai(o) > 10_000).length },
});
const summary = (s: Stat) => ({ scenario: s.name, ...core(s), wallSeconds: +(s.wallMs / 1000).toFixed(1), peakConnections: s.conn, ...s.extra });
const results: ReturnType<typeof summary>[] = [];
async function scenario(name: string, body: (s: Stat) => Promise<void>, extra?: () => Record<string, unknown>) {
  const s = stat(name);
  const smp = await sampler();
  const t = performance.now();
  await body(s);
  s.wallMs = performance.now() - t;
  s.conn = await smp.done();
  s.extra = extra?.();
  const r = summary(s);
  results.push(r);
  console.log(JSON.stringify(r));
}

// ── people ──────────────────────────────────────────────────────────────────
const boot = client({ connectionLimit: 2 });
const users = await boot.user.findMany({ include: { employee: true } });
const byRole = (r: string) => users.filter((u) => u.role === r && (u.role === "SUPER_ADMIN" || u.employee?.active));
const SA = byRole("SUPER_ADMIN")[0], HR = byRole("HR"), MGR = byRole("MANAGER"), EMP = byRole("EMPLOYEE");
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

// ── (a) the punch route's sequence ──────────────────────────────────────────
async function punch(clerkId: string) {
  const now = new Date();
  const employee = await getEmployeeByClerkId(clerkId);
  if (!employee || !employee.active) throw new Error("no active employee");
  const validation = validatePunch({ ip: "203.0.113.10", lat: null, long: null, at: now }, await attendanceValidationMode());
  const shift = employee.shiftId ? await db.shift.findUnique({ where: { id: employee.shiftId } }) : null;
  const openSince = new Date(now.getTime() - MAX_OPEN_SHIFT_HOURS * 3_600_000);
  const recentRow = await db.attendance.findFirst({ where: { employeeId: employee.id, checkIn: { not: null, gte: openSince } }, orderBy: { checkIn: "desc" } });
  const decision = resolvePunch({ at: now, shift, recentRow });
  if (decision.action === "CHECK_IN") {
    const lateMinutes = shift ? lateMinutesForShift(now, shift.startTime, shift.gracePeriodMinutes, shift.endTime) : null;
    await db.attendance.create({ data: { employeeId: employee.id, date: decision.shiftDate, checkIn: now, channel: "WEB", ipAddress: "203.0.113.10", lateFlag: lateMinutes !== null, lateMinutes, checkInNote: "load test", flaggedForReview: !validation.passed, reviewReason: validation.passed ? null : validation.failures.join("; ") } });
    return "IN";
  }
  if (decision.action === "CHECK_OUT") { await db.attendance.update({ where: { id: recentRow!.id }, data: { checkOut: now } }); return "OUT"; }
  return "ALREADY";
}

// ── (b) the four dashboards, assembled as each page does ──────────────────
// LT_DASH=before runs the pre-change loaders (verbatim from git HEAD, in
// ./before/pages.ts) so before/after are measured by the same harness.
const OLD = process.env.LT_DASH === "before";
const fail = (r: unknown) => { if (r && typeof r === "object" && "error" in r && (r as { error: unknown }).error) throw new Error(String((r as { error: unknown }).error)); return r; };
async function hrFigures() {
  const now = new Date();
  const { period } = currentPeriod(now);
  const [totals, departments] = await Promise.all([getHrDashboardTotals(period, ymd(now)), getDepartments()]);
  return { period, departmentCount: departments.length, ...totals };
}
async function adminDashboard() {
  const [, d] = OLD ? await Promise.all([before.loadTodayBefore(), before.adminBefore()]) : await Promise.all([loadToday(), loadAdminDashboard()]);
  fail(d);
}
async function hrDashboard(clerkId: string) {
  if (OLD) fail((await Promise.all([before.hrNotificationsBefore(clerkId), before.loadTodayBefore(), before.hrFiguresBefore()]))[2]);
  else await Promise.all([loadRecentNotifications(clerkId, 10), loadToday(), hrFigures()]);
}
async function managerDashboard(clerkId: string) {
  const [d] = OLD ? await Promise.all([before.managerBefore(clerkId), before.loadTodayBefore()]) : await Promise.all([loadManagerDashboard(clerkId), loadToday()]);
  if (!fail(d) || !(d as { manager: unknown }).manager) throw new Error("no manager");
}
async function employeeDashboard(clerkId: string) {
  const [d] = OLD ? await Promise.all([before.employeeBefore(clerkId), before.loadTodayBefore()]) : await Promise.all([loadEmployeeDashboard(clerkId), loadToday()]);
  if (!fail(d) || !(d as { m: unknown }).m) throw new Error("no employee");
}
const ROLES = ["SUPER_ADMIN", "HR", "MANAGER", "EMPLOYEE"] as const;
async function dashboardFor(role: (typeof ROLES)[number]) {
  if (role === "SUPER_ADMIN") return adminDashboard();
  if (role === "HR") return hrDashboard(pick(HR).clerkId);
  if (role === "MANAGER") return managerDashboard(pick(MGR).clerkId);
  return employeeDashboard(pick(EMP).clerkId);
}
async function sustainedDashboards(s: Stat, insts: Inst[], seconds: number, perRole: Record<string, Stat>) {
  const until = performance.now() + seconds * 1000;
  await Promise.all(insts.map(async (inst, i) => {
    const role = ROLES[i % 4];
    while (performance.now() < until) await timed(s, inst, () => dashboardFor(role), perRole[role]);
  }));
}
const roleStats = () => Object.fromEntries(ROLES.map((r) => [r, stat(r)]));
const roleSummary = (m: Record<string, Stat>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, core(v)]));

// ── (c) payroll run → submit → finalize, and appraisal compute ─────────────
const monthEndOf = (p: string) => new Date(+p.slice(0, 4), +p.slice(5, 7), 1);
async function payrollRun(period: string, actor: string, txTimeout = 30_000) {
  const [y, m] = period.split("-").map(Number);
  const employees = await db.employee.findMany({ where: { OR: [{ active: true }, { offboardedAt: { gte: new Date(y, m - 1, 1) } }] }, select: { id: true, name: true, employeeCode: true, joiningDate: true, offboardedAt: true, salaryStructure: { select: { basic: true, hra: true, specialAllowance: true } } }, orderBy: { employeeCode: "asc" } });
  const payable = employees.filter((e) => e.salaryStructure);
  const existing = await db.payroll.findMany({ where: { month: period, employeeId: { in: payable.map((e) => e.id) }, adjustmentForPayrollId: null }, select: { employeeId: true } });
  const done = new Set(existing.map((p) => p.employeeId));
  const toCreate = payable.filter((e) => !done.has(e.id)), createIds = toCreate.map((e) => e.id);
  const [claims, advances] = await Promise.all([
    db.expenseClaim.findMany({ where: { employeeId: { in: createIds }, status: "APPROVED", includedInPayrollId: null, date: { lt: monthEndOf(period) } }, select: { id: true, employeeId: true, amount: true } }),
    db.salaryAdvance.findMany({ where: { employeeId: { in: createIds }, status: "ACTIVE" }, select: { id: true, employeeId: true, monthlyDeduction: true, remainingBalance: true }, orderBy: { issuedAt: "asc" } }),
  ]);
  const claimsBy = new Map<string, { id: string; amount: Prisma.Decimal }[]>();
  for (const c of claims) claimsBy.set(c.employeeId, [...(claimsBy.get(c.employeeId) ?? []), { id: c.id, amount: c.amount }]);
  const advBy = new Map<string, (typeof advances)[0]>();
  for (const a of advances) if (!advBy.has(a.employeeId)) advBy.set(a.employeeId, a);
  const assembled = toCreate.map((e) => ({ e, row: assemblePayrollRow({ period, structure: e.salaryStructure!, joiningDate: e.joiningDate, offboardedAt: e.offboardedAt, claims: claimsBy.get(e.id) ?? [], advance: advBy.get(e.id) ?? null, settlement: false }) }));
  return db.$transaction(async (tx) => {
    await tx.payroll.createMany({ data: assembled.map(({ e, row }) => ({ employeeId: e.id, month: period, basic: row.basic, hra: row.hra, specialAllowance: row.specialAllowance, daysWorked: row.daysWorked, daysInMonth: row.daysInMonth, reimbursements: row.reimbursements, loanDeduction: row.loanDeduction, gross: row.gross, deductions: row.deductions, net: row.net, processedBy: actor })) });
    const fresh = await tx.payroll.findMany({ where: { month: period, employeeId: { in: createIds }, isFinalSettlement: false, adjustmentForPayrollId: null }, select: { id: true, employeeId: true } });
    const byEmp = new Map(fresh.map((p) => [p.employeeId, p.id]));
    for (const [emp, mine] of claimsBy) { const pid = byEmp.get(emp); if (pid) await tx.expenseClaim.updateMany({ where: { id: { in: mine.map((c) => c.id) }, includedInPayrollId: null }, data: { includedInPayrollId: pid } }); }
    await tx.auditLog.create({ data: { actorUserId: actor, action: "PAYROLL_RUN_CREATED", targetEntity: period } });
    return { created: fresh.length, claims: claims.length };
  }, { timeout: txTimeout });
}
async function payrollSubmit(period: string, actor: string, txTimeout?: number) {
  return db.$transaction(async (tx) => {
    const u = await tx.payroll.updateMany({ where: { month: period, status: "DRAFT" }, data: { status: "SUBMITTED" } });
    await tx.auditLog.create({ data: { actorUserId: actor, action: "PAYROLL_RUN_SUBMITTED", targetEntity: period } });
    return u.count;
  }, txTimeout ? { timeout: txTimeout } : undefined);
}
async function payrollFinalize(period: string, actor: string, txTimeout = 30_000) {
  const pending = await db.payroll.findMany({ where: { month: period, status: "SUBMITTED" }, select: { id: true, employeeId: true, net: true, loanDeduction: true, isFinalSettlement: true, adjustmentForPayrollId: true, employee: { select: { employeeCode: true, name: true } } } });
  return db.$transaction(async (tx) => {
    const upd = await tx.payroll.updateMany({ where: { month: period, status: "SUBMITTED" }, data: { status: "FINALIZED", finalizedBy: actor, finalizedAt: new Date() } });
    if (upd.count !== pending.length) throw new Error(`PARTIAL:${upd.count}/${pending.length}`);
    const loans = await recoverLoans(tx, pending);
    await notifyEach(tx, pending.map((p) => ({ employeeId: p.employeeId, type: "PAYSLIP_READY" as const, message: `Your payslip for ${period} is ready to download.` })));
    await tx.auditLog.create({ data: { actorUserId: actor, action: "PAYROLL_RUN_FINALIZED", targetEntity: period } });
    return { finalized: upd.count, ...loans };
  }, { timeout: txTimeout });
}
const parseWeights = (w: Record<string, unknown>): AppraisalWeights => ({ punctuality: Number(w.punctuality) || 0, production: Number(w.production) || 0, quality: Number(w.quality) || 0, feedback: Number(w.feedback) || 0, warningPenaltyPoints: Number(w.warningPenaltyPoints) || 0, punctualityFrequencyWeight: Number(w.punctualityFrequencyWeight), punctualitySeverityWeight: Number(w.punctualitySeverityWeight), punctualitySeverityCapMinutes: Number(w.punctualitySeverityCapMinutes) });
async function appraisalCompute(cycleId: string, actor: string, txTimeout = 60_000) {
  const cycle = await db.appraisalCycle.findUnique({ where: { id: cycleId } });
  if (!cycle || cycle.published) throw new Error("cycle not computable");
  const range = resolvePeriodRange(cycle.period)!;
  const weights = parseWeights(cycle.weightsJson as Record<string, unknown>);
  const employees = await getActiveEmployees(cycle.department);
  const ids = employees.map((e) => e.id), inRange = { gte: range.start, lt: range.end };
  const [attTotal, attLate, prodSum, targets, qualAvg, warnings, existing] = await Promise.all([
    db.attendance.groupBy({ by: ["employeeId"], where: { employeeId: { in: ids }, date: inRange }, _count: { _all: true } }),
    db.attendance.groupBy({ by: ["employeeId"], where: { employeeId: { in: ids }, date: inRange, lateFlag: true }, _count: { _all: true }, _sum: { lateMinutes: true } }),
    db.production.groupBy({ by: ["employeeId"], where: { employeeId: { in: ids }, date: inRange }, _sum: { unitsProduced: true } }),
    db.monthlyTarget.findMany({ where: { employeeId: { in: ids }, period: { in: range.monthPeriods } }, select: { employeeId: true, targetUnits: true } }),
    db.qualityReport.groupBy({ by: ["employeeId"], where: { employeeId: { in: ids }, date: inRange }, _avg: { qualityScore: true } }),
    db.warningLetter.groupBy({ by: ["employeeId"], where: { employeeId: { in: ids }, status: "RELEASED", releasedAt: inRange }, _count: { _all: true } }),
    db.appraisalScore.findMany({ where: { cycleId }, select: { employeeId: true, managerFeedbackScore: true } }),
  ]);
  const m = <K extends string>(xs: { employeeId: string }[], f: (x: never) => unknown) => new Map(xs.map((x) => [x.employeeId, f(x as never)])) as Map<K, never>;
  const total = m(attTotal, (g: { _count: { _all: number } }) => g._count._all), late = m(attLate, (g: { _count: { _all: number } }) => g._count._all), lateMin = m(attLate, (g: { _sum: { lateMinutes: number | null } }) => g._sum.lateMinutes ?? 0);
  const prod = m(prodSum, (g: { _sum: { unitsProduced: number | null } }) => g._sum.unitsProduced ?? 0), qual = m(qualAvg, (g: { _avg: { qualityScore: number | null } }) => g._avg.qualityScore), warn = m(warnings, (g: { _count: { _all: number } }) => g._count._all), fb = m(existing, (g: { managerFeedbackScore: number | null }) => g.managerFeedbackScore);
  const tgt = new Map<string, number>(); for (const t of targets) tgt.set(t.employeeId, (tgt.get(t.employeeId) ?? 0) + t.targetUnits);
  let complete = 0;
  const pending = employees.map((emp) => {
    const r = computeAppraisal(emp.id, weights, { totalPunchDays: total.get(emp.id) ?? 0, lateCount: late.get(emp.id) ?? 0, lateMinutesSum: lateMin.get(emp.id) ?? 0, unitsProduced: prod.get(emp.id) ?? 0, targetUnits: tgt.has(emp.id) ? tgt.get(emp.id)! : null, qualityAvg: qual.get(emp.id) ?? null, feedbackScore: fb.get(emp.id) ?? null, releasedWarnings: warn.get(emp.id) ?? 0 }, { allowMissingFeedback: true });
    if (r.status === "COMPLETE") complete++;
    return { employeeId: emp.id, finalScore: r.status === "COMPLETE" ? r.finalScore : null, componentScores: { ...r.componentData, weightedAverage: r.status === "COMPLETE" ? r.weightedAverage : null } as unknown as Prisma.InputJsonValue, componentMeta: { status: r.status } as Prisma.InputJsonValue };
  });
  await db.$transaction(async (tx) => {
    const gate = await lockCycleForWrite(tx, cycleId);
    if (!gate.ok) throw new Error(gate.reason);
    for (const p of pending) await tx.appraisalScore.upsert({ where: { employeeId_cycleId: { employeeId: p.employeeId, cycleId } }, create: { employeeId: p.employeeId, cycleId, finalScore: p.finalScore, componentScoresJson: p.componentScores, componentDataJson: p.componentMeta }, update: { finalScore: p.finalScore, componentScoresJson: p.componentScores, componentDataJson: p.componentMeta } });
    await tx.auditLog.create({ data: { actorUserId: actor, action: "APPRAISAL_SCORES_COMPUTED", targetEntity: `cycle=${cycleId} rowsWritten=${pending.length}` } });
  }, { timeout: txTimeout });
  return { employees: employees.length, complete };
}

// ── (d) reports ─────────────────────────────────────────────────────────────
const EMP_SELECT = { id: true, name: true, employeeCode: true, department: true, active: true, joiningDate: true, offboardedAt: true, shift: { select: { startTime: true, endTime: true } } } as const;
type EmpRow = { id: string; name: string; employeeCode: string; department: string; active: boolean; joiningDate: Date; offboardedAt: Date | null; shift: { startTime: string; endTime: string } | null };
const toReportEmployees = (rows: EmpRow[]) => rows.map((r) => ({ id: r.id, name: r.name, employeeCode: r.employeeCode, department: r.department, active: r.active, joiningDate: r.joiningDate, offboardedAt: r.offboardedAt, shiftCrossesMidnight: shiftCrossesMidnight(r.shift) }));
async function orgScope() {
  const employees = toReportEmployees(await db.employee.findMany({ select: EMP_SELECT, orderBy: { employeeCode: "asc" } }));
  return { ok: true as const, role: "SUPER_ADMIN" as const, userId: SA.clerkId, mode: "org" as const, employees, department: null, selfEmployeeId: null, scopeLabel: "Organisation-wide", generatedBy: `SUPER_ADMIN · ${SA.clerkId}` };
}
async function selfScope(empId: string) {
  const self = await db.employee.findUnique({ where: { id: empId }, select: EMP_SELECT });
  return { ok: true as const, role: "EMPLOYEE" as const, userId: "x", mode: "self" as const, employees: self ? toReportEmployees([self]) : [], department: null, selfEmployeeId: empId, scopeLabel: "self", generatedBy: "self" };
}
async function oneReport(id: string, startStr: string, endStr: string, formats: ("json" | "pdf" | "csv")[]) {
  const range = parseRange(startStr, endStr);
  if (!range.ok) throw Object.assign(new Error(range.message), { code: range.code });
  const def = REPORTS.find((r) => r.id === id)!;
  const scope = id === "my-data" ? await selfScope(pick(EMP).employeeId!) : await orgScope();
  const run = await runReport(def.id, scope as never, range.range, { title: def.title, startLabel: range.range.startLabel, endLabel: range.range.endLabel, generatedBy: scope.generatedBy, generatedAt: new Date(), scopeLabel: scope.scopeLabel });
  if (formats.includes("pdf")) await run.pdf();
  if (formats.includes("csv") && run.csv) run.csv();
}

// ── (e) bulk import ─────────────────────────────────────────────────────────
async function bulkImport(n: number, actor: string, txTimeout = 60_000) {
  const mgrCodes = (await db.employee.findMany({ where: { id: { in: MGR.map((u) => u.employeeId!) } }, select: { employeeCode: true } })).map((m) => m.employeeCode);
  const csv = ["employeeCode,name,department,designation,managerEmployeeCode,joiningDate,machineId,email",
    ...Array.from({ length: n }, (_, i) => `LTB-${String(i + 1).padStart(4, "0")},Bulk Hire ${i + 1},Assembly,Operator,${mgrCodes[i % mgrCodes.length]},2026-10-20,M-${i + 1},bulk${i + 1}@loadtest.invalid`)].join("\n");
  const [existing, activeManagers] = await Promise.all([db.employee.findMany({ select: { employeeCode: true, email: true } }), db.employee.findMany({ where: { active: true }, select: { id: true, employeeCode: true } })]);
  const ctx = { existingCodes: new Set(existing.map((e) => e.employeeCode)), activeManagerCodes: new Map(activeManagers.map((m) => [m.employeeCode, m.id])), existingEmails: new Set(existing.flatMap((e) => (e.email ? [e.email.toLowerCase()] : []))) };
  const result = validateCsv(csv, ctx);
  if (result.fatal || result.invalid.length) throw new Error(`invalid csv: ${result.fatal ?? JSON.stringify(result.invalid[0])}`);
  return db.$transaction(async (tx) => {
    const out: string[] = [];
    for (const row of result.valid) {
      const res = await onboardEmployee(tx as never, { employeeCode: row.employeeCode, name: row.name, department: row.department, designation: row.designation, managerId: row.managerEmployeeCode ? ctx.activeManagerCodes.get(row.managerEmployeeCode) ?? null : null, machineId: row.machineId, joiningDate: row.joiningDate!, email: row.email }, actor);
      if (!res.ok) throw new Error(`ROW_FAILED:${row.employeeCode}:${res.message}`);
      out.push(res.employee.employeeCode);
    }
    await tx.auditLog.create({ data: { actorUserId: actor, action: "BULK_EMPLOYEE_IMPORT", targetEntity: `${out.length} employees imported` } });
    return out.length;
  }, { timeout: txTimeout });
}

// ── scenarios ───────────────────────────────────────────────────────────────
const which = process.argv[2] ?? "all";
const want = (k: string) => which === "all" || which.split(",").includes(k);
const notes: Record<string, unknown> = {};

// Baseline — always first: sets C (one query's cost from here) for every estimate below.
{
  const [one] = instances(1);
  await one.base.$queryRaw`SELECT 1`; // connect; not measured
  // Is Prisma's event timestamp the query's start or its end? (decides how overlap is measured)
  let dStart = 0, dEnd = 0;
  for (let i = 0; i < 5; i++) {
    const ev = queryEvents.get(one.base)!, t0 = Date.now();
    await one.base.$queryRaw`SELECT 1`;
    const t1 = Date.now();
    await new Promise((r) => setTimeout(r, 5));
    dStart += Math.abs(ev.at(-1)!.ts - t0); dEnd += Math.abs(ev.at(-1)!.ts - t1);
  }
  TS_IS_START = dStart <= dEnd;
  C = RT_MS = 0; // estimates are meaningless until set; the baseline row itself is reported raw
  const s = stat("0. baseline — plain SELECT 1 ×30, one warm instance, one after another");
  for (let i = 0; i < 30; i++) await timed(s, one, () => db.$queryRaw`SELECT 1`);
  C = pct(sorted(s.ops.map((o) => o.ms)), 50);
  RT_MS = C / pct(sorted(s.ops.map((o) => o.rt)), 50);
  const prismaDur = pct(sorted(queryEvents.get(one.base)!.slice(-30).map((e) => e.dur)), 50);
  const r = { scenario: s.name, requests: s.requests, successRate: +(100 * s.ok / s.requests).toFixed(2), errors: s.errors, measuredMs: p3(s.ops.map((o) => o.ms)), roundTripsPerSelect1: p3(s.ops.map((o) => o.rt)),
    sydneyCostPerRoundTripMs: Math.round(RT_MS), prismaReportedDurMs: Math.round(prismaDur), mumbaiAssumedMsPerRoundTrip: MUMBAI_MS_PER_RT, prismaEventTimestampIs: TS_IS_START ? "start" : "end" };
  results.push(r as never);
  console.log(JSON.stringify(r));
  await closeAll([one]);
}

if (want("0")) {
  const cold = instances(20);
  await scenario("0b. 20 cold instances connect at the same moment (first query each)", async (s) => {
    await Promise.all(cold.map((c) => timed(s, c, () => db.$queryRaw`SELECT 1`)));
  });
  await closeAll(cold);
}

if (want("a")) {
  const staff = byRole("EMPLOYEE").concat(byRole("MANAGER"), byRole("HR"));
  const insts = instances(20);
  const w = await warm(insts);
  for (const phase of ["clock-in", "clock-out"] as const) {
    const actions: Record<string, number> = {};
    await scenario(`a. 9am rush — ${staff.length} ${phase}s within 60 s (20 warm instances)`, async (s) => {
      const free = [...insts];
      const waiters: ((c: Inst) => void)[] = [];
      const acquire = () => free.length ? Promise.resolve(free.pop()!) : new Promise<Inst>((r) => waiters.push(r));
      const release = (c: Inst) => { const w = waiters.shift(); if (w) w(c); else free.push(c); };
      await Promise.all(staff.map((u) => new Promise<void>((done) => setTimeout(async () => {
        const c = await acquire();
        const a = await timed(s, c, () => punch(u.clerkId));
        actions[String(a)] = (actions[String(a)] ?? 0) + 1;
        release(c); done();
      }, Math.random() * 60_000))));
    }, () => ({ outcomes: { ...actions }, warmup: w }));
  }
  await closeAll(insts);
}

async function busyMorning(cl: number) {
  const per = roleStats(), insts = instances(40, cl), w = await warm(insts);
  await scenario(`b. busy morning — 40 concurrent dashboard loads, all 4 roles, 5 min, connection_limit=${cl}`, (s) => sustainedDashboards(s, insts, 300, per),
    () => ({ connectionLimit: cl, perRole: roleSummary(per), warmup: w, cache: "OFF (every read hits the DB — worst case)" }));
  await closeAll(insts);
}
if (want("b")) await busyMorning(1);
if (want("b5")) await busyMorning(5);

const LONG_TX = 15 * 60_000;
async function writeStep<T>(inst: Inst, label: string, run: (txTimeout?: number) => Promise<T>): Promise<T | undefined> {
  let v: T | undefined;
  await scenario(label, async (s) => { v = await timed(s, inst, () => run()); }, () => ({ result: v ?? null, txTimeout: "route's own" }));
  if (v !== undefined) return v;
  await scenario(`${label} — RETRY with 15-min transaction timeout (harness-only distance compensation)`, async (s) => { v = await timed(s, inst, () => run(LONG_TX)); }, () => ({ result: v ?? null }));
  return v;
}

if (want("c")) {
  const [inst] = instances(1);
  await warm([inst]);
  const HR1 = HR[0].clerkId;
  const out: Record<string, unknown> = {};
  out.run = await writeStep(inst, "c1. month-end payroll RUN for 2026-10", (t) => payrollRun("2026-10", HR1, t));
  out.sub = await writeStep(inst, "c2. payroll SUBMIT", (t) => payrollSubmit("2026-10", HR1, t));
  out.fin = await writeStep(inst, "c3. payroll FINALIZE (lock + loan recovery + notifications)", (t) => payrollFinalize("2026-10", SA.clerkId, t));
  const cycle = await boot.appraisalCycle.findFirst({ where: { published: false } });
  out.app = await writeStep(inst, "c4. appraisal COMPUTE for all active employees", (t) => appraisalCompute(cycle!.id, HR1, t));
  await closeAll([inst]);
}

if (want("d")) {
  const ids = REPORTS.map((r) => r.id);
  const [inst] = instances(1);
  await warm([inst]);
  const threeYear = parseRange("2023-10-01", "2026-09-30");
  notes.threeYearRange = threeYear.ok ? "accepted" : `refused by design: ${threeYear.code} — ${threeYear.message}`;
  const per: Record<string, Stat> = Object.fromEntries(ids.map((id) => [id, stat(id)]));
  await scenario(`d1. all ${ids.length} reports, max range 2024-10-01→2026-09-30 (data + PDF + CSV), one after another`, async (s) => {
    for (const id of ids) await timed(s, inst, () => oneReport(id, "2024-10-01", "2026-09-30", ["json", "pdf", "csv"]), per[id]);
  }, () => ({ perReport: roleSummary(per), threeYearRange: notes.threeYearRange }));
  await closeAll([inst]);
  const insts = instances(10), w = await warm(insts);
  await scenario("d2. 10 people running reports at once (3 random PDF reports each, 2-year range)", async (s) => {
    await Promise.all(insts.map(async (c) => { for (let k = 0; k < 3; k++) await timed(s, c, () => oneReport(pick(ids), "2024-10-01", "2026-09-30", ["json", "pdf"])); }));
  }, () => ({ warmup: w }));
  await closeAll(insts);
}

if (want("e")) {
  const [inst] = instances(1);
  await warm([inst]);
  await writeStep(inst, "e. bulk import of 50 employees (validate + one transaction)", (t) => bulkImport(50, HR[0].clerkId, t));
  await closeAll([inst]);
}

if (want("l")) {
  // Two advances issued exactly as app/api/hr/salary-advance does (opening
  // balance = principal, one ACTIVE advance per employee, SALARY_ADVANCE_ISSUED
  // audit), then two full payroll months: run → submit → finalize. Month 1 is a
  // normal installment for both; month 2 is a normal one for A and the CAPPED
  // final installment for B, which must close it.
  const [inst] = instances(1);
  await warm([inst]);
  const HR1 = HR[0].clerkId, PERIODS = ["2026-11", "2026-12"];
  if (await boot.payroll.count({ where: { month: { in: PERIODS } } })) throw new Error("REFUSING: 2026-11/12 payroll already exists — scenario l runs once");
  const picks = await boot.employee.findMany({
    where: { active: true, salaryStructure: { isNot: null }, salaryAdvances: { none: { status: "ACTIVE" } }, employeeCode: { startsWith: "LT-" } },
    orderBy: { employeeCode: "asc" }, take: 2, select: { id: true, employeeCode: true },
  });
  const plan = [{ principal: "10000.00", monthly: "4000.00" }, { principal: "5000.00", monthly: "3000.00" }];
  const advances = await boot.$transaction(async (tx) => Promise.all(picks.map(async (e, i) => {
    const a = await tx.salaryAdvance.create({ data: { employeeId: e.id, principalAmount: new Prisma.Decimal(plan[i].principal), monthlyDeduction: new Prisma.Decimal(plan[i].monthly), remainingBalance: new Prisma.Decimal(plan[i].principal), issuedBy: HR1 } });
    await tx.auditLog.create({ data: { actorUserId: HR1, action: "SALARY_ADVANCE_ISSUED", targetEntity: a.id } });
    return { ...a, employeeCode: e.employeeCode };
  })));
  const months: unknown[] = [];
  let allOk = true;
  for (const period of PERIODS) {
    const beforeBal = new Map((await boot.salaryAdvance.findMany({ where: { id: { in: advances.map((a) => a.id) } } })).map((a) => [a.id, a]));
    await writeStep(inst, `l. payroll RUN ${period} (2 active advances)`, (t) => payrollRun(period, HR1, t));
    await writeStep(inst, `l. payroll SUBMIT ${period}`, (t) => payrollSubmit(period, HR1, t));
    const fin = (await writeStep(inst, `l. payroll FINALIZE ${period}`, (t) => payrollFinalize(period, SA.clerkId, t))) as { advancesReduced: number; advancesClosed: number } | undefined;
    const rows = await boot.payroll.findMany({ where: { month: period } });
    const after = new Map((await boot.salaryAdvance.findMany({ where: { id: { in: advances.map((a) => a.id) } } })).map((a) => [a.id, a]));
    const checks = advances.map((a) => {
      const b = beforeBal.get(a.id)!, x = after.get(a.id)!, row = rows.find((r) => r.employeeId === a.employeeId)!;
      const expected = Prisma.Decimal.min(b.monthlyDeduction, b.remainingBalance);
      const expectedAfter = b.remainingBalance.minus(expected);
      const arithmetic = row.deductions.equals(row.pfEmployee.plus(row.esi).plus(row.professionalTax).plus(row.tds).plus(row.loanDeduction))
        && row.net.equals(row.gross.minus(row.deductions).plus(row.bonus).plus(row.reimbursements));
      const ok = row.loanDeduction.equals(expected) && x.remainingBalance.equals(expectedAfter) && x.status === (expectedAfter.lte(0) ? "CLOSED" : "ACTIVE") && arithmetic && row.status === "FINALIZED";
      if (!ok) allOk = false;
      return { employee: a.employeeCode, balanceBefore: b.remainingBalance.toFixed(2), installment: b.monthlyDeduction.toFixed(2), deducted: row.loanDeduction.toFixed(2), expected: expected.toFixed(2), balanceAfter: x.remainingBalance.toFixed(2), status: x.status, rowArithmeticExact: arithmetic, ok };
    });
    const others = rows.filter((r) => r.loanDeduction.greaterThan(0) && !advances.some((a) => a.employeeId === r.employeeId)).length;
    const expectClosed = checks.filter((c) => c.status === "CLOSED" && c.balanceBefore !== "0.00").length;
    const finOk = fin?.advancesReduced === 2 && fin?.advancesClosed === expectClosed && others === 0;
    if (!finOk) allOk = false;
    months.push({ period, rows: rows.length, finalize: fin, otherRowsWithLoanDeduction: others, checks });
  }
  const r = { scenario: "l. loan recovery — 2 advances, 2 payroll months", ok: allOk, months };
  results.push(r as never);
  console.log(JSON.stringify(r, null, 1));
  await closeAll([inst]);
}

if (want("f")) {
  const per1 = roleStats(), per2 = roleStats();
  const insts = instances(80), w = await warm(insts);
  await scenario("f1. SPIKE — 80 concurrent dashboard loads (2× b) for 60 s", (s) => sustainedDashboards(s, insts, 60, per1), () => ({ perRole: roleSummary(per1), warmup: w }));
  await closeAll(insts.slice(40));
  await scenario("f2. RECOVERY — back to 40 concurrent for 60 s right after the spike", (s) => sustainedDashboards(s, insts.slice(0, 40), 60, per2), () => ({ perRole: roleSummary(per2) }));
  await closeAll(insts.slice(0, 40));
}

await boot.$disconnect();
writeFileSync(`loadtest-results-${which.replace(/,/g, "")}.json`, JSON.stringify(results, null, 1));
console.log(`\nwrote loadtest-results-${which.replace(/,/g, "")}.json`);
