import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

function parseMoney(v: unknown): Prisma.Decimal | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  try {
    return new Prisma.Decimal(s);
  } catch {
    return null;
  }
}

/** Issue a salary advance. remainingBalance starts equal to the principal. */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may issue a salary advance", 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  const principalAmount = parseMoney(body.principalAmount);
  const monthlyDeduction = parseMoney(body.monthlyDeduction);

  if (!employeeId) return fail("BAD_INPUT", "employeeId is required", 400);
  if (!principalAmount || principalAmount.lessThanOrEqualTo(0))
    return fail("BAD_INPUT", "principalAmount must be greater than zero", 400);
  if (!monthlyDeduction || monthlyDeduction.lessThanOrEqualTo(0))
    return fail("BAD_INPUT", "monthlyDeduction must be greater than zero", 400);
  // An installment larger than the principal would over-recover on the first
  // run; the assembler caps it anyway, but reject it at the source.
  if (monthlyDeduction.greaterThan(principalAmount))
    return fail(
      "BAD_INPUT",
      "monthlyDeduction cannot exceed the principal amount",
      400,
    );

  try {
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, active: true, name: true },
    });
    if (!employee) return fail("NOT_FOUND", "Employee not found", 404);
    if (!employee.active)
      return fail("INACTIVE", "Cannot issue an advance to an offboarded employee", 409);

    // One active advance at a time — concurrent advances would make "which
    // one does this month's installment recover?" ambiguous on the payslip.
    const openAdvance = await db.salaryAdvance.findFirst({
      where: { employeeId, status: "ACTIVE" },
      select: { id: true, remainingBalance: true },
    });
    if (openAdvance)
      return fail(
        "ADVANCE_ACTIVE",
        `${employee.name} already has an active advance with ₹${openAdvance.remainingBalance.toFixed(2)} outstanding. Close it before issuing another.`,
        409,
      );

    const advance = await db.$transaction(async (tx) => {
      const created = await tx.salaryAdvance.create({
        data: {
          employeeId,
          principalAmount,
          monthlyDeduction,
          remainingBalance: principalAmount,
          issuedBy: userId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "SALARY_ADVANCE_ISSUED",
          targetEntity: created.id,
        },
      });
      return created;
    });

    return NextResponse.json({
      ok: true,
      id: advance.id,
      remainingBalance: advance.remainingBalance.toFixed(2),
    });
  } catch (err) {
    console.error("[hr/salary-advance] failed:", err);
    return fail("SERVER_ERROR", "Could not issue the salary advance", 503);
  }
}
