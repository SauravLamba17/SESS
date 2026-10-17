import "server-only";
import { unstable_cache } from "next/cache";
import type { RequisitionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { parseDateOnly } from "@/lib/period";
import { ymd } from "@/lib/reports/range";

/**
 * ORANGE + YELLOW TIERS — SESS_Caching_Strategy.docx §2/§4.
 *
 * Everything in this file is a COUNT or a STAGE LABEL that a page prints.
 * Not one cached value is read back to decide whether an action may proceed:
 *
 *   · getHrDashboardTotals()   → numbers on StatCards. The payroll entry is a
 *     count of rows per status, never a rupee figure — no gross, net,
 *     deduction or TDS value enters this or any other cache (§3).
 *   · getPendingLeaveCount()   → the "Pending Approvals" number. The LIST of
 *     pending requests is NOT cached and never will be: the approval decision
 *     is made by the atomic where-clause in app/api/manager/leave/route.ts,
 *     which re-reads status and ownership inside the transaction. A stale
 *     COUNT can only ever mislabel a card; a stale RECORD could let an
 *     already-handled request be actioned again, so the record is left alone.
 *   · getRecruitmentDashboard() / getOpenRoles() / getAppraisalCycleSummaries()
 *     → requisition and cycle metadata. No candidate name, email, phone,
 *     resume reference or appraisal SCORE is cached anywhere (§3 sensitive HR
 *     data) — see the note on getRecruitmentDashboard.
 *
 * Every non-deterministic input (today, the current period) is passed IN as a
 * string and forms part of the cache key, so an entry can never outlive the
 * day or the month it describes.
 *
 * ANNOUNCEMENTS (§2, YELLOW, 1–10 min) are absent because SESS has no
 * announcement feature. The nearest thing is the community wall's ShoutOut
 * feed (prisma/schema.prisma:814), which is not an announcement but a live
 * peer-to-peer stream whose entire point is that a post appears at once —
 * caching it for a minute would make the feature feel broken. There is
 * nothing else in the schema to cache under that row.
 */

export const TAG_HR_DASHBOARD = "dashboard:hr";
export const TAG_MANAGER_DASHBOARD = "dashboard:manager";
export const approvalsTag = (managerEmployeeId: string) => `approvals:${managerEmployeeId}`;
export const TAG_RECRUITMENT = "recruitment";
export const TAG_APPRAISALS = "appraisals";

/** §4 ORANGE: live-ish dashboard aggregates — 15–60 sec. */
export const DASHBOARD_TTL = 30;
/** §4 YELLOW: recruitment dashboards / appraisal summaries — 1–15 min. */
export const YELLOW_TTL = 300;

/** Retention rows this close to their scheduled redaction date need attention. */
export const RETENTION_WARNING_DAYS = 30;

export interface HrDashboardTotals {
  activeCount: number;
  presentCount: number;
  payroll: { draft: number; submitted: number; finalized: number };
  openWarnings: number;
  unreleasedWarnings: number;
  idleConsentCount: number;
  retentionExpiring: number;
}

/**
 * Every figure on the HR dashboard, in ONE Promise.all — the identical set of
 * queries app/hr/page.tsx ran inline, moved here unchanged.
 *
 * @param period    "YYYY-MM", the payroll month being summarised.
 * @param todayYmd  "YYYY-MM-DD" local today, per lib/reports/range.ts#ymd.
 *
 * Two deliberate changes from the inline version:
 *
 *  1. The retention cutoff is now `todayYmd + 30 days` at LOCAL MIDNIGHT
 *     rather than `Date.now() + 30 days` to the millisecond, because a cache
 *     key cannot depend on the clock. It moves a warning badge's boundary by
 *     at most the current time of day.
 *  2. The distinct-department query is gone from this Promise.all and lives
 *     in lib/cache/departments.ts instead. Departments are GREEN (1 hr);
 *     these totals are ORANGE (30 s). Leaving them fused would have re-run an
 *     hour-stable query every thirty seconds — the page now awaits both in
 *     parallel and each expires on its own tier's schedule.
 */
export function getHrDashboardTotals(
  period: string,
  todayYmd: string,
): Promise<HrDashboardTotals> {
  return unstable_cache(
    async (): Promise<HrDashboardTotals> => {
      const today = parseDateOnly(todayYmd)!;
      const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      const retentionCutoff = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + RETENTION_WARNING_DAYS,
      );

      const [
        activeCount,
        presentToday,
        payrollByStatus,
        openWarnings,
        unreleasedWarnings,
        idleConsent,
        retentionExpiring,
      ] = await Promise.all([
        db.employee.count({ where: { active: true } }),
        // Distinct employees with a punch today — a second punch must not count
        // twice, so this is a distinct-employee count, not an attendance count.
        db.attendance.findMany({
          where: { date: { gte: today, lt: tomorrow } },
          select: { employeeId: true },
          distinct: ["employeeId"],
        }),
        // Row COUNTS per status. Nothing monetary is selected — §3.
        db.payroll.groupBy({
          by: ["status"],
          where: { month: period },
          _count: { _all: true },
        }),
        db.warningLetter.count({ where: { acknowledged: false } }),
        db.warningLetter.count({ where: { status: "DRAFT" } }),
        // IDLE_TRACKING is the ONLY consent type that exists — Phase 11 removed
        // FACE_VERIFICATION along with the feature. Distinct by employee so a
        // re-consent does not inflate the count.
        db.consentRecord.findMany({
          where: { consentType: "IDLE_TRACKING" },
          select: { employeeId: true },
          distinct: ["employeeId"],
        }),
        db.employee.count({
          where: {
            active: false,
            redactedAt: null,
            scheduledRedactionAt: { not: null, lte: retentionCutoff },
          },
        }),
      ]);

      const countFor = (s: "DRAFT" | "SUBMITTED" | "FINALIZED") =>
        payrollByStatus.find((r) => r.status === s)?._count._all ?? 0;

      return {
        activeCount,
        presentCount: presentToday.length,
        payroll: {
          draft: countFor("DRAFT"),
          submitted: countFor("SUBMITTED"),
          finalized: countFor("FINALIZED"),
        },
        openWarnings,
        unreleasedWarnings,
        idleConsentCount: idleConsent.length,
        retentionExpiring,
      };
    },
    ["dashboard:hr-totals", period, todayYmd],
    { tags: [TAG_HR_DASHBOARD], revalidate: DASHBOARD_TTL },
  )();
}

