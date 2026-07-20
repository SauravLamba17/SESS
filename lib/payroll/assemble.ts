// Assembles one Payroll row's figures from already-fetched inputs.
//
// Pure: no DB access. Callers batch-fetch structures, claims and advances for
// the whole population and pass each employee's slice in.
//
// Both the monthly run (app/api/hr/payroll/run) and the Full & Final
// settlement (app/api/hr/employee/offboard) go through THIS function, so a
// settlement row can never drift from a regular row's arithmetic. The only
// difference between them is `settlement: true`, which changes exactly two
// things: the period end used for pro-ration, and how much of an outstanding
// advance is recovered.

import { Prisma } from "@prisma/client";
import { computeGrossNet } from "./compute.ts";
import { computeProratedSalary, payableDays } from "./proration.ts";

export interface StructureInput {
  basic: Prisma.Decimal;
  hra: Prisma.Decimal;
  specialAllowance: Prisma.Decimal;
}

export interface AdvanceInput {
  id: string;
  monthlyDeduction: Prisma.Decimal;
  remainingBalance: Prisma.Decimal;
}

export interface AssembleInput {
  period: string; // "YYYY-MM"
  structure: StructureInput;
  joiningDate: Date;
  /** Last working day. For a settlement this is the exit date; for a regular
   *  run it is null unless the employee already left mid-period. */
  offboardedAt: Date | null;
  /** Approved, not-yet-reimbursed claims for this employee. */
  claims: { id: string; amount: Prisma.Decimal }[];
  /** The employee's ACTIVE advance, if any. */
  advance: AdvanceInput | null;
  /** True for a Full & Final settlement row. */
  settlement: boolean;
}

export interface AssembledRow {
  basic: Prisma.Decimal;
  hra: Prisma.Decimal;
  specialAllowance: Prisma.Decimal;
  daysWorked: number;
  daysInMonth: number;
  reimbursements: Prisma.Decimal;
  loanDeduction: Prisma.Decimal;
  gross: Prisma.Decimal;
  deductions: Prisma.Decimal;
  net: Prisma.Decimal;
  claimIds: string[];
  /** The advance this row recovers against, and by how much. Applied to the
   *  balance at FINALIZE, never at draft time. */
  advanceId: string | null;
  closesAdvance: boolean;
}

export function assemblePayrollRow(input: AssembleInput): AssembledRow {
  const { daysWorked, daysInMonth } = payableDays(
    input.period,
    input.joiningDate,
    input.offboardedAt,
  );

  const prorated = computeProratedSalary(
    input.structure.basic,
    input.structure.hra,
    input.structure.specialAllowance,
    daysWorked,
    daysInMonth,
  );

  const reimbursements = input.claims.reduce(
    (sum, c) => sum.plus(c.amount),
    new Prisma.Decimal(0),
  );

  // Recovery policy — the one real behavioural difference at settlement:
  //  - regular run: one installment, capped at what is still owed, so the
  //    final installment never over-recovers.
  //  - settlement:  the ENTIRE remaining balance. A departing employee's loan
  //    is squared off at exit rather than left dangling with no future payroll
  //    to recover it from.
  let loanDeduction = new Prisma.Decimal(0);
  let closesAdvance = false;
  if (input.advance) {
    const owed = input.advance.remainingBalance;
    loanDeduction = input.settlement
      ? owed
      : Prisma.Decimal.min(input.advance.monthlyDeduction, owed);
    if (loanDeduction.lessThan(0)) loanDeduction = new Prisma.Decimal(0);
    closesAdvance = owed.minus(loanDeduction).lessThanOrEqualTo(0);
  }

  // Deductions all start at 0 — HR enters PF/ESI/PT and the CA-provided TDS.
  const { gross, deductions, net } = computeGrossNet({
    basic: prorated.basic,
    hra: prorated.hra,
    specialAllowance: prorated.specialAllowance,
    pfEmployee: 0,
    esi: 0,
    professionalTax: 0,
    tds: 0,
    loanDeduction,
    bonus: 0,
    reimbursements,
  });

  return {
    basic: prorated.basic,
    hra: prorated.hra,
    specialAllowance: prorated.specialAllowance,
    daysWorked,
    daysInMonth,
    reimbursements,
    loanDeduction,
    gross,
    deductions,
    net,
    claimIds: input.claims.map((c) => c.id),
    advanceId: input.advance?.id ?? null,
    closesAdvance,
  };
}
