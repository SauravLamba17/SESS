import "server-only";
import { db } from "@/lib/db";
import { moduleToggleValues } from "@/lib/system-settings";
import { getRecruitmentFunnel } from "@/lib/cache/dashboard";
import type { Role } from "@/lib/auth-types";
// Phase 12's pure aggregations, reused rather than reimplemented.
import { computeHeadcount, headcountOn } from "@/lib/reports/headcount";
import { parseRange, ymd, monthKey } from "@/lib/reports/range";
import { startOfDay } from "@/lib/period";

/** Hours after check-in past which an open row means "forgot to clock out". */
export const FORGOTTEN_CHECKOUT_HOURS = 14;

/**
 * Everything the System Dashboard (app/admin/page.tsx) needs.
 *
 * SIX statements, in one Promise.all (it was seventeen). Each Prisma call costs
 * several network round trips on the transaction pooler, and they all queue on
 * the instance's single connection, so the count of statements — not their
 * size — is what decides how long this page takes:
 *
 *  1. the employee rows that feed headcount, departments AND the 6-month trend;
 *  2. every scalar counter in ONE statement (requisitions, offers, audit
 *     volume, forgotten check-outs, role-sync failures, appraisal average,
 *     users per role, submitted payroll per month);
 *  3. today's late arrivals, employee and shift joined in (Prisma: three);
 *  4. today's approved leave, employee joined in (Prisma: two);
 *  5. the recruitment funnel — YELLOW-tier cache, lib/cache/dashboard.ts;
 *  6. the module toggles, one read.
 *
 * NOT CACHED, on purpose: payroll, audit and user-role figures (RED tier,
 * SESS_Caching_Strategy.docx §3) and the module toggles (security config).
 * Combining them into one statement changes how they are fetched, not their
 * freshness — every figure is read live on every load.
 *
 * Nothing here scales with headcount: each entry is a count the database
 * resolves, or a bounded list. Headcount banding and funnel conversion run
 * through Phase 12's existing pure functions on already-fetched rows.
 */
