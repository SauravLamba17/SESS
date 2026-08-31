import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { ymd } from "@/lib/reports/range";

/**
 * ORANGE TIER — SESS_Caching_Strategy.docx §2/§4.
 * Manager/team roster and employee profile basics: display projections only,
 * short TTL, event-invalidated by lib/invalidation/employee.ts.
 *
 * ─── WHAT IS DELIBERATELY NOT CACHED HERE ────────────────────────────────
 *
 * lib/data/scope.ts#getEmployeeByClerkId() — the Clerk-id → Employee identity
 * resolution — is NOT cached and must never be. It is not a display read: its
 * result is fed straight into AUTHORIZATION predicates. The clearest case is
 * app/api/manager/leave/route.ts, where `manager.id` becomes part of the
 * atomic where-clause
 *
 *     updateMany({ where: { id, status: "PENDING",
 *                           employee: { managerId: manager.id } } })
 *
 * that is the ONLY thing deciding whether this manager may approve this
 * request. lib/reports/scope.ts resolves report scope from the same call.
 * Caching it would put a scoping decision behind a TTL, which §8 forbids
 * ("Do not use cached permissions as the sole authority"). It is already
 * memoised per-request by React cache() upstream in lib/auth.ts, which is the
 * §1 "React cache()" layer and is a different thing from a shared cache.
 *
 * The roster reader below is the mirror image and is safe: it is read ONLY to
 * render a table of names, never to decide whether an action may proceed.
 */

/** Every cached team roster. Coarse invalidation for org-wide changes. */
export const TAG_ROSTER = "roster";
/** One manager's roster. `team:<managerEmployeeId>`. */
export const teamTag = (managerEmployeeId: string) => `team:${managerEmployeeId}`;
/** One employee's own cached display data. `employee:<employeeId>`. */
export const employeeTag = (employeeId: string) => `employee:${employeeId}`;

/** §2: manager/team roster — 30 sec–5 min. */
export const ROSTER_TTL = 60;
/** §2: employee profile basics — 1–5 min. */
export const PROFILE_TTL = 60;

export interface RosterMember {
  id: string;
  name: string;
  employeeCode: string;
  shift: { id: string; name: string; startTime: string; endTime: string } | null;
}

/**
 * A manager's DIRECT reports, projected to the fields the roster tables
 * actually render.
 *
 * The direct-reports-only rule is unchanged — same `managerId` + `active`
 * where-clause as lib/data/scope.ts#getDirectReports(), no recursive descent.
 * This is a narrower PROJECTION of that query, not a wider one: the full
 * Employee row (joiningDate, dateOfBirth, offboardedAt, email, pfUan …) is
 * never placed in the shared cache, and the Dates it carries would not have
 * survived serialisation anyway.
 */
export function getTeamRoster(managerEmployeeId: string): Promise<RosterMember[]> {
  return unstable_cache(
    async () => {
      const rows = await db.employee.findMany({
        where: { managerId: managerEmployeeId, active: true },
        select: {
          id: true,
          name: true,
          employeeCode: true,
          shift: { select: { id: true, name: true, startTime: true, endTime: true } },
        },
        orderBy: { name: "asc" },
      });
      return rows;
    },
    ["employees:team-roster", managerEmployeeId],
    { tags: [TAG_ROSTER, teamTag(managerEmployeeId)], revalidate: ROSTER_TTL },
  )();
}

export interface ProfileBasics {
  employeeCode: string;
  name: string;
  department: string;
  designation: string | null;
  /** "YYYY-MM-DD" — see the note on CachedHoliday.date in ./shifts.ts. */
  joiningDate: string;
  emergencyContact: string | null;
  active: boolean;
}

/**
 * The read-only half of /employee/profile.
 *
 * NOTE ON COST: the caller must already hold its own employee id, which comes
 * from getEmployeeByClerkId() — uncached, by the rule above. So on a cache
 * MISS this page issues two queries where it previously issued one, and on a
 * HIT it issues the same one. It is a wash on query count and only wins on
 * row width. It is implemented because §2/§4 list "employee profile basics"
 * as a cacheable tier; it is not implemented because it pays for itself here.
 */
export function getEmployeeProfileBasics(employeeId: string): Promise<ProfileBasics | null> {
  return unstable_cache(
    async () => {
      const e = await db.employee.findUnique({
        where: { id: employeeId },
        select: {
          employeeCode: true,
          name: true,
          department: true,
          designation: true,
          joiningDate: true,
          emergencyContact: true,
          active: true,
        },
      });
      return e ? { ...e, joiningDate: ymd(e.joiningDate) } : null;
    },
    ["employees:profile-basics", employeeId],
    { tags: [TAG_ROSTER, employeeTag(employeeId)], revalidate: PROFILE_TTL },
  )();
}
