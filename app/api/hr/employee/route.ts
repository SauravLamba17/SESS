import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCurrentRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

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

  if (!employeeCode || !name || !department || !joiningDate) {
    return fail(
      "BAD_INPUT",
      "employeeCode, name, department and a valid joiningDate are required",
      400,
    );
  }

  try {
    // Duplicate employeeCode → clear 409 (also backed by the DB unique index).
    const dupe = await db.employee.findUnique({ where: { employeeCode } });
    if (dupe) return fail("DUPLICATE_CODE", `Employee code ${employeeCode} already exists`, 409);

    if (managerId) {
      const mgr = await db.employee.findFirst({
        where: { id: managerId, active: true },
        select: { id: true },
      });
      if (!mgr)
        return fail("BAD_MANAGER", "Selected manager is not an active employee", 400);
    }

    const created = await db.$transaction(async (tx) => {
      const emp = await tx.employee.create({
        data: { employeeCode, name, department, designation, managerId, machineId, joiningDate },
      });
      await tx.auditLog.create({
        data: { actorUserId: userId, action: "EMPLOYEE_ONBOARDED", targetEntity: emp.id },
      });
      return emp;
    });

    return NextResponse.json({ ok: true, id: created.id, employeeCode });
  } catch (err) {
    // Unique-violation backstop if two onboards race the pre-check.
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002")
      return fail("DUPLICATE_CODE", `Employee code ${employeeCode} already exists`, 409);
    console.error("[hr/employee onboard] failed:", err);
    return fail("SERVER_ERROR", "Could not onboard the employee", 503);
  }
}
