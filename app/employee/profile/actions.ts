"use server";

import { getEffectiveUserId } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";

export interface ProfileFormState {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<"name", string>>;
}

/** Update the signed-in employee's own editable profile fields. */
export async function updateProfile(input: {
  name: string;
  emergencyContact: string;
}): Promise<ProfileFormState> {
  const userId = await getEffectiveUserId();
  if (!userId) return { ok: false, error: "You must be signed in." };

  const name = typeof input.name === "string" ? input.name.trim() : "";
  const emergencyContact =
    typeof input.emergencyContact === "string"
      ? input.emergencyContact.trim()
      : "";

  if (!name) {
    return { ok: false, fieldErrors: { name: "Name cannot be empty." } };
  }

  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee) {
      return {
        ok: false,
        error: "No employee record is linked to your account.",
      };
    }

    // ─── OFFBOARDED / REDACTED GUARD ───────────────────────────────────────
    // Offboarding does NOT delete the User row or revoke the Clerk account, so
    // a former employee can still sign in. Without this, they could overwrite
    // `emergencyContact` — which for a redacted record holds the "[REDACTED]"
    // marker written by lib/employees/retention.ts — putting live third-party
    // personal data back onto a record whose identifiers were erased under the
    // statutory retention policy, and silently reversing that erasure.
    //
    // Read access is deliberately left alone: a former employee may still need
    // their own payslips. This blocks only the WRITE.
    if (employee.redactedAt) {
      return {
        ok: false,
        error:
          "Your personal data has been redacted under the data-retention policy and can no longer be edited. Contact HR if you believe this is wrong.",
      };
    }
    if (!employee.active) {
      return {
        ok: false,
        error: "Your employment record is closed, so profile details can no longer be changed.",
      };
    }

    await db.employee.update({
      where: { id: employee.id },
      data: {
        name,
        emergencyContact: emergencyContact || null,
      },
    });

    revalidatePath("/employee/profile");
    return { ok: true };
  } catch (err) {
    console.error("[updateProfile] failed:", err);
    return { ok: false, error: "Could not save your profile. Please try again." };
  }
}
