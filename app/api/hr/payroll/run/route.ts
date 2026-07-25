import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { isPeriod } from "@/lib/period";
import { assemblePayrollRow } from "@/lib/payroll/assemble";
import { withPrivilegedRoute } from "@/lib/mfa-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

/** Exclusive upper bound of a "YYYY-MM" period. */
function monthEnd(period: string): Date {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m, 1);
}

/**
 * Create a DRAFT payroll run for a period.
 *
 * FOUR batched queries total, regardless of headcount — employees (with their
 * salary structure joined), existing rows, approved claims, active advances.
 * Nothing is fetched per-employee.
 */
async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may create a payroll run", 403);

  let body: { period?: unknown; department?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const period = typeof body.period === "string" ? body.period.trim() : "";
  if (!isPeriod(period)) return fail("BAD_INPUT", "period must be YYYY-MM", 400);
  const department =
    typeof body.department === "string" && body.department.trim()
      ? body.department.trim()
      : null;

  try {
    // ── 1 of 4: active employees + salary structure, one query. ──
    const employees = await db.employee.findMany({
      where: { active: true, ...(department ? { department } : {}) },
      select: {
        id: true,
        name: true,
        employeeCode: true,
        joiningDate: true,
        offboardedAt: true,
        salaryStructure: {
          select: { basic: true, hra: true, specialAllowance: true },
        },
      },
      orderBy: { employeeCode: "asc" },
    });

    // An employee with no structure is REPORTED, never given a zeroed row —
    // a broken payslip is worse than a visibly missing one.
    const missingStructure = employees
      .filter((e) => !e.salaryStructure)
      .map((e) => ({ employeeId: e.id, name: e.name, employeeCode: e.employeeCode }));
    const payable = employees.filter((e) => e.salaryStructure);

    if (payable.length === 0) {
      return NextResponse.json(
        {
          error:
            "No employee in scope has a salary structure set. Set structures before running payroll.",
          code: "NO_PAYABLE_EMPLOYEES",
          missingStructure,
        },
        { status: 409 },
      );
    }
    const payableIds = payable.map((e) => e.id);

    // ── 2 of 4: REGULAR rows that already exist for this period. ──
    // Settlement and adjustment rows are excluded: they legitimately share the
    // month with a regular run and must not block it.
    const existing = await db.payroll.findMany({
      where: {
        month: period,
        employeeId: { in: payableIds },
        isFinalSettlement: false,
        adjustmentForPayrollId: null,
      },
      select: { employeeId: true },
    });
    const alreadyRun = new Set(existing.map((p) => p.employeeId));
    const toCreate = payable.filter((e) => !alreadyRun.has(e.id));

    if (toCreate.length === 0) {
      return NextResponse.json(
        {
          error: `Payroll for ${period} already exists for every employee in scope.`,
          code: "RUN_EXISTS",
          skipped: alreadyRun.size,
        },
        { status: 409 },
      );
    }
    const createIds = toCreate.map((e) => e.id);

    // ── 3 & 4 of 4: claims and advances for everyone, two queries. ──
    const [claims, advances] = await Promise.all([
      // Approved and dated on or before the end of this period — including
      // claims approved late, so an old claim is never stranded.
      db.expenseClaim.findMany({
        where: {
          employeeId: { in: createIds },
          status: "APPROVED",
          includedInPayrollId: null,
          date: { lt: monthEnd(period) },
        },
        select: { id: true, employeeId: true, amount: true },
      }),
      db.salaryAdvance.findMany({
        where: { employeeId: { in: createIds }, status: "ACTIVE" },
        select: {
          id: true,
          employeeId: true,
          monthlyDeduction: true,
          remainingBalance: true,
        },
        orderBy: { issuedAt: "asc" },
      }),
    ]);

    const claimsByEmp = new Map<string, { id: string; amount: Prisma.Decimal }[]>();
    for (const c of claims) {
      const arr = claimsByEmp.get(c.employeeId) ?? [];
      arr.push({ id: c.id, amount: c.amount });
      claimsByEmp.set(c.employeeId, arr);
    }
    // Oldest active advance first; one advance recovered per run.
    const advanceByEmp = new Map<string, (typeof advances)[0]>();
    for (const a of advances) if (!advanceByEmp.has(a.employeeId)) advanceByEmp.set(a.employeeId, a);

    // Assemble every row through the SHARED pure assembler (same code path the
    // Full & Final settlement uses).
    const assembled = toCreate.map((e) => ({
      employee: e,
      row: assemblePayrollRow({
        period,
        structure: e.salaryStructure!,
        joiningDate: e.joiningDate,
        offboardedAt: e.offboardedAt,
        claims: claimsByEmp.get(e.id) ?? [],
        advance: advanceByEmp.get(e.id) ?? null,
        settlement: false,
      }),
    }));

    const created = await db.$transaction(
      async (tx) => {
        await tx.payroll.createMany({
          data: assembled.map(({ employee, row }) => ({
            employeeId: employee.id,
            month: period,
            basic: row.basic,
            hra: row.hra,
            specialAllowance: row.specialAllowance,
            daysWorked: row.daysWorked,
            daysInMonth: row.daysInMonth,
            reimbursements: row.reimbursements,
            loanDeduction: row.loanDeduction,
            gross: row.gross,
            deductions: row.deductions,
            net: row.net,
            processedBy: userId,
          })),
        });

        // Re-read ids in ONE query so claims can be stamped with the row that
        // pays them.
        const fresh = await tx.payroll.findMany({
          where: {
            month: period,
            employeeId: { in: createIds },
            isFinalSettlement: false,
            adjustmentForPayrollId: null,
          },
          select: { id: true, employeeId: true },
        });
        const payrollByEmp = new Map(fresh.map((p) => [p.employeeId, p.id]));

        // One updateMany per employee who actually HAS claims (usually few),
        // not one per employee in the run.
        for (const [employeeId, mine] of Array.from(claimsByEmp.entries())) {
          const payrollId = payrollByEmp.get(employeeId);
          if (!payrollId) continue;
          await tx.expenseClaim.updateMany({
            where: { id: { in: mine.map((c) => c.id) }, includedInPayrollId: null },
            data: { includedInPayrollId: payrollId },
          });
        }

        await tx.auditLog.create({
          data: { actorUserId: userId, action: "PAYROLL_RUN_CREATED", targetEntity: period },
        });
        return fresh.length;
      },
      { timeout: 30_000 },
    );

    return NextResponse.json({
      ok: true,
      period,
      created: toCreate.length,
      total: created,
      skippedExisting: alreadyRun.size,
      claimsIncluded: claims.length,
      advancesRecovered: assembled.filter((a) => a.row.loanDeduction.greaterThan(0)).length,
      proratedCount: assembled.filter((a) => a.row.daysWorked < a.row.daysInMonth).length,
      missingStructure,
    });
  } catch (err) {
    console.error("[hr/payroll/run] failed:", err);
    return fail("SERVER_ERROR", "Could not create the payroll run", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
