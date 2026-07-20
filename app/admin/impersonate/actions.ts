"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getRealIdentity, getImpersonation } from "@/lib/auth";
import { IMP_COOKIE, signImpersonation } from "@/lib/impersonation";
import { ROLE_HOME } from "@/lib/auth-types";

/**
 * Begin impersonating a seeded employee. Guarded on the REAL authenticated
 * identity (not the effective/impersonated one), so:
 *  - a non-Super-Admin can never start impersonation, and
 *  - an already-impersonating session can never start a nested impersonation
 *    (the real role is still SUPER_ADMIN, but we re-issue from the real id and
 *     never chain — see the check below).
 */
export async function startImpersonation(employeeId: string): Promise<void> {
  const { realUserId, realRole } = await getRealIdentity();
  if (!realUserId || realRole !== "SUPER_ADMIN") {
    throw new Error("Forbidden: only the real Super Admin may impersonate.");
  }

  const target = await db.user.findFirst({
    where: { employeeId },
    include: { employee: { select: { employeeCode: true, name: true, active: true } } },
  });
  if (!target || !target.employee || !target.employee.active) {
    throw new Error("Impersonation target not found or inactive.");
  }
  // Never impersonate another Super Admin (defensive; the test set has none).
  if (target.role === "SUPER_ADMIN") {
    throw new Error("Cannot impersonate a Super Admin.");
  }

  const token = await signImpersonation({
    su: realUserId,
    cid: target.clerkId,
    role: target.role,
    eid: employeeId,
    code: target.employee.employeeCode,
    name: target.employee.name,
  });

  cookies().set(IMP_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  await db.auditLog.create({
    data: {
      actorUserId: realUserId, // the REAL Super Admin
      action: "IMPERSONATION_STARTED",
      targetEntity: employeeId, // the impersonated employee
    },
  });

  redirect(ROLE_HOME[target.role]);
}

/** End impersonation and return to the real Super Admin's own portal. */
export async function stopImpersonation(): Promise<void> {
  const { realUserId } = await getRealIdentity();
  const active = await getImpersonation();

  cookies().delete(IMP_COOKIE);

  // Audit the return-to-self too — no exceptions.
  if (realUserId && active) {
    await db.auditLog.create({
      data: {
        actorUserId: realUserId,
        action: "IMPERSONATION_ENDED",
        targetEntity: active.eid,
      },
    });
  }

  redirect("/admin");
}
