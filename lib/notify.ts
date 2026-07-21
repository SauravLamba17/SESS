import type { Prisma } from "@prisma/client";

/**
 * Notification helpers — ONE mechanism for the whole system.
 *
 * Phase 7 introduced Notification for PAYSLIP_READY and Phase 8 added
 * NEW_APPLICATION via lib/recruitment/notify.ts. This module generalises that
 * same model and the same `createMany` call shape so every consequential
 * status transition notifies through one code path. No second mechanism is
 * introduced: these functions write `Notification` rows exactly as the
 * existing two sites do.
 *
 * Every function takes a transaction client, because a notification belongs in
 * the same transaction as the state change it describes — an employee should
 * never be told their leave was approved by a transaction that then rolled
 * back, nor should an approval commit while its notification silently vanishes.
 */

export type Tx = Prisma.TransactionClient;

/**
 * The complete set of notification types in the system. Kept as a union so a
 * typo becomes a compile error rather than a notification nobody can filter on.
 */
export type NotificationType =
  // Phase 7
  | "PAYSLIP_READY"
  // Phase 8
  | "NEW_APPLICATION"
  // This phase
  | "LEAVE_APPROVED"
  | "LEAVE_REJECTED"
  | "WARNING_RELEASED"
  | "APPRAISAL_PUBLISHED"
  | "EXPENSE_APPROVED"
  | "EXPENSE_REJECTED"
  | "OFFER_SENT"
  | "OFFER_ACCEPTED"
  | "OFFER_DECLINED";

/** Notify one employee. */
export async function notifyEmployee(
  tx: Tx,
  employeeId: string,
  type: NotificationType,
  message: string,
): Promise<number> {
  await tx.notification.create({ data: { employeeId, type, message } });
  return 1;
}

/** Notify several employees with the same message — one insert. */
export async function notifyEmployees(
  tx: Tx,
  employeeIds: string[],
  type: NotificationType,
  message: string,
): Promise<number> {
  if (employeeIds.length === 0) return 0;
  const res = await tx.notification.createMany({
    data: employeeIds.map((employeeId) => ({ employeeId, type, message })),
  });
  return res.count;
}

/**
 * Active employees whose linked User has role HR.
 *
 * Identical resolution to lib/recruitment/notify.ts's hrRecipients — offers
 * are candidate-facing events with no Employee to notify, so HR is the
 * audience, exactly as for NEW_APPLICATION.
 *
 * Phase 8 caveat still applies and is unchanged: `User.employeeId` is
 * nullable, so an HR user without an Employee record would resolve to zero
 * recipients. Callers must treat a 0 return as something to log, never to
 * ignore silently.
 */
export async function hrRecipientIds(tx: Tx): Promise<string[]> {
  const rows = await tx.employee.findMany({
    where: { active: true, user: { role: "HR" } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Notify every HR user. Returns the count so callers can log a zero. */
export async function notifyHr(
  tx: Tx,
  type: NotificationType,
  message: string,
): Promise<number> {
  return notifyEmployees(tx, await hrRecipientIds(tx), type, message);
}
