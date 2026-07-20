import "server-only";
import { db } from "@/lib/db";
import { getCurrentRole, getEffectiveUserId } from "@/lib/auth";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import type { Role } from "@/lib/auth-types";

/**
 * Recruitment access resolution, in one place so every route and page agrees.
 *
 * Applications are attached to a JobRequisition, not to an Employee, so the
 * manager→direct-reports rule used everywhere else does not apply here. A
 * Manager's scope is instead their own DEPARTMENT: they may see and give
 * feedback on candidates for roles opened in the department they work in.
 * That is a genuinely different rule, so it lives here rather than being
 * bolted onto lib/data/scope.ts.
 */

export type RecruitmentScope =
  | { ok: true; role: Role; userId: string; isPrivileged: true; department: null }
  | { ok: true; role: Role; userId: string; isPrivileged: false; department: string }
  | { ok: false; code: "UNAUTHENTICATED" | "FORBIDDEN" | "NO_EMPLOYEE"; message: string };

/**
 * HR/Super Admin get org-wide access. A Manager gets their own department.
 * Everyone else — including every EMPLOYEE — is refused: recruitment is not an
 * employee-facing surface in this phase.
 */
export async function resolveRecruitmentScope(): Promise<RecruitmentScope> {
  const userId = await getEffectiveUserId();
  if (!userId)
    return { ok: false, code: "UNAUTHENTICATED", message: "Not authenticated" };

  const role = await getCurrentRole();
  if (role === "HR" || role === "SUPER_ADMIN")
    return { ok: true, role, userId, isPrivileged: true, department: null };

  if (role !== "MANAGER")
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Recruitment is available to Managers, HR and Super Admin only",
    };

  // A Manager's department comes from their own Employee record, never from
  // the request — otherwise a manager could name any department they liked.
  const me = await getEmployeeByClerkId(userId);
  if (!me)
    return {
      ok: false,
      code: "NO_EMPLOYEE",
      message: "No employee record is linked to this account",
    };

  return { ok: true, role, userId, isPrivileged: false, department: me.department };
}

/**
 * May this scope act on this application? Resolves the application's
 * requisition department and compares.
 *
 * Returns the application's department on success so callers can log or
 * display it without a second query.
 */
export async function canAccessApplication(
  scope: Extract<RecruitmentScope, { ok: true }>,
  applicationId: string,
): Promise<{ ok: true; department: string } | { ok: false; code: string; message: string }> {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: { id: true, jobRequisition: { select: { department: true } } },
  });
  if (!app) return { ok: false, code: "NOT_FOUND", message: "Application not found" };

  const department = app.jobRequisition.department;
  if (scope.isPrivileged) return { ok: true, department };

  if (department !== scope.department)
    return {
      ok: false,
      code: "FORBIDDEN",
      message:
        "This application is for a role outside your department. Managers may only act on candidates for their own department.",
    };

  return { ok: true, department };
}
