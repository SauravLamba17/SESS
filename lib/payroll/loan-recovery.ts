import { Prisma } from "@prisma/client";

export type Tx = Prisma.TransactionClient;

/**
 * A row's loanDeduction could not be applied to any salary advance.
 *
 * The deduction is fixed when the DRAFT is built, from the balance at that
 * moment, and nothing reserves it. So by finalize time the advance can be gone
 * (closed by an earlier month's finalize) or too small (a regular row and a
 * settlement both recovering in one month). Finalizing anyway would issue a
 * payslip that deducts money the advance ledger never records — so the whole
 * finalize is refused and rolled back instead, naming the row to fix.
 */
export class LoanUnmatchedError extends Error {
  // Plain fields, not constructor parameter properties: verify scripts load
  // this file under Node's type-stripping, which rejects that syntax.
  readonly payrollId: string;
  constructor(payrollId: string, employeeLabel: string, amount: string, balance: string | null) {
    super(
      `Payroll row ${payrollId} (${employeeLabel}) deducts ₹${amount} as loan recovery, but ` +
        (balance === null
          ? "the employee has no ACTIVE salary advance."
          : `their ACTIVE salary advance has only ₹${balance} outstanding.`),
    );
    this.payrollId = payrollId;
  }
}

export interface LoanRow {
  id: string;
  employeeId: string;
  loanDeduction: Prisma.Decimal;
  employee: { employeeCode: string; name: string };
}

/**
 * Apply each row's loanDeduction to the employee's oldest ACTIVE advance,
 * inside the caller's finalize transaction. Throws LoanUnmatchedError (which
 * rolls that transaction back) instead of skipping a row it cannot match.
 */
export async function recoverLoans(
  tx: Tx,
  rows: LoanRow[],
): Promise<{ advancesReduced: number; advancesClosed: number }> {
  let advancesClosed = 0;
  let advancesReduced = 0;
  for (const row of rows.filter((r) => r.loanDeduction.greaterThan(0))) {
    const label = `${row.employee.employeeCode} ${row.employee.name}`;
    const advance = await tx.salaryAdvance.findFirst({
      where: { employeeId: row.employeeId, status: "ACTIVE" },
      orderBy: { issuedAt: "asc" },
    });
    if (!advance) throw new LoanUnmatchedError(row.id, label, row.loanDeduction.toFixed(2), null);

    // `gte` guard: a concurrent finalize can never drive a balance negative.
    const reduced = await tx.salaryAdvance.updateMany({
      where: { id: advance.id, status: "ACTIVE", remainingBalance: { gte: row.loanDeduction } },
      data: { remainingBalance: { decrement: row.loanDeduction } },
    });
    if (reduced.count === 0)
      throw new LoanUnmatchedError(
        row.id,
        label,
        row.loanDeduction.toFixed(2),
        advance.remainingBalance.toFixed(2),
      );
    advancesReduced += 1;

    const after = advance.remainingBalance.minus(row.loanDeduction);
    if (after.lessThanOrEqualTo(new Prisma.Decimal(0))) {
      await tx.salaryAdvance.update({ where: { id: advance.id }, data: { status: "CLOSED" } });
      advancesClosed += 1;
    }
  }
  return { advancesReduced, advancesClosed };
}
