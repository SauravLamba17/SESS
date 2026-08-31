import "server-only";
import { db } from "@/lib/db";

/**
 * RED TIER — never cache, see SESS_Caching_Strategy.docx Section 3. (partial)
 *
 * getEmployeeByClerkId() below — the Clerk-id -> Employee resolution — is NOT
 * cached and must never be. It is not a display read: its result feeds
 * AUTHORIZATION predicates, most visibly the atomic where-clause in
 * app/api/manager/leave/route.ts that is the only thing deciding whether a
 * manager may approve a request, and the scope resolution in
 * lib/reports/scope.ts that decides whose rows a report may cover. Section 8:
 * "Do not use cached permissions as the sole authority for security
 * decisions."
 *
 * The DISPLAY projections of this data are cached instead, separately and
 * narrowly, in lib/cache/employees.ts — a roster of names, a profile card.
 * Those are read only to render, never to decide.
 */

/**
 * Data-access scoping helpers.
 *
 * The manager→direct-reports rule is enforced HERE, in the actual queries
 * (WHERE managerId = <manager's employeeId>), not merely hidden in the UI.
 * A manager only ever sees their DIRECT reports — never multiple levels
 * down the tree (no recursive descent).
 */

/** Resolve the Employee record linked to a Clerk user. */
export function getEmployeeByClerkId(clerkId: string) {
  return db.user
    .findUnique({ where: { clerkId }, include: { employee: true } })
    .then((u) => u?.employee ?? null);
}

/** The manager's DIRECT reports only (single level). Shift batched in. */
export function getDirectReports(managerEmployeeId: string) {
  return db.employee.findMany({
    where: { managerId: managerEmployeeId, active: true },
    include: { shift: { select: { id: true, name: true, startTime: true, endTime: true } } },
    orderBy: { name: "asc" },
  });
}

/** Active employees in a department (null/undefined department = org-wide). */
export function getActiveEmployees(department?: string | null) {
  return db.employee.findMany({
    where: { active: true, ...(department ? { department } : {}) },
    orderBy: { employeeCode: "asc" },
  });
}

/**
 * Full org roster (active AND inactive) with manager name — HR/Super Admin.
 * Single query with an include; no per-row manager lookups.
 */
export function getAllEmployees() {
  return db.employee.findMany({
    include: {
      manager: { select: { name: true } },
      shift: { select: { id: true, name: true, startTime: true, endTime: true } },
      // Account status on the roster: linked User = active login.
      user: { select: { id: true } },
    },
    orderBy: [{ active: "desc" }, { employeeCode: "asc" }],
  });
}

/** Active shifts for assignment dropdowns. */
export function getActiveShifts() {
  return db.shift.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, startTime: true, endTime: true },
  });
}
