/**
 * Self-check for the payroll arithmetic. No test framework — run it directly:
 *
 *   node lib/payroll/compute.selfcheck.ts
 *
 * (Node >= 22.18 strips the types natively; no ts-node/tsx needed.)
 *
 * Each assertion compares an EXACT decimal string, not a tolerance. A tolerance
 * would be the float thinking this module exists to prevent.
 */
import { Prisma } from "@prisma/client";
import { computeGrossNet, type PayComponents } from "./compute.ts";
import { computeProratedSalary, payableDays, daysInPeriod } from "./proration.ts";
import { financialYearMonths, financialYearOf } from "../period.ts";

let failures = 0;

function check(label: string, actual: string, expected: string) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}\n        expected ${expected}  got ${actual}`,
  );
}

const ZERO: PayComponents = {
  basic: 0, hra: 0, specialAllowance: 0,
  pfEmployee: 0, esi: 0, professionalTax: 0, tds: 0,
  loanDeduction: 0, bonus: 0, reimbursements: 0,
};

console.log("── payroll arithmetic self-check ──────────────────────\n");

// 1. Normal case: a typical INR salary with full statutory deductions.
{
  const r = computeGrossNet({
    ...ZERO,
    basic: "30000.00", hra: "15000.00", specialAllowance: "5000.00",
    pfEmployee: "1800.00", esi: "375.00", professionalTax: "200.00",
    tds: "2500.00", // CA-provided figure, not computed here
  });
  check("1a normal · gross = 30000+15000+5000", r.gross.toFixed(2), "50000.00");
  check("1b normal · deductions = 1800+375+200+2500", r.deductions.toFixed(2), "4875.00");
  check("1c normal · net = 50000-4875", r.net.toFixed(2), "45125.00");
}

// 2. Zero-deductions case, with paise that must sum exactly.
{
  const r = computeGrossNet({
    ...ZERO,
    basic: "25000.50", hra: "10000.25", specialAllowance: "4999.25",
  });
  check("2a zero-deductions · gross sums paise exactly", r.gross.toFixed(2), "40000.00");
  check("2b zero-deductions · deductions = 0", r.deductions.toFixed(2), "0.00");
  check("2c zero-deductions · net = gross", r.net.toFixed(2), "40000.00");
}

// 3. With reimbursements + bonus — both added AFTER deductions.
{
  const r = computeGrossNet({
    ...ZERO,
    basic: "20000.00", hra: "8000.00", specialAllowance: "2000.00",
    pfEmployee: "1800.00", esi: "225.00", professionalTax: "200.00", tds: "1000.00",
    bonus: "5000.00", reimbursements: "1234.56",
  });
  check("3a reimbursements · gross excludes bonus+reimb", r.gross.toFixed(2), "30000.00");
  check("3b reimbursements · deductions", r.deductions.toFixed(2), "3225.00");
  check("3c reimbursements · net = 30000-3225+5000+1234.56", r.net.toFixed(2), "33009.56");
}

// 4. The float-drift canary: 0.1 + 0.2 is 0.30000000000000004 in binary
//    floating point. If this ever prints 0.30000000000000004, the Decimal
//    chain has been broken by a cast to Number somewhere.
{
  const r = computeGrossNet({ ...ZERO, basic: "0.10", hra: "0.20" });
  check("4a float canary · 0.10 + 0.20 is exactly 0.30", r.gross.toString(), "0.3");
  const drift = computeGrossNet({
    ...ZERO,
    basic: "1000.10", hra: "2000.20", specialAllowance: "3000.30",
    pfEmployee: "0.10", esi: "0.20",
  });
  check("4b float canary · repeated paise, no drift", drift.net.toFixed(2), "6000.30");
}

// 5. pfEmployer is not a parameter at all — it cannot reach net by accident.
{
  const r = computeGrossNet({ ...ZERO, basic: "10000.00", pfEmployee: "1200.00" });
  check("5a employer PF never affects net", r.net.toFixed(2), "8800.00");
}

// 6. Loan deduction: recovered as a DEDUCTION, alongside reimbursements.
{
  const r = computeGrossNet({
    ...ZERO,
    basic: "20000.00", hra: "8000.00", specialAllowance: "2000.00",
    pfEmployee: "1800.00", esi: "225.00", professionalTax: "200.00", tds: "1000.00",
    loanDeduction: "2500.00", bonus: "1000.00", reimbursements: "1234.56",
  });
  check("6a loan · gross unaffected by loan", r.gross.toFixed(2), "30000.00");
  check("6b loan · deductions include loan (3225 + 2500)", r.deductions.toFixed(2), "5725.00");
  check("6c loan · net = 30000-5725+1000+1234.56", r.net.toFixed(2), "26509.56");
}

// 7. Pro-ration.
{
  // Full month → components returned unchanged.
  const full = computeProratedSalary("30000.00", "15000.00", "5000.00", 31, 31);
  check("7a full month · basic unchanged", full.basic.toFixed(2), "30000.00");
  check("7b full month · hra unchanged", full.hra.toFixed(2), "15000.00");
  check("7c full month · specialAllowance unchanged", full.specialAllowance.toFixed(2), "5000.00");

  // Joined on the 12th of a 31-day month → 20 payable days (12th–31st).
  const half = computeProratedSalary("31000.00", "15500.00", "6200.00", 20, 31);
  check("7d mid-month join · basic 31000*20/31", half.basic.toFixed(2), "20000.00");
  check("7e mid-month join · hra 15500*20/31", half.hra.toFixed(2), "10000.00");
  check("7f mid-month join · specialAllowance 6200*20/31", half.specialAllowance.toFixed(2), "4000.00");

  // Zero days → all zeros, no divide-by-zero, no NaN.
  const none = computeProratedSalary("30000.00", "15000.00", "5000.00", 0, 31);
  check("7g zero days · basic is 0.00", none.basic.toFixed(2), "0.00");
  check("7h zero days · hra is 0.00", none.hra.toFixed(2), "0.00");
  check("7i zero days · specialAllowance is 0.00", none.specialAllowance.toFixed(2), "0.00");

  // daysInMonth = 0 must not divide by zero.
  const bad = computeProratedSalary("30000.00", "0", "0", 10, 0);
  check("7j daysInMonth=0 · returns 0.00, no divide-by-zero", bad.basic.toFixed(2), "0.00");

  // Rounding happens once, at the end: 10000/3 per component stays exact-ish.
  const third = computeProratedSalary("10000.00", "0", "0", 1, 3);
  check("7k rounds once at the end · 10000*1/3", third.basic.toFixed(2), "3333.33");
}

// 8. Payable-days derivation from joining / offboarding dates.
{
  check("8a days in a 31-day month", String(daysInPeriod("2026-07")), "31");
  check("8b days in a 30-day month", String(daysInPeriod("2026-06")), "30");
  check("8c February in a leap year", String(daysInPeriod("2028-02")), "29");

  const old = new Date(2020, 0, 1);
  const fullM = payableDays("2026-07", old, null);
  check("8d long-tenured employee works the full month", String(fullM.daysWorked), "31");

  // Joined 12 July 2026 → 12th..31st inclusive = 20 days.
  const joined = payableDays("2026-07", new Date(2026, 6, 12), null);
  check("8e joined on the 12th → 20 days (inclusive)", String(joined.daysWorked), "20");

  // Left 12 July 2026 → 1st..12th inclusive = 12 days.
  const left = payableDays("2026-07", old, new Date(2026, 6, 12));
  check("8f offboarded on the 12th → 12 days (inclusive)", String(left.daysWorked), "12");

  // Joined AND left inside the period: 10th..20th = 11 days.
  const both = payableDays("2026-07", new Date(2026, 6, 10), new Date(2026, 6, 20));
  check("8g joined 10th, left 20th → 11 days", String(both.daysWorked), "11");

  // Left before the period began → nothing payable.
  const gone = payableDays("2026-07", old, new Date(2026, 5, 30));
  check("8h left before the period → 0 days", String(gone.daysWorked), "0");

  // Joins after the period ended → nothing payable.
  const future = payableDays("2026-07", new Date(2026, 8, 1), null);
  check("8i joins after the period → 0 days", String(future.daysWorked), "0");
}

// 8b. Adjustment rows carry DELTAS and may be negative (recovering an
//     overpayment). The arithmetic must stay exact through the sign change,
//     and the annual sum original+adjustment must land on the corrected total.
{
  const arrears = computeGrossNet({
    ...ZERO,
    basic: "2000.00", tds: "150.00",
  });
  check("8b1 positive delta · gross = +2000", arrears.gross.toFixed(2), "2000.00");
  check("8b2 positive delta · net = 2000-150", arrears.net.toFixed(2), "1850.00");

  const recovery = computeGrossNet({
    ...ZERO,
    basic: "-2000.00", tds: "-150.00",
  });
  check("8b3 negative delta · gross = -2000", recovery.gross.toFixed(2), "-2000.00");
  check("8b4 negative delta · deductions = -150", recovery.deductions.toFixed(2), "-150.00");
  check("8b5 negative delta · net = -2000+150", recovery.net.toFixed(2), "-1850.00");

  // The property that makes delta semantics safe for Form 16: summing the
  // original and its correction equals the corrected figure, exactly.
  const original = computeGrossNet({
    ...ZERO,
    basic: "30000.00", hra: "15000.00", specialAllowance: "5000.00",
    pfEmployee: "1800.00", tds: "2500.00",
  });
  const delta = computeGrossNet({ ...ZERO, basic: "1234.56", tds: "123.45" });
  check("8b6 original + delta gross sums exactly",
    original.gross.plus(delta.gross).toFixed(2), "51234.56");
  check("8b7 original + delta TDS sums exactly (Form 16 stays correct)",
    new Prisma.Decimal("2500.00").plus("123.45").toFixed(2), "2623.45");

  // A delta of zero must be a true no-op, not a rounding nudge.
  const noop = computeGrossNet({ ...ZERO });
  check("8b8 zero adjustment is an exact no-op", noop.net.toFixed(2), "0.00");
}

// 9. Indian financial year is April–March, so Jan–Mar belong to the FY that
//    started the PREVIOUS April. Getting this wrong puts three months of TDS
//    on the wrong Form 16.
{
  const fy = financialYearMonths("2026-27");
  check("9a FY spans Apr→Mar, 12 months", String(fy?.length), "12");
  check("9b FY starts in April of the first year", fy?.[0] ?? "", "2026-04");
  check("9c FY ends in March of the next year", fy?.[11] ?? "", "2027-03");
  check("9d FY crosses the calendar boundary correctly", fy?.[9] ?? "", "2027-01");
  check("9e July falls in the FY that began that April", financialYearOf("2026-07"), "2026-27");
  check("9f March belongs to the PREVIOUS April's FY", financialYearOf("2027-03"), "2026-27");
  check("9g April opens a new FY", financialYearOf("2027-04"), "2027-28");
  check("9h a malformed FY label is rejected", String(financialYearMonths("2026-28")), "null");
  check("9i a non-consecutive FY label is rejected", String(financialYearMonths("2026-26")), "null");
  check("9j FY label rolls the century correctly", financialYearOf("2099-07"), "2099-00");
}

console.log(
  `\n── ${failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`} ──`,
);
process.exit(failures === 0 ? 0 : 1);
