import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCurrentRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may offboard employees", 403);

  let body: { employeeId?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  if (!employeeId) return fail("BAD_INPUT", "employeeId is required", 400);

  try {
    // Soft-delete only (active=false); historical records must stay intact.
    // Block if this person still manages active reports — don't orphan them.
    const result = await db.$transaction(async (tx) => {
      const emp = await tx.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, active: true },
      });
      if (!emp) return { code: "NOT_FOUND" as const };
      if (!emp.active) return { code: "ALREADY_INACTIVE" as const };

      const activeReports = await tx.employee.count({
        where: { managerId: employeeId, active: true },
      });
      if (activeReports > 0) return { code: "HAS_REPORTS" as const, activeReports };

      await tx.employee.update({ where: { id: employeeId }, data: { active: false } });
      await tx.auditLog.create({
        data: { actorUserId: userId, action: "EMPLOYEE_OFFBOARDED", targetEntity: employeeId },
      });
      return { code: "OK" as const };
    });

    switch (result.code) {
      case "NOT_FOUND":
        return fail("NOT_FOUND", "Employee not found", 404);
      case "ALREADY_INACTIVE":
        return fail("ALREADY_INACTIVE", "Employee is already offboarded", 409);
      case "HAS_REPORTS":
        return fail(
          "HAS_ACTIVE_REPORTS",
          `Cannot offboard: this employee still manages ${result.activeReports} active direct report(s). Reassign them to another manager first.`,
          409,
        );
      default:
        return NextResponse.json({ ok: true, employeeId });
    }
  } catch (err) {
    console.error("[hr/employee offboard] failed:", err);
    return fail("SERVER_ERROR", "Could not offboard the employee", 503);
  }
}
