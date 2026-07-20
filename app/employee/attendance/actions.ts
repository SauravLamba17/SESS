"use server";

import { getEffectiveUserId } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";

export interface LeaveFormState {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<"startDate" | "endDate" | "reason", string>>;
}

/** Parse a `YYYY-MM-DD` string to a local-midnight Date, or null. */
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
 * Create a LeaveRequest for the currently signed-in employee only.
 * Server-side validation is authoritative — the client mirrors these rules
 * for UX but they are re-checked here. Every failure case is explicit.
 */
export async function submitLeaveRequest(input: {
  startDate: string;
  endDate: string;
  reason: string;
}): Promise<LeaveFormState> {
  const userId = await getEffectiveUserId();
  if (!userId) {
    return { ok: false, error: "You must be signed in to request leave." };
  }

  const fieldErrors: LeaveFormState["fieldErrors"] = {};

  const start = parseDateOnly(input.startDate);
  const end = parseDateOnly(input.endDate);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const today = todayMidnight();

  if (!start) fieldErrors.startDate = "Enter a valid start date.";
  if (!end) fieldErrors.endDate = "Enter a valid end date.";
  if (!reason) fieldErrors.reason = "A reason is required.";

  if (start && start < today) {
    fieldErrors.startDate = "Start date cannot be in the past.";
  }
  if (end && end < today) {
    fieldErrors.endDate = "End date cannot be in the past.";
  }
  if (start && end && end < start) {
    fieldErrors.endDate = "End date cannot be before the start date.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee) {
      return {
        ok: false,
        error:
          "No employee record is linked to your account. Contact HR to complete onboarding.",
      };
    }

    await db.leaveRequest.create({
      data: {
        employeeId: employee.id,
        startDate: start as Date,
        endDate: end as Date,
        reason,
        // status defaults to PENDING; manager approval is Phase 2.
      },
    });

    revalidatePath("/employee/attendance");
    return { ok: true };
  } catch (err) {
    console.error("[submitLeaveRequest] failed:", err);
    return {
      ok: false,
      error: "Could not submit your request right now. Please try again.",
    };
  }
}
