import "server-only";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { currentPeriod } from "@/lib/period";
import { loadOwnAttendance } from "@/lib/attendance/own-summary";
import { dayBounds, monthBounds, totals } from "@/lib/idle/aggregate";
import { consentStateFrom, IDLE_CONSENT_TYPE } from "@/lib/idle/consent";
import { loadRecentNotifications } from "./notifications";

/**
 * Everything My Dashboard (app/employee/page.tsx) needs for one employee —
 * their OWN data only; every statement is keyed on this employee's id or this
 * account's Clerk id.
 *
 * Statement count: identity 1, own metrics 1, own attendance 2, consents 1,
 * notifications 1 — it was seventeen.
 *
 * The own-metrics statement folds seven reads into one: this month's units
 * produced, the month's target, quality average and count, the most recent
 * PUBLISHED appraisal score, and idle/active minutes for today and for the
 * month. Idle consent is resolved from the consent records this page reads
 * anyway (lib/idle/consent.ts#consentStateFrom), not from a second read.
 *
 * RED/sensitive data (appraisal score, idle minutes) is fetched live on every
 * load — combined, never cached.
 */
export async function loadEmployeeDashboard(clerkId: string) {
  // This page still requires an Employee — every metric below is
  // employee-scoped — so the early return stays. It is the HR dashboard, not
  // this one, that must render for an employee-less account.
  const employee = await getEmployeeByClerkId(clerkId);
  if (!employee) return { m: null, error: null };

  const now = new Date();
  const { period, monthStart, monthEnd } = currentPeriod();
  const { dayStart, dayEnd } = dayBounds(now);
  const idleMonth = monthBounds(now);

  const [[x], own, consents, notifications] = await Promise.all([
    db.$queryRaw<
      {
        actual: number;
        target: number | null;
        qualityAvg: number | null;
        qualityCount: number;
        appraisalScore: number | null;
        appraisalPeriod: string | null;
        idleToday: number;
        activeToday: number;
        idleMonth: number;
        activeMonth: number;
      }[]
    >`
      SELECT
        (SELECT coalesce(sum("unitsProduced"), 0) FROM "Production"
          WHERE "employeeId" = ${employee.id} AND date >= ${monthStart} AND date < ${monthEnd})::int AS actual,
        (SELECT "targetUnits" FROM "MonthlyTarget"
          WHERE "employeeId" = ${employee.id} AND period = ${period}) AS target,
        q.avg AS "qualityAvg",
        q.n AS "qualityCount",
        ap."finalScore" AS "appraisalScore",
        ap.period AS "appraisalPeriod",
        (SELECT coalesce(sum("idleMinutes"), 0) FROM "IdleLog"
          WHERE "employeeId" = ${employee.id} AND date >= ${dayStart} AND date < ${dayEnd})::int AS "idleToday",
        (SELECT coalesce(sum("activeMinutes"), 0) FROM "IdleLog"
          WHERE "employeeId" = ${employee.id} AND date >= ${dayStart} AND date < ${dayEnd})::int AS "activeToday",
        (SELECT coalesce(sum("idleMinutes"), 0) FROM "IdleLog"
          WHERE "employeeId" = ${employee.id} AND date >= ${idleMonth.monthStart} AND date < ${idleMonth.monthEnd})::int AS "idleMonth",
        (SELECT coalesce(sum("activeMinutes"), 0) FROM "IdleLog"
          WHERE "employeeId" = ${employee.id} AND date >= ${idleMonth.monthStart} AND date < ${idleMonth.monthEnd})::int AS "activeMonth"
      FROM (
        SELECT avg("qualityScore") AS avg, count(*)::int AS n FROM "QualityReport"
        WHERE "employeeId" = ${employee.id} AND date >= ${monthStart} AND date < ${monthEnd}
      ) q
      -- Most recent PUBLISHED appraisal score.
      LEFT JOIN LATERAL (
        SELECT s."finalScore", c.period
        FROM "AppraisalScore" s JOIN "AppraisalCycle" c ON c.id = s."cycleId"
        WHERE s."employeeId" = ${employee.id} AND NOT s.excluded
          AND s."finalScore" IS NOT NULL AND c.published
        ORDER BY c."createdAt" DESC
        LIMIT 1
      ) ap ON true`,
    // Today's row, this week's rows and the assigned shift.
    loadOwnAttendance(employee.id, employee.shiftId),
    // Own consent records, newest first (latest per type derived below).
    db.consentRecord.findMany({
      where: { employeeId: employee.id },
      orderBy: { givenOn: "desc" },
    }),
    // Phase 7: own notifications — unread first, then most recent.
    // Addressed by recipient User, not by Employee.
    loadRecentNotifications(clerkId, 8),
  ]);

  const latestConsent = (type: string) => consents.find((c) => c.consentType === type) ?? null;

  return {
    m: {
      actual: x.actual,
      target: x.target,
      qualityAvg: x.qualityCount > 0 ? x.qualityAvg ?? null : null,
      qualityCount: x.qualityCount,
      appraisalScore: x.appraisalScore,
      appraisalPeriod: x.appraisalPeriod,
      today: own.today,
      punchRow: own.punchRow,
      weekStart: own.weekStart,
      weekByDate: own.weekByDate,
      idle: latestConsent("IDLE_TRACKING"),
      shift: own.shift,
      // Their OWN idle/active totals — the same shape ownIdleTotals() returns.
      ownIdle: {
        today: totals(x.idleToday, x.activeToday),
        month: totals(x.idleMonth, x.activeMonth),
        consent: consentStateFrom(latestConsent(IDLE_CONSENT_TYPE), now),
      },
      notifications,
    },
    error: null,
  };
}
