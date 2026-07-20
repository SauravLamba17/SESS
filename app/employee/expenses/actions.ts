"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type ExpenseCategory } from "@prisma/client";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";

export const EXPENSE_CATEGORIES = [
  "TRAVEL",
  "FOOD",
  "ACCOMMODATION",
  "COMMUNICATION",
  "MISCELLANEOUS",
] as const satisfies readonly ExpenseCategory[];

type Field = "category" | "amount" | "date" | "description" | "receiptUrl";

export interface ExpenseFormState {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<Field, string>>;
}

function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function todayMidnight(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/**
 * Create an ExpenseClaim for the signed-in employee only. Same shape and
 * server-authoritative validation as Phase 2's submitLeaveRequest.
 */
export async function submitExpenseClaim(input: {
  category: string;
  amount: string;
  date: string;
  description: string;
  receiptUrl: string;
}): Promise<ExpenseFormState> {
  const userId = await getEffectiveUserId();
  if (!userId) return { ok: false, error: "You must be signed in to claim an expense." };

  const fieldErrors: ExpenseFormState["fieldErrors"] = {};

  const category = EXPENSE_CATEGORIES.find((c) => c === input.category) ?? null;
  if (!category) fieldErrors.category = "Choose a category.";

  // Money stays a string until it becomes a Decimal — never via Number().
  const raw = typeof input.amount === "string" ? input.amount.trim() : "";
  let amount: Prisma.Decimal | null = null;
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(raw)) {
    fieldErrors.amount = "Enter an amount like 1250 or 1250.75.";
  } else {
    amount = new Prisma.Decimal(raw);
    if (amount.lessThanOrEqualTo(0)) fieldErrors.amount = "Amount must be greater than zero.";
  }

  const date = parseDateOnly(input.date);
  if (!date) fieldErrors.date = "Enter a valid date.";
  else if (date > todayMidnight()) fieldErrors.date = "Date cannot be in the future.";

  const description =
    typeof input.description === "string" ? input.description.trim() : "";
  if (!description) fieldErrors.description = "A description is required.";

  const receiptUrl =
    typeof input.receiptUrl === "string" && input.receiptUrl.trim()
      ? input.receiptUrl.trim()
      : null;
  if (receiptUrl && !/^https?:\/\/\S+$/i.test(receiptUrl))
    fieldErrors.receiptUrl = "Receipt link must be a http(s) URL.";

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee)
      return {
        ok: false,
        error:
          "No employee record is linked to your account. Contact HR to complete onboarding.",
      };

    await db.expenseClaim.create({
      data: {
        employeeId: employee.id,
        category: category as ExpenseCategory,
        amount: amount as Prisma.Decimal,
        date: date as Date,
        description,
        receiptUrl,
        // status defaults to PENDING — manager approval below.
      },
    });

    revalidatePath("/employee/expenses");
    return { ok: true };
  } catch (err) {
    console.error("[submitExpenseClaim] failed:", err);
    return { ok: false, error: "Could not submit your claim right now. Please try again." };
  }
}
