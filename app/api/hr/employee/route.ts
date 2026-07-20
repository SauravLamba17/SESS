import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCurrentRole } from "@/lib/auth";
import { onboardEmployee } from "@/lib/employees/onboard";

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
    // Delegates to the SHARED onboarding function (lib/employees/onboard.ts).
    // Phase 8's hire-conversion calls the exact same function, so employeeCode
    // uniqueness, manager validation and the audit row cannot drift apart
    // between the manual and automatic paths.
    const result = await db.$transaction((tx) =>
      onboardEmployee(
        tx,
        { employeeCode, name, department, designation, managerId, machineId, joiningDate },
        userId,
      ),
    );

    if (!result.ok) {
      const status = result.code === "DUPLICATE_CODE" ? 409 : 400;
      return fail(result.code, result.message, status);
    }

    return NextResponse.json({
      ok: true,
      id: result.employee.id,
      employeeCode: result.employee.employeeCode,
    });
  } catch (err) {
    // Unique-violation backstop if two onboards race the pre-check.
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002")
      return fail("DUPLICATE_CODE", `Employee code ${employeeCode} already exists`, 409);
    console.error("[hr/employee onboard] failed:", err);
    return fail("SERVER_ERROR", "Could not onboard the employee", 503);
  }
}
