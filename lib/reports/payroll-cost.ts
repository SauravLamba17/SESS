// REPORT 6 — Payroll Cost Summary.
//
// INPUT:  Payroll rows whose month falls in the range, each carrying its status,
//         department and every component as an exact decimal STRING.
// OUTPUT: total cost broken down by component, by month and by department.
//
// TWO RULES THIS FILE ENFORCES:
//
// 1. FINALIZED ONLY. The filter lives HERE, inside the pure function, not just
//    in the route's WHERE clause — so the guarantee is testable without a
//    database and cannot be lost by a caller that forgets it. DRAFT and
//    SUBMITTED figures are provisional; a board-facing cost number built from
//    them would report money nobody has approved. Same rule as the payslip
//    route and Form 16.
//
// 2. Every rupee stays a Decimal, exactly as lib/payroll/compute.ts requires.
//    Amounts arrive as strings and are summed with Prisma.Decimal — no figure
//    passes through a JS Number, even on a reporting path.
//
// Pure. No DB access (Prisma.Decimal is a value type, not a client).

import { Prisma } from "@prisma/client";

export type PayrollStatusLike = "DRAFT" | "SUBMITTED" | "FINALIZED";

export interface PayrollCostRow {
  employeeId: string;
  department: string;
  month: string; // "YYYY-MM"
  status: PayrollStatusLike;
  basic: string;
  hra: string;
  specialAllowance: string;
  bonus: string;
  reimbursements: string;
  pfEmployee: string;
  pfEmployer: string;
  esi: string;
  professionalTax: string;
  tds: string;
  loanDeduction: string;
  gross: string;
  deductions: string;
  net: string;
}

/** The component keys reported, in the order they are printed. */
export const COST_COMPONENTS = [
  "basic",
  "hra",
  "specialAllowance",
  "bonus",
  "reimbursements",
  "pfEmployee",
  "pfEmployer",
  "esi",
  "professionalTax",
  "tds",
  "loanDeduction",
] as const;

export type CostComponent = (typeof COST_COMPONENTS)[number];

export const COMPONENT_LABEL: Record<CostComponent, string> = {
  basic: "Basic",
  hra: "House Rent Allowance",
  specialAllowance: "Special Allowance",
  bonus: "Bonus",
  reimbursements: "Expense Reimbursements",
  pfEmployee: "Provident Fund (employee)",
  pfEmployer: "Provident Fund (employer)",
  esi: "ESI",
  professionalTax: "Professional Tax",
  tds: "TDS (income tax)",
  loanDeduction: "Salary Advance Recovery",
};

export interface PayrollCostResult {
  /** Rows that actually contributed — FINALIZED only. */
  finalizedRowCount: number;
  /** Rows excluded because they were not finalized, reported so the number's
   *  completeness is visible rather than silently partial. */
  excludedRowCount: number;
  distinctEmployees: number;
  months: string[];
  /** Every component total, as an exact decimal string. */
  components: Record<CostComponent, string>;
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  /** What the employment actually costs the company: gross + employer PF +
   *  bonus + reimbursements. NOT net pay, and not gross alone. */
  totalCostToCompany: string;
  byMonth: { month: string; gross: string; net: string; costToCompany: string; rows: number }[];
  byDepartment: {
    department: string;
    employees: number;
    gross: string;
    net: string;
    costToCompany: string;
  }[];
}

const ZERO = new Prisma.Decimal(0);

function d(v: string): Prisma.Decimal {
  return new Prisma.Decimal(v ?? "0");
}

/** gross + employer PF + bonus + reimbursements. */
function costToCompany(r: PayrollCostRow): Prisma.Decimal {
  return d(r.gross).plus(d(r.pfEmployer)).plus(d(r.bonus)).plus(d(r.reimbursements));
}

export function computePayrollCost(rows: PayrollCostRow[]): PayrollCostResult {
  // RULE 1, enforced here and nowhere else relied upon.
  const finalized = rows.filter((r) => r.status === "FINALIZED");

  const components = {} as Record<CostComponent, Prisma.Decimal>;
  for (const key of COST_COMPONENTS) components[key] = ZERO;

  let gross = ZERO;
  let deductions = ZERO;
  let net = ZERO;
  let ctc = ZERO;

  const monthMap = new Map<
    string,
    { gross: Prisma.Decimal; net: Prisma.Decimal; ctc: Prisma.Decimal; rows: number }
  >();
  const deptMap = new Map<
    string,
    { employees: Set<string>; gross: Prisma.Decimal; net: Prisma.Decimal; ctc: Prisma.Decimal }
  >();
  const employees = new Set<string>();

  for (const r of finalized) {
    for (const key of COST_COMPONENTS) components[key] = components[key].plus(d(r[key]));
    gross = gross.plus(d(r.gross));
    deductions = deductions.plus(d(r.deductions));
    net = net.plus(d(r.net));
    const rowCtc = costToCompany(r);
    ctc = ctc.plus(rowCtc);
    employees.add(r.employeeId);

    const m = monthMap.get(r.month) ?? { gross: ZERO, net: ZERO, ctc: ZERO, rows: 0 };
    m.gross = m.gross.plus(d(r.gross));
    m.net = m.net.plus(d(r.net));
    m.ctc = m.ctc.plus(rowCtc);
    m.rows++;
    monthMap.set(r.month, m);

    const dep = deptMap.get(r.department) ?? {
      employees: new Set<string>(),
      gross: ZERO,
      net: ZERO,
      ctc: ZERO,
    };
    dep.employees.add(r.employeeId);
    dep.gross = dep.gross.plus(d(r.gross));
    dep.net = dep.net.plus(d(r.net));
    dep.ctc = dep.ctc.plus(rowCtc);
    deptMap.set(r.department, dep);
  }

  const componentStrings = {} as Record<CostComponent, string>;
  for (const key of COST_COMPONENTS) componentStrings[key] = components[key].toFixed(2);

  return {
    finalizedRowCount: finalized.length,
    excludedRowCount: rows.length - finalized.length,
    distinctEmployees: employees.size,
    months: Array.from(monthMap.keys()).sort(),
    components: componentStrings,
    totalGross: gross.toFixed(2),
    totalDeductions: deductions.toFixed(2),
    totalNet: net.toFixed(2),
    totalCostToCompany: ctc.toFixed(2),
    byMonth: Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, m]) => ({
        month,
        gross: m.gross.toFixed(2),
        net: m.net.toFixed(2),
        costToCompany: m.ctc.toFixed(2),
        rows: m.rows,
      })),
    byDepartment: Array.from(deptMap.entries())
      .map(([department, dep]) => ({
        department,
        employees: dep.employees.size,
        gross: dep.gross.toFixed(2),
        net: dep.net.toFixed(2),
        costToCompany: dep.ctc.toFixed(2),
      }))
      .sort((a, b) => Number(b.costToCompany) - Number(a.costToCompany)),
  };
}
