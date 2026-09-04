import type { Prisma } from "@prisma/client";

/**
 * Notification helpers — ONE mechanism for the whole system.
 *
 * Phase 7 introduced Notification for PAYSLIP_READY and Phase 8 added
 * NEW_APPLICATION via lib/recruitment/notify.ts. This module generalises that
 * same model so every consequential status transition notifies through one
 * code path. No second mechanism is introduced.
 *
 * Every function takes a transaction client, because a notification belongs in
 * the same transaction as the state change it describes — an employee should
 * never be told their leave was approved by a transaction that then rolled
 * back, nor should an approval commit while its notification silently vanishes.
 *
 * ─── ADDRESSING: USER RECEIVES, EMPLOYEE IS CONTEXT ──────────────────────
 * A notification carries two distinct facts and this module keeps them apart:
 *
 *   recipientUserId — WHO RECEIVES IT. Always a User, always required.
 *   employeeId      — WHICH HR ENTITY IT CONCERNS. Optional.
 *
 * Delivery is an application-identity question, so it resolves through User.
 * That is what makes an employee-less administrator reachable by system alerts;
 * addressing by Employee made them silently unreachable. The old caveat in this
 * file — "an HR user without an Employee record would resolve to zero
 * recipients" — is therefore gone rather than merely logged: notifyHr() now
 * resolves HR *Users* and needs no Employee at all.
 *
 * Employee-subject notifications (leave, warnings, payslips, appraisals,
 * expenses) still carry employeeId, because which person the message is ABOUT
 * is real information. Role-addressed news (NEW_APPLICATION, OFFER_*) carries
 * employeeId: null — it concerns a candidate, not the HR staffer reading it.
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
  // Phase 10
  | "LEAVE_APPROVED"
  | "LEAVE_REJECTED"
  | "WARNING_RELEASED"
  | "APPRAISAL_PUBLISHED"
  | "EXPENSE_APPROVED"
  | "EXPENSE_REJECTED"
  | "OFFER_SENT"
  | "OFFER_ACCEPTED"
  | "OFFER_DECLINED";

/** One notification aimed at a specific employee, for the batch helpers. */
export interface EmployeeNotification {
  employeeId: string;
  type: NotificationType;
  message: string;
}

/**
 * THE PRIMITIVE. Everything else in this file funnels through here, so the
 * recipient rule exists in exactly one place.
 *
 * `employeeId` is optional context and defaults to null — a caller that has no
 * HR subject simply omits it rather than inventing one.
 */
export async function notifyUsers(
  tx: Tx,
  rows: {
    recipientUserId: string;
    employeeId?: string | null;
    type: NotificationType;
    message: string;
  }[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const res = await tx.notification.createMany({
    data: rows.map((r) => ({
      recipientUserId: r.recipientUserId,
      employeeId: r.employeeId ?? null,
      type: r.type,
      message: r.message,
    })),
  });
  return res.count;
}

/**
 * Notify the User behind each employee, carrying that employee as context.
 * Per-recipient messages, resolved in ONE query however many employees.
 *
 * ─── EMPLOYEES WITH NO LOGIN ─────────────────────────────────────────────
 * Not every Employee has a User: bulk-imported staff are never invited, and an
 * invitation is only linked once accepted. Those employees resolve to no
 * recipient and are skipped, which is why the return value is a COUNT rather
 * than void — it is the number of notifications actually created, and a caller
 * seeing fewer than it asked for is seeing something true.
 *
 * This is not a behaviour regression. A notification addressed to an employee
 * with no account was already undeliverable — they cannot sign in, so no panel
 * ever rendered it. It was a row nobody could read. The difference now is that
 * the gap is countable instead of invisible.
 */
export async function notifyEach(
  tx: Tx,
  items: EmployeeNotification[],
): Promise<number> {
  if (items.length === 0) return 0;
  const employeeIds = [...new Set(items.map((i) => i.employeeId))];
  const users = await tx.user.findMany({
    where: { employeeId: { in: employeeIds } },
    select: { id: true, employeeId: true },
  });
  const userByEmployee = new Map(users.map((u) => [u.employeeId!, u.id]));

  return notifyUsers(
    tx,
    items.flatMap((i) => {
      const recipientUserId = userByEmployee.get(i.employeeId);
      if (!recipientUserId) return [];
      return [{ recipientUserId, employeeId: i.employeeId, type: i.type, message: i.message }];
    }),
  );
}

/** Notify one employee. Returns 0 when they have no linked account. */
export async function notifyEmployee(
  tx: Tx,
  employeeId: string,
  type: NotificationType,
  message: string,
): Promise<number> {
  return notifyEach(tx, [{ employeeId, type, message }]);
}

/** Notify several employees with the same message — one resolve, one insert. */
export async function notifyEmployees(
  tx: Tx,
  employeeIds: string[],
  type: NotificationType,
  message: string,
): Promise<number> {
  return notifyEach(tx, employeeIds.map((employeeId) => ({ employeeId, type, message })));
}

/**
 * Every HR User — resolved from User.role, with no Employee join.
 *
 * This is the change that closes the addressing gap. The previous version
 * queried `employee.findMany({ where: { user: { role: "HR" } } })`, so an HR
 * administrator without an Employee record was invisible to it and received
 * nothing. Role lives on User, so that is where the question is asked.
 *
 * Deliberately NOT filtered on Employee.active: the recipient here is an
 * account, and an account's ability to receive HR news is a function of its
 * role, not of an HR profile it may not have. A departed employee's account is
 * role-changed or removed, which is the correct control point.
 */
export async function hrUserIds(tx: Tx): Promise<string[]> {
  const rows = await tx.user.findMany({ where: { role: "HR" }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Notify every HR user. Returns the count so callers can log a zero.
 *
 * employeeId is null by design: this is role-addressed news about a candidate
 * or an offer, and the HR person reading it is not its subject.
 */
export async function notifyHr(
  tx: Tx,
  type: NotificationType,
  message: string,
): Promise<number> {
  const ids = await hrUserIds(tx);
  return notifyUsers(
    tx,
    ids.map((recipientUserId) => ({ recipientUserId, employeeId: null, type, message })),
  );
}
