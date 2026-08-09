import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseMoney } from "@/lib/payroll/money";
import { parseDateOnly } from "@/lib/period";
import { supersede } from "@/lib/payroll/salary-history";
import { fail } from "@/lib/api/response";
import { ymd } from "@/lib/reports/range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Set an employee's salary structure.
 *
 * Phase 13: this no longer OVERWRITES silently. The structure being replaced is
 * copied into SalaryStructureHistory with its effective range closed, so a
 * raise leaves a trail. SalaryStructure itself still holds exactly one current
 * row per employee — payroll's view of "what this person is paid" is unchanged.
 */
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
  const effectiveFrom = parseDateOnly(body.effectiveFrom);

  if (!employeeId) return fail("BAD_INPUT", "employeeId is required", 400);
  if (!basic || !hra || !specialAllowance)
    return fail(
      "BAD_INPUT",
      "basic, hra and specialAllowance must be non-negative amounts with at most 2 decimals",
      400,
    );
  if (!effectiveFrom)
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

    const outcome = await db.$transaction(async (tx) => {
      // What is in force right now, and everything already closed.
      const [current, history] = await Promise.all([
        tx.salaryStructure.findUnique({
          where: { employeeId },
          select: {
            basic: true,
            hra: true,
            specialAllowance: true,
            effectiveFrom: true,
            setBy: true,
          },
        }),
        tx.salaryStructureHistory.findMany({
          where: { employeeId },
          select: { versionNumber: true },
        }),
      ]);

      const plan = supersede({
        current: current
          ? {
              basic: current.basic.toFixed(2),
              hra: current.hra.toFixed(2),
              specialAllowance: current.specialAllowance.toFixed(2),
              effectiveFrom: current.effectiveFrom,
              setBy: current.setBy,
            }
          : null,
        history,
        newEffectiveFrom: effectiveFrom,
        actorUserId: userId,
      });
      if (!plan.ok) return plan;

      // Close the outgoing version BEFORE overwriting it, so the old figures
      // are captured rather than read back after the update.
      if (plan.historyRow) {
        await tx.salaryStructureHistory.create({
          data: { employeeId, ...plan.historyRow },
        });
      }

      await tx.salaryStructure.upsert({
        where: { employeeId },
        update: fields,
        create: { employeeId, ...fields },
      });
      // UAN lives on Employee, not the structure, but it is captured on the
      // same form — so it is written in the same transaction.
      await tx.employee.update({ where: { id: employeeId }, data: { pfUan } });

      // SALARY_STRUCTURE_SET already existed and still covers "a structure was
      // set"; no second action is introduced for the same event. The version
      // detail is appended to its target so the trail shows what was replaced.
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "SALARY_STRUCTURE_SET",
          targetEntity: plan.historyRow
            ? `${employeeId} v${plan.historyRow.versionNumber}→v${plan.historyRow.versionNumber + 1} ` +
              `(previous ${ymd(plan.historyRow.effectiveFrom)}` +
              `–${ymd(plan.historyRow.effectiveTo)} archived)`
            : `${employeeId} v1 (first structure)`,
        },
      });

      return { ok: true as const, versioned: plan.historyRow !== null };
    });

    if (!outcome.ok) return fail(outcome.code, outcome.message, 409);

    return NextResponse.json({ ok: true, employeeId, versioned: outcome.versioned });
  } catch (err) {
    console.error("[hr/salary-structure] failed:", err);
    return fail("SERVER_ERROR", "Could not save the salary structure", 503);
  }
}
