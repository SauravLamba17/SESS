"use server";

import { getEffectiveUserId } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { parseDateOnly } from "@/lib/period";
import { getEmployeeByClerkId } from "@/lib/data/scope";

export interface ProductionFormState {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<"date" | "unitsProduced", string>>;
}

function todayMidnight(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/**
 * Log (or update) the signed-in employee's own production for a date.
 * One row per employee per date — upsert on the (employeeId, date) unique key.
 * Scoped directly to the authenticated employee; no manager involved.
 */
export async function logProduction(input: {
  date: string;
  unitsProduced: number | string;
}): Promise<ProductionFormState> {
  const userId = await getEffectiveUserId();
  if (!userId) return { ok: false, error: "You must be signed in." };

  const fieldErrors: ProductionFormState["fieldErrors"] = {};
  const date = parseDateOnly(input.date);
  const units = Number(input.unitsProduced);
  const today = todayMidnight();

  if (!date) fieldErrors.date = "Enter a valid date.";
  if (!Number.isInteger(units) || units < 0)
    fieldErrors.unitsProduced = "Units must be a whole number ≥ 0.";
  if (date && date > today) fieldErrors.date = "Date cannot be in the future.";

  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee) {
      return {
        ok: false,
        error: "No employee record is linked to your account. Contact HR.",
      };
    }

    // Can't log before joining.
    if (date) {
      const joined = new Date(
        employee.joiningDate.getFullYear(),
        employee.joiningDate.getMonth(),
        employee.joiningDate.getDate(),
      );
      if (date < joined) fieldErrors.date = "Date is before your joining date.";
    }

    if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

    await db.production.upsert({
      where: { employeeId_date: { employeeId: employee.id, date: date as Date } },
      // targetUnits is a legacy field (unused since Phase 2); default 0 on create.
      create: {
        employeeId: employee.id,
        date: date as Date,
        unitsProduced: units,
        targetUnits: 0,
        loggedBy: userId,
      },
      update: { unitsProduced: units, loggedBy: userId },
    });

    revalidatePath("/employee/production");
    return { ok: true };
  } catch (err) {
    console.error("[logProduction] failed:", err);
    return { ok: false, error: "Could not save your entry. Please try again." };
  }
}
