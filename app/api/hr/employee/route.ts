import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseDateOnly } from "@/lib/period";
import { getCurrentRole } from "@/lib/auth";
import { onboardEmployee } from "@/lib/employees/onboard";
import { sendEmployeeInvitation } from "@/lib/employees/invite";
import { clerkCreateInvitation } from "@/lib/employees/invite-clerk";
import { ROLES, type Role } from "@/lib/auth-types";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may onboard employees", 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const employeeCode = str(body.employeeCode);
  const name = str(body.name);
  const department = str(body.department);
  const designation = str(body.designation) || null;
  const managerId = str(body.managerId) || null;
  const machineId = str(body.machineId) || null;
  const joiningDate = parseDateOnly(body.joiningDate);
  const email = str(body.email) || null;
  // OPT-IN: HR may onboard a record without granting system access (historical
  // employees, bulk-import-style cases). Sending is an explicit choice.
  const sendInvitation = body.sendInvitation === true;
  const inviteRole = (ROLES as string[]).includes(str(body.inviteRole))
    ? (str(body.inviteRole) as Role)
    : "EMPLOYEE";

  if (!employeeCode || !name || !department || !joiningDate) {
    return fail(
      "BAD_INPUT",
      "employeeCode, name, department and a valid joiningDate are required",
      400,
    );
  }
  if (sendInvitation && !email)
    return fail("BAD_INPUT", "An email address is required to send a login invitation", 400);

  try {
    // Delegates to the SHARED onboarding function (lib/employees/onboard.ts).
    // Phase 8's hire-conversion calls the exact same function, so employeeCode
    // uniqueness, manager validation and the audit row cannot drift apart
    // between the manual and automatic paths.
    const result = await db.$transaction((tx) =>
      onboardEmployee(
        tx,
        { employeeCode, name, department, designation, managerId, machineId, joiningDate, email },
        userId,
      ),
    );

    if (!result.ok) {
      const status =
        result.code === "DUPLICATE_CODE" || result.code === "DUPLICATE_EMAIL" ? 409 : 400;
      return fail(result.code, result.message, status);
    }

    // Invitation AFTER the commit — the Employee exists whatever happens here.
    // A Clerk failure is reported to HR, never allowed to undo the onboard.
    let invitation: { sent: boolean; error?: string } | null = null;
    if (sendInvitation) {
      const inv = await sendEmployeeInvitation(
        db,
        { employeeId: result.employee.id, email, role: inviteRole, actorUserId: userId },
        clerkCreateInvitation,
      );
      invitation = inv.ok ? { sent: true } : { sent: false, error: inv.message };
    }

    return NextResponse.json({
      ok: true,
      id: result.employee.id,
      employeeCode: result.employee.employeeCode,
      invitation,
    });
  } catch (err) {
    // Unique-violation backstop if two onboards race the pre-checks.
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") {
      const target = String((err as { meta?: { target?: unknown } }).meta?.target ?? "");
      return target.includes("email")
        ? fail("DUPLICATE_EMAIL", `Email ${email} is already in use`, 409)
        : fail("DUPLICATE_CODE", `Employee code ${employeeCode} already exists`, 409);
    }
    console.error("[hr/employee onboard] failed:", err);
    return fail("SERVER_ERROR", "Could not onboard the employee", 503);
  }
}
