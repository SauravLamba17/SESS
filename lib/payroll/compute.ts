/**
 * RED TIER — never cache, see SESS_Caching_Strategy.docx Section 3.
 *
 * Net salary and tax/deduction arithmetic. Pure: no DB access, no I/O, and
 * therefore no cache of any kind — there is nothing here to memoise and
 * nothing here that may be memoised.
 */
// Pure payroll arithmetic. No DB access, no I/O — callers batch-fetch and pass
// already-resolved figures in (see app/api/hr/payroll/run/route.ts).
//
// TWO RULES THIS MODULE EXISTS TO ENFORCE:
//
// 1. Every value is a Decimal end to end. We use Prisma's own Decimal (which
//    is decimal.js) so nothing is ever cast to a JavaScript Number — no new
//    dependency, and the same type the Prisma client reads/writes, so a figure
//    never round-trips through binary floating point on its way to a payslip.
//
// 2. There is NO tax logic here, and there must never be. `tds` is a value HR
//    typed in, sourced from the company's CA. This function subtracts it. It
//    does not derive it, validate it against a slab, or apply an exemption.

import { Prisma } from "@prisma/client";

export type Money = Prisma.Decimal | string | number;

/** Coerce to Decimal. Strings are exact; numbers are accepted for ergonomics
 *  but callers on the write path should pass form strings straight through. */
function d(v: Money): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v ?? 0);
}

/** Round half-up to paise. Applied once, at the boundary, never mid-chain. */
function money(v: Prisma.Decimal): Prisma.Decimal {
  return v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * The components of one employee's pay for one period.
 *
 * Deliberate deviation from the brief's positional signature: nine positional
 * Decimal arguments is a call site where transposing `tds` and `bonus` pays
 * someone the wrong amount and still type-checks. Named fields make that
 * class of bug impossible.
 */
export interface PayComponents {
  basic: Money; // already pro-rated — see lib/payroll/proration.ts
  hra: Money;
  specialAllowance: Money;
  pfEmployee: Money;
  esi: Money;
  professionalTax: Money;
  tds: Money; // HR-entered, CA-sourced. Never computed.
  loanDeduction: Money; // salary-advance recovery
  bonus: Money;
  reimbursements: Money; // approved expense claims folded into this run
}

export interface PayResult {
  gross: Prisma.Decimal; // basic + hra + specialAllowance
  deductions: Prisma.Decimal; // pfEmployee + esi + professionalTax + tds + loanDeduction
  net: Prisma.Decimal; // gross - deductions + bonus + reimbursements
}

/**
 * gross = basic + hra + specialAllowance
 * net   = gross - pfEmployee - esi - professionalTax - tds - loanDeduction
 *         + bonus + reimbursements
 *
 * pfEmployer is intentionally absent: it is the employer's contribution. It is
 * recorded on the Payroll row for statutory records, but it is not the
 * employee's money and never touches gross or net.
 *
 * Reimbursements are added AFTER deductions, not into gross — an expense
 * reimbursement is not taxable salary.
 */
export function computeGrossNet(c: PayComponents): PayResult {
  const gross = d(c.basic).plus(d(c.hra)).plus(d(c.specialAllowance));

  const deductions = d(c.pfEmployee)
    .plus(d(c.esi))
    .plus(d(c.professionalTax))
    .plus(d(c.tds))
    .plus(d(c.loanDeduction));

  const net = gross.minus(deductions).plus(d(c.bonus)).plus(d(c.reimbursements));

  return { gross: money(gross), deductions: money(deductions), net: money(net) };
}
