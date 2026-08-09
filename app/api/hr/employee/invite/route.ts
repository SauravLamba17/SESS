import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendEmployeeInvitation } from "@/lib/employees/invite";
import { clerkCreateInvitation } from "@/lib/employees/invite-clerk";
import { ROLES, type Role } from "@/lib/auth-types";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Send (or resend) a Clerk login invitation for an existing employee — the
 * roster action that covers employees onboarded WITHOUT an invitation, most
 * notably bulk imports where inviting everyone at import time is undesirable.
 * Same shared sendEmployeeInvitation() the onboarding routes use.
 */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may send login invitations", 403);

  let body: { employeeId?: unknown; email?: unknown; role?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const inviteRole = (ROLES as string[]).includes(String(body.role))
    ? (body.role as Role)
    : "EMPLOYEE";
  if (!employeeId) return fail("BAD_INPUT", "employeeId is required", 400);

  try {
    // Email uniqueness guard when HR supplies a NEW email from the roster —
    // the Employee.email unique index backstops a race.
    if (email) {
      const clash = await db.employee.findFirst({
        where: { email: email.toLowerCase(), id: { not: employeeId } },
        select: { employeeCode: true },
      });
      if (clash)
        return fail(
          "DUPLICATE_EMAIL",
          `Email ${email.toLowerCase()} already belongs to employee ${clash.employeeCode}`,
          409,
        );
    }

    const result = await sendEmployeeInvitation(
      db,
      { employeeId, email: email || null, role: inviteRole, actorUserId: userId },
      clerkCreateInvitation,
    );
    if (!result.ok) {
      // INACTIVE/REDACTED are 409: the request is well-formed, it conflicts
      // with the employee's current state (offboarded, or personal data erased
      // under the retention policy).
      const status =
        result.code === "NOT_FOUND"
          ? 404
          : result.code === "CLERK_ERROR"
            ? 502
            : result.code === "INACTIVE" || result.code === "REDACTED"
              ? 409
              : 400;
      return fail(result.code, result.message, status);
    }
    return NextResponse.json({ ok: true, invitationId: result.invitationId });
  } catch (err) {
    console.error("[hr/employee/invite] failed:", err);
    return fail("SERVER_ERROR", "Could not send the invitation", 503);
  }
}
