// Relative + explicit extension, matching every other lib->lib VALUE import
// in this codebase (lib/payroll/assemble.ts, lib/reports/csv.ts, ...). The
// "@/" alias resolves under Next but NOT under the plain-node verify
// scripts that import this module, and this is a value import, not a type.
import { notifyHr, hrUserIds, type Tx } from "../notify.ts";

/**
 * HR-facing recruitment notifications.
 *
 * ── WHAT CHANGED, AND WHY THIS FILE IS NOW THIN ───────────────────────────
 *
 * This module used to carry its own recipient resolution and a long note
 * explaining that it could not fix the real problem. That note described the
 * defect exactly:
 *
 *   "`User.employeeId` is NULLABLE, so the schema permits an HR user with no
 *    Employee record... If HR users ever exist without Employee records, the
 *    count returned here goes to 0 and the caller logs it — which is the signal
 *    to add `recipientRole` for real."
 *
 * That signal has been acted on. Notification now addresses a USER
 * (`recipientUserId`, required) and keeps Employee as optional context, so the
 * workaround this file existed to document is gone. Recipient resolution lives
 * once, in lib/notify.ts, and asks User.role directly — an HR administrator
 * with no Employee record now receives these like anyone else.
 *
 * The file remains only for its domain vocabulary: "tell HR a candidate
 * applied" is a recruitment concept, and app/api/careers/apply reads better
 * calling that than calling notifyHr with a hand-built sentence.
 */

export type { Tx };

export interface NotifyResult {
  recipients: number;
  /** True when nobody could be notified — the caller should log this. */
  noRecipients: boolean;
}

/**
 * Every HR recipient, as User ids.
 *
 * Returns `{ id }[]` — the same shape as before — but these are User ids now,
 * not Employee ids, because the recipient of a notification is a User.
 */
export async function hrRecipients(tx: Tx): Promise<{ id: string }[]> {
  return (await hrUserIds(tx)).map((id) => ({ id }));
}

/**
 * Notify HR that a candidate applied.
 *
 * employeeId is left null by notifyHr(): the notification concerns a
 * CANDIDATE, who has no Employee record, and certainly does not concern the HR
 * staffer receiving it.
 */
export async function notifyHrOfApplication(
  tx: Tx,
  input: { candidateName: string; requisitionTitle: string },
): Promise<NotifyResult> {
  const recipients = await notifyHr(
    tx,
    "NEW_APPLICATION",
    `${input.candidateName} applied for ${input.requisitionTitle}.`,
  );
  return { recipients, noRecipients: recipients === 0 };
}
