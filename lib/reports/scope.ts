import "server-only";
import { db } from "@/lib/db";
import { getCurrentRole, getEffectiveUserId } from "@/lib/auth";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import type { Role } from "@/lib/auth-types";
import { scopeFor, type ReportDef, type ScopeMode } from "./registry.ts";
import type { ReportEmployee } from "./types.ts";
import { shiftCrossesMidnight } from "@/lib/attendance/validation";

/**
 * Resolve WHICH EMPLOYEES a caller may see in a given report.
 *
 * Reuses the rules already established rather than inventing new ones:
 *   team       → Employee.managerId = the caller's own employee id, the exact
 *                direct-reports-only rule getDirectReports() enforces
 *                (single level, never recursive down the tree)
 *   department → the caller's own Employee.department, the Phase 8 recruitment
 *                rule from lib/recruitment/access.ts
 *   org        → everyone
 *
 * The manager's department/id ALWAYS comes from their own Employee row, never
 * from the request — otherwise a manager could ask for any team they liked.
 */

export type ReportScope =
  | {
      ok: true;
      role: Role;
      userId: string;
      mode: Exclude<ScopeMode, "none">;
      /** Employees in scope, already fetched. Empty for a manager with no reports. */
      employees: ReportEmployee[];
      /** Set only for mode "department" — the department the caller may see. */
      department: string | null;
      /** Set only for mode "self" — the caller's OWN employee id, resolved from
       *  their session. The self-service report reads this and nothing else. */
      selfEmployeeId: string | null;
      /** Printed in the PDF header. */
      scopeLabel: string;
      /** Who generated it, for the PDF header. */
      generatedBy: string;
    }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "NO_EMPLOYEE";
      message: string;
      status: number;
    };

const EMPLOYEE_SELECT = {
  id: true,
  name: true,
  employeeCode: true,
  department: true,
  active: true,
  joiningDate: true,
  offboardedAt: true,
  // Joined, not a second query: the attendance report needs to know whether
  // each employee's shift crosses midnight to pick the right kind of average.
  shift: { select: { startTime: true, endTime: true } },
} as const;

/** Prisma rows → ReportEmployee, deriving the overnight-shift flag once. */
function toReportEmployees(
  rows: {
    id: string;
    name: string;
    employeeCode: string;
    department: string;
    active: boolean;
    joiningDate: Date;
    offboardedAt: Date | null;
    shift: { startTime: string; endTime: string } | null;
  }[],
): ReportEmployee[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    employeeCode: r.employeeCode,
    department: r.department,
    active: r.active,
    joiningDate: r.joiningDate,
    offboardedAt: r.offboardedAt,
    shiftCrossesMidnight: shiftCrossesMidnight(r.shift),
  }));
}

export async function resolveReportScope(report: ReportDef): Promise<ReportScope> {
  const userId = await getEffectiveUserId();
  if (!userId)
    return { ok: false, code: "UNAUTHENTICATED", message: "Not authenticated", status: 401 };

  const role = await getCurrentRole();
  const mode = scopeFor(report, role);

  // THE SERVER-SIDE GATE. Every "no access" cell in the scoping table, and
  // every EMPLOYEE, lands here — regardless of what the UI chose to render.
  if (mode === "none")
    return {
      ok: false,
      code: "FORBIDDEN",
      message: `Your role does not have access to the ${report.title} report.`,
      status: 403,
    };

  if (mode === "org") {
    const employees = toReportEmployees(
      await db.employee.findMany({
        select: EMPLOYEE_SELECT,
        orderBy: { employeeCode: "asc" },
      }),
    );
    return {
      ok: true,
      role: role!,
      userId,
      mode,
      employees,
      department: null,
      selfEmployeeId: null,
      scopeLabel: "Organisation-wide",
      generatedBy: `${role} · ${userId}`,
    };
  }

  // Every remaining mode is resolved from the caller's OWN employee record.
  const me = await getEmployeeByClerkId(userId);
  if (!me)
    return {
      ok: false,
      code: "NO_EMPLOYEE",
      message:
        "No employee record is linked to this account, so your own records cannot be resolved. Contact HR.",
      status: 409,
    };

  /**
   * SELF — the only identity that can ever reach the My Data report.
   *
   * `me` comes from getEmployeeByClerkId(session clerkId). No request field is
   * consulted here or downstream, so there is no employeeId a caller could
   * send that would change whose data is returned: an extra query parameter is
   * simply never read. The employees array holds exactly one row, the caller's.
   */
  if (mode === "self") {
    const self = await db.employee.findUnique({
      where: { id: me.id },
      select: EMPLOYEE_SELECT,
    });
    return {
      ok: true,
      role: role!,
      userId,
      mode,
      employees: self ? toReportEmployees([self]) : [],
      department: null,
      selfEmployeeId: me.id,
      scopeLabel: `${me.name} (${me.employeeCode}) — your own records only`,
      generatedBy: `${role} · ${me.name} (${me.employeeCode})`,
    };
  }

  if (mode === "team") {
    // DIRECT reports only — single level, same as getDirectReports().
    const employees = toReportEmployees(
      await db.employee.findMany({
        where: { managerId: me.id },
        select: EMPLOYEE_SELECT,
        orderBy: { employeeCode: "asc" },
      }),
    );
    return {
      ok: true,
      role: role!,
      userId,
      mode,
      employees,
      department: null,
      selfEmployeeId: null,
      scopeLabel: `${me.name}'s team · ${employees.length} direct report${
        employees.length === 1 ? "" : "s"
      }`,
      generatedBy: `${role} · ${me.name} (${me.employeeCode})`,
    };
  }

  // mode === "department"
  const employees = toReportEmployees(
    await db.employee.findMany({
      where: { department: me.department },
      select: EMPLOYEE_SELECT,
      orderBy: { employeeCode: "asc" },
    }),
  );
  return {
    ok: true,
    role: role!,
    userId,
    mode,
    employees,
    department: me.department,
    selfEmployeeId: null,
    scopeLabel: `${me.department} department`,
    generatedBy: `${role} · ${me.name} (${me.employeeCode})`,
  };
}
