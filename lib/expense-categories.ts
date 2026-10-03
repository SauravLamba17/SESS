import type { ExpenseCategory } from "@prisma/client";

/**
 * Lives here, NOT in app/employee/expenses/actions.ts: a "use server" module
 * may only export async functions. A client component importing a plain value
 * from one receives a server-reference proxy instead of the array, so
 * `EXPENSE_CATEGORIES.map` threw and /employee/expenses crashed for everyone.
 */
export const EXPENSE_CATEGORIES = [
  "TRAVEL",
  "FOOD",
  "ACCOMMODATION",
  "COMMUNICATION",
  "MISCELLANEOUS",
] as const satisfies readonly ExpenseCategory[];
