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
