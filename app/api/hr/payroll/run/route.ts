import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { isPeriod } from "@/lib/period";
import { assemblePayrollRow } from "@/lib/payroll/assemble";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The $transaction below is capped at 30s. Bound the function just above that
// so Prisma's own timeout wins the race and returns a real error, rather than
// Vercel killing the invocation mid-transaction and returning a bare 504.
// Set explicitly rather than inheriting the platform default, so the ceiling
// stays tied to the transaction's own timeout if that default ever changes.
export const maxDuration = 45;

/**
 * RED TIER — never cache, see SESS_Caching_Strategy.docx Section 3.
 *
 * PAYROLL PREVIEW. This route IS the preview: it fetches the current
 * authoritative inputs (salary structures, attendance, approved claims,
 * active advances) and computes a DRAFT run from what it just read.
 *
 *   User requests Payroll Preview
 *         |
 *   Fetch current authoritative data   <- direct DB read, no cache lookup
 *         |
 *   Calculate preview                  <- fresh, from what was just fetched
 *         |
 *   Return result
 *         |
 *   DO NOT STORE IN SHARED CACHE
 *
 * There is no unstable_cache, no revalidate, no fetch() with a cache option
 * and no import from lib/cache/ anywhere in this file or in anything it
 * calls: lib/payroll/assemble.ts and lib/payroll/compute.ts are pure
 * arithmetic over values passed in, and lib/payroll/proration.ts likewise.
 * The four batched queries below run on EVERY request, every time.
 *
 * `export const dynamic = "force-dynamic"` above additionally stops the
 * Route Handler itself from being statically rendered or CDN-cached (Section
 * 8: never cache authenticated responses at a shared layer).
 */

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
export async function POST(req: NextRequest) {
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

  // First local day of the period being run. Used to decide who was employed
  // DURING it, which is not the same question as who is employed NOW.
  const [periodYear, periodMonth] = period.split("-").map(Number);
  const periodStart = new Date(periodYear, periodMonth - 1, 1);

  try {
    // ── 1 of 4: employees in scope + salary structure, one query. ──
    //
    // NOT `active: true`. Payroll is run in arrears — HR runs July in early
    // August — so filtering on "active right now" silently drops anyone who
    // left between the end of the period and the day the run happens. They
    // worked the whole month and would never be paid for it: the offboarding
    // settlement only ever covers the month containing their LAST WORKING DAY,
    // and the adjustment route can only correct a row that already exists.
    //
    // So: still employed, OR left on/after this period began. Anyone who left
    // before it began is excluded here; anyone who left DURING it is included
    // and payableDays() clamps them to their last working day.
    const employees = await db.employee.findMany({
      where: {
        ...(department ? { department } : {}),
        OR: [{ active: true }, { offboardedAt: { gte: periodStart } }],
      },
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

    // ── 2 of 4: rows that already PAY this period. ──
    // A regular row OR a final settlement both count: the settlement raised at
    // offboarding IS that employee's pay for the month containing their last
    // working day, so a regular row on top of it would pay them twice. (Before
    // the selection above was widened, a settlement could never collide with a
    // run because the employee was already inactive and thus excluded — it can
    // now, so it has to block.)
    //
    // Adjustment rows are still excluded: they are deltas against an
    // already-finalized row and legitimately share the month with it.
    const existing = await db.payroll.findMany({
      where: {
        month: period,
        employeeId: { in: payableIds },
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
    // P2002 on the partial unique index means a concurrent run for this exact
    // period beat us to it — the pre-flight check above read an empty set and
    // another request inserted between that read and our write. The database
    // is the real guard (see the migration named below); this turns its
    // rejection into the same 409 a serial repeat-run would have produced,
    // rather than a 503 that would invite the operator to retry.
    //
    // The whole createMany is one statement, so a violation on ANY employee
    // rolls the entire run back: no partial roster is ever left behind.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      console.warn(`[hr/payroll/run] concurrent run rejected for ${period}`);
      return fail(
        "RUN_EXISTS",
        `Payroll for ${period} was already created by another request. Reload to see it.`,
        409,
      );
    }
    console.error("[hr/payroll/run] failed:", err);
    return fail("SERVER_ERROR", "Could not create the payroll run", 503);
  }
}