/**
 * How many of this manager's direct reports have a leave request awaiting
 * them. A NUMBER on a StatCard — see the file header for why the underlying
 * records stay uncached.
 */
export function getPendingLeaveCount(managerEmployeeId: string): Promise<number> {
  return unstable_cache(
    async () =>
      db.leaveRequest.count({
        where: { status: "PENDING", employee: { managerId: managerEmployeeId } },
      }),
    ["dashboard:pending-leave", managerEmployeeId],
    {
      tags: [TAG_MANAGER_DASHBOARD, approvalsTag(managerEmployeeId)],
      revalidate: DASHBOARD_TTL,
    },
  )();
}

export interface RequisitionSummary {
  id: string;
  title: string;
  department: string;
  /** Narrowed to the enum, not `string`: the page indexes a status→dot map
   *  with it and passes it to a component typed on the same three values. */
  status: RequisitionStatus;
  description: string;
  openings: number;
  applicationCount: number;
  /** "YYYY-MM-DD" — see the note on CachedHoliday.date in ./shifts.ts. */
  createdAt: string;
  /** "YYYY-MM-DD", or null while the role is still open. */
  closedAt: string | null;
}

/**
 * YELLOW — the recruitment dashboard (/hr/requisitions): open roles and how
 * many applications each has drawn.
 *
 * THE CANDIDATE LIST (/hr/candidates) IS NOT CACHED and is not exposed here,
 * even though §2 lists "candidate list" as cacheable. Its rows carry
 * candidate name, email and phone — personal data of people who are not
 * employees — and §3's "sensitive HR data · no shared cache" rule outranks
 * §2's convenience entry when the two overlap. Requisition metadata carries
 * no personal data at all, so the cacheable half of the recruitment surface
 * is cached and the half that would put PII in a shared cache is not.
 */
export const getRecruitmentDashboard = unstable_cache(
  async (): Promise<RequisitionSummary[]> => {
    const rows = await db.jobRequisition.findMany({
      include: { _count: { select: { applications: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      department: r.department,
      status: r.status,
      description: r.description,
      openings: r.openings,
      applicationCount: r._count.applications,
      createdAt: ymd(r.createdAt),
      closedAt: r.closedAt ? ymd(r.closedAt) : null,
    }));
  },
  ["dashboard:requisitions"],
  { tags: [TAG_RECRUITMENT], revalidate: YELLOW_TTL },
);

export interface OpenRole {
  id: string;
  title: string;
  department: string;
  description: string;
  openings: number;
  createdAt: string;
}

/**
 * The PUBLIC careers listing. OPEN requisitions only — the same where-clause
 * app/careers/page.tsx already used, and the submission endpoint re-checks
 * status server-side regardless, so this cache can never let an application
 * through to a closed role.
 *
 * This is the one genuinely public, unauthenticated read in SESS (§8: only
 * public routes may be cached at a shared/CDN layer), so it is also the only
 * cached reader whose output is safe outside a session.
 */
export const getOpenRoles = unstable_cache(
  async (): Promise<OpenRole[]> => {
    const rows = await db.jobRequisition.findMany({
      where: { status: "OPEN" },
      select: {
        id: true,
        title: true,
        department: true,
        description: true,
        openings: true,
        createdAt: true,
      },
      orderBy: [{ department: "asc" }, { createdAt: "desc" }],
    });
    return rows.map((r) => ({ ...r, createdAt: ymd(r.createdAt) }));
  },
  ["dashboard:open-roles"],
  { tags: [TAG_RECRUITMENT], revalidate: YELLOW_TTL },
);

export interface AppraisalCycleSummary {
  id: string;
  period: string;
  department: string | null;
  published: boolean;
  scoreCount: number;
}

/**
 * YELLOW — appraisal SUMMARIES: which cycles exist, whether each is published
 * and how many score rows it holds. No finalScore, no employee name and no
 * per-person band is cached; individual appraisal scores stay on the direct
 * read paths that already serve them.
 */
export const getAppraisalCycleSummaries = unstable_cache(
  async (): Promise<AppraisalCycleSummary[]> => {
    const rows = await db.appraisalCycle.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { scores: true } } },
    });
    return rows.map((c) => ({
      id: c.id,
      period: c.period,
      department: c.department,
      published: c.published,
      scoreCount: c._count.scores,
    }));
  },
  ["dashboard:appraisal-cycles"],
  { tags: [TAG_APPRAISALS], revalidate: YELLOW_TTL },
);
