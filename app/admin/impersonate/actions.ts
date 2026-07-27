"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getRealIdentity, getImpersonation } from "@/lib/auth";
import { IMP_COOKIE, signImpersonation, demoModeEnabled } from "@/lib/impersonation";
import { ROLE_HOME } from "@/lib/auth-types";

/**
 * Begin impersonating another user. Guarded on the REAL authenticated
 * identity (not the effective/impersonated one), so:
 *  - a non-Super-Admin can never start impersonation, and
 *  - an already-impersonating session can never start a nested impersonation
 *    (the real role is still SUPER_ADMIN, but we re-issue from the real id and
 *     never chain — see the check below).
 *
 * THE DEMO_MODE CHECK IS FIRST, before identity is even resolved. This is the
 * real authorization point — a server action is directly invocable over HTTP,
 * so hiding the UI proves nothing. With DEMO_MODE off this throws for EVERY
 * caller including a genuine Super Admin, and it does so before touching the
 * session or the database.
 */
export async function startImpersonation(employeeId: string): Promise<void> {
  if (!demoModeEnabled()) {
    throw new Error(
      "Impersonation is disabled on this deployment. It is available only where DEMO_MODE=true is explicitly set.",
    );
  }

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
  // Never impersonate another Super Admin: it would be a lateral move between
  // equally-privileged accounts, which the audit trail could not meaningfully
  // attribute. Enforced regardless of whether any such target currently exists.
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

/**
 * End impersonation and return to the real Super Admin's own portal.
 *
 * DELIBERATELY NOT GATED ON DEMO_MODE. This only ever de-escalates — it
 * deletes the cookie and redirects to /admin, and can grant nothing. Gating it
 * would mean that flipping DEMO_MODE off while a session held a cookie left
 * that cookie undeletable through the UI. Clearing state must always be
 * reachable, even when the feature that created it is switched off.
 *
 * (With DEMO_MODE off the cookie is already inert — verifyImpersonation()
 * refuses it — so `active` is null and only the delete does any work.)
 */
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
