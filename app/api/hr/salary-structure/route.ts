import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

/** Parse a money string to a non-negative Decimal, or null if malformed.
 *  Kept as a string all the way to Decimal — never through Number(). */
function parseMoney(v: unknown): Prisma.Decimal | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  try {
    return new Prisma.Decimal(s);
  } catch {
    return null;
  }
}

/** Upsert an employee's salary structure. One current structure per employee. */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may set salary structures", 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  const basic = parseMoney(body.basic);
  const hra = parseMoney(body.hra);
  const specialAllowance = parseMoney(body.specialAllowance);
  const effectiveFrom =
    typeof body.effectiveFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.effectiveFrom)
      ? new Date(`${body.effectiveFrom}T00:00:00`)
      : null;

  if (!employeeId) return fail("BAD_INPUT", "employeeId is required", 400);
  if (!basic || !hra || !specialAllowance)
    return fail(
      "BAD_INPUT",
      "basic, hra and specialAllowance must be non-negative amounts with at most 2 decimals",
      400,
    );
  if (!effectiveFrom || Number.isNaN(effectiveFrom.getTime()))
    return fail("BAD_INPUT", "effectiveFrom must be a valid YYYY-MM-DD date", 400);
  if (basic.lessThanOrEqualTo(0))
    return fail("BAD_INPUT", "Basic must be greater than zero", 400);

  // PF UAN is optional (not every employee has one yet). When supplied it must
  // be the standard 12-digit number — a malformed UAN on a payslip is worse
  // than a blank one.
  const rawUan = typeof body.pfUan === "string" ? body.pfUan.trim() : "";
  if (rawUan && !/^\d{12}$/.test(rawUan))
    return fail("BAD_INPUT", "PF UAN must be exactly 12 digits", 400);
  const pfUan = rawUan || null;

  try {
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, active: true },
    });
    if (!employee) return fail("NOT_FOUND", "Employee not found", 404);
    if (!employee.active)
      return fail("INACTIVE", "Cannot set a salary structure for an inactive employee", 409);

    const fields = { basic, hra, specialAllowance, effectiveFrom, setBy: userId };

    await db.$transaction(async (tx) => {
      await tx.salaryStructure.upsert({
        where: { employeeId },
        update: fields,
        create: { employeeId, ...fields },
      });
      // UAN lives on Employee, not the structure, but it is captured on the
      // same form — so it is written in the same transaction.
      await tx.employee.update({ where: { id: employeeId }, data: { pfUan } });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "SALARY_STRUCTURE_SET",
          targetEntity: employeeId,
        },
      });
    });

    return NextResponse.json({ ok: true, employeeId });
  } catch (err) {
    console.error("[hr/salary-structure] failed:", err);
    return fail("SERVER_ERROR", "Could not save the salary structure", 503);
  }
}