export async function loadAdminDashboard() {
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const forgottenBefore = new Date(now.getTime() - FORGOTTEN_CHECKOUT_HOURS * 3_600_000);
  // Six months back, inclusive of the current one.
  const trendStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const range = parseRange(ymd(trendStart), ymd(now));
  if (!range.ok) throw new Error("dashboard range failed to parse");

  try {
    const [employees, [c], lateRows, leaveRows, funnel, toggles] = await Promise.all([
      // One employee fetch feeds headcount, departments AND the 6-month trend.
      db.employee.findMany({
        select: {
          id: true,
          name: true,
          employeeCode: true,
          department: true,
          active: true,
          joiningDate: true,
          offboardedAt: true,
        },
      }),
      db.$queryRaw<
        {
          openReqs: number;
          draftOffers: number;
          audit24h: number;
          openRows: number;
          syncFailures: number;
          avgAppraisal: number | null;
          appraisalCount: number;
          roleGroups: { role: Role; count: number }[];
          submittedPayroll: { month: string; count: number }[];
        }[]
      >`
        SELECT
          (SELECT count(*) FROM "JobRequisition" WHERE status = 'OPEN')::int AS "openReqs",
          (SELECT count(*) FROM "Offer" WHERE status = 'DRAFT')::int AS "draftOffers",
          (SELECT count(*) FROM "AuditLog" WHERE "timestamp" >= ${dayAgo})::int AS "audit24h",
          (SELECT count(*) FROM "Attendance"
            WHERE "checkOut" IS NULL AND "checkIn" IS NOT NULL AND "checkIn" < ${forgottenBefore})::int AS "openRows",
          -- A role change whose Clerk sync failed leaves SESS and Clerk disagreeing
          -- about someone's privileges — a real, Super-Admin-fixable condition.
          (SELECT count(*) FROM "AuditLog"
            WHERE action = 'USER_ROLE_CLERK_SYNC_FAILED' AND "timestamp" >= ${weekAgo})::int AS "syncFailures",
          ap.avg AS "avgAppraisal",
          ap.n AS "appraisalCount",
          (SELECT coalesce(json_agg(json_build_object('role', g.role, 'count', g.n)), '[]'::json)
            FROM (SELECT role::text AS role, count(*)::int AS n FROM "User" GROUP BY role) g) AS "roleGroups",
          (SELECT coalesce(json_agg(json_build_object('month', g.month, 'count', g.n) ORDER BY g.month), '[]'::json)
            FROM (SELECT month, count(*)::int AS n FROM "Payroll" WHERE status = 'SUBMITTED' GROUP BY month) g) AS "submittedPayroll"
        FROM (
          SELECT avg(s."finalScore") AS avg, count(*)::int AS n
          FROM "AppraisalScore" s JOIN "AppraisalCycle" cy ON cy.id = s."cycleId"
          WHERE NOT s.excluded AND s."finalScore" IS NOT NULL AND cy.published
        ) ap`,
      // Real attendance for TODAY — late arrivals, with shift and department.
      db.$queryRaw<
        {
          id: string;
          checkIn: Date | null;
          lateMinutes: number | null;
          name: string;
          employeeCode: string;
          department: string;
          shiftName: string | null;
          startTime: string | null;
          endTime: string | null;
        }[]
      >`
        SELECT a.id, a."checkIn", a."lateMinutes", e.name, e."employeeCode", e.department,
               s.name AS "shiftName", s."startTime", s."endTime"
        FROM "Attendance" a
        JOIN "Employee" e ON e.id = a."employeeId"
        LEFT JOIN "Shift" s ON s.id = e."shiftId"
        WHERE a.date >= ${today} AND a.date < ${tomorrow} AND a."lateFlag"
        ORDER BY a."lateMinutes" DESC
        LIMIT 10`,
      // Real approved leave spanning today.
      db.$queryRaw<
        { id: string; startDate: Date; endDate: Date; name: string; employeeCode: string; department: string }[]
      >`
        SELECT l.id, l."startDate", l."endDate", e.name, e."employeeCode", e.department
        FROM "LeaveRequest" l JOIN "Employee" e ON e.id = l."employeeId"
        WHERE l.status = 'APPROVED' AND l."startDate" <= ${tomorrow} AND l."endDate" >= ${today}
        ORDER BY l."startDate" ASC
        LIMIT 10`,
      getRecruitmentFunnel(ymd(trendStart), ymd(now)),
      moduleToggleValues(),
    ]);

    const reportEmployees = employees.map((e) => ({
      id: e.id,
      name: e.name,
      employeeCode: e.employeeCode,
      department: e.department,
      active: e.active,
      joiningDate: e.joiningDate,
      offboardedAt: e.offboardedAt,
    }));

    // Phase 12's function, not a reimplementation.
    const headcount = computeHeadcount(reportEmployees, range.range);

    // Six-month trend, using headcountOn() — the same "was employed on this
    // date" rule the reports use, so the dashboard cannot disagree with them.
    const trend = Array.from({ length: 6 }).map((_, i) => {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      // Measure at month END (or today for the current month) so the latest
      // point reflects reality rather than the 1st of the month.
      const measureAt =
        i === 5 ? today : new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
      return {
        month: monthKey(monthStart),
        headcount: headcountOn(reportEmployees, measureAt),
      };
    });

    const submittedPayroll = c.submittedPayroll.map((g) => ({ month: g.month, _count: { _all: g.count } }));

    return {
      error: null,
      headcount,
      funnel,
      trend,
      roleRows: c.roleGroups
        .map((g) => ({ role: g.role, count: g.count }))
        .sort((a, b) => b.count - a.count),
      totalUsers: c.roleGroups.reduce((n, g) => n + g.count, 0),
      openReqs: c.openReqs,
      submittedPayroll,
      submittedRows: submittedPayroll.reduce((n, g) => n + g._count._all, 0),
      draftOffers: c.draftOffers,
      avgAppraisal: c.avgAppraisal,
      appraisalCount: c.appraisalCount,
      audit24h: c.audit24h,
      lateToday: lateRows.map((r) => ({
        id: r.id,
        checkIn: r.checkIn,
        lateMinutes: r.lateMinutes,
        employee: {
          name: r.name,
          employeeCode: r.employeeCode,
          department: r.department,
          shift: r.shiftName === null ? null : { name: r.shiftName, startTime: r.startTime!, endTime: r.endTime! },
        },
      })),
      onLeaveToday: leaveRows.map((r) => ({
        id: r.id,
        startDate: r.startDate,
        endDate: r.endDate,
        employee: { name: r.name, employeeCode: r.employeeCode, department: r.department },
      })),
      openRows: c.openRows,
      syncFailures: c.syncFailures,
      toggles,
      // The live reachability probe the Integrations page uses was a separate
      // SELECT 1. The counters statement above IS that probe now: reaching this
      // line means the database answered, and any failure lands in the catch.
      dbAlive: true,
    };
  } catch (err) {
    console.error("[admin/dashboard] failed:", err);
    return { error: "System statistics are unavailable right now." as const };
  }
}
