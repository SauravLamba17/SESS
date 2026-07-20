import "server-only";
import { db } from "@/lib/db";

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

/** True only if target is a DIRECT report of this manager. */
export async function isDirectReport(
  managerEmployeeId: string,
  targetEmployeeId: string,
): Promise<boolean> {
  const match = await db.employee.findFirst({
    where: { id: targetEmployeeId, managerId: managerEmployeeId },
    select: { id: true },
  });
  return match !== null;
}

/** Attendance for a manager's direct reports — scoped at the query level. */
export function getTeamAttendance(managerEmployeeId: string, date?: Date) {
  return db.attendance.findMany({
    where: {
      employee: { managerId: managerEmployeeId },
      ...(date ? { date } : {}),
    },
    include: { employee: true },
    orderBy: { date: "desc" },
  });
}

/** Production rows for a manager's direct reports. */
export function getTeamProduction(managerEmployeeId: string) {
  return db.production.findMany({
    where: { employee: { managerId: managerEmployeeId } },
    include: { employee: true },
    orderBy: { date: "desc" },
  });
}

/** An individual employee's own attendance (self-service scope). */
export function getSelfAttendance(employeeId: string) {
  return db.attendance.findMany({
    where: { employeeId },
    orderBy: { date: "desc" },
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
