import type { Prisma } from "@prisma/client";

/**
 * HR-facing notifications, using Phase 7's Notification model unchanged.
 *
 * ── WHY THIS FILE EXISTS (the addressing problem) ──────────────────────────
 *
 * Phase 7's Notification is addressed to an EMPLOYEE (`employeeId`, non-null).
 * That fits PAYSLIP_READY perfectly: the recipient is a specific person who
 * definitionally has an Employee record, because the payslip is theirs.
 *
 * "Tell HR a candidate applied" is a different kind of address — it targets a
 * ROLE, not a person. I checked whether that distinction actually bites here:
 *
 *   • Role at runtime comes from CLERK metadata (lib/auth.ts realRoleOf), not
 *     from the DB `User` table.
 *   • `User.employeeId` is NULLABLE, so the schema permits an HR user with no
 *     Employee record.
 *   • `User` rows come from two paths. The live one is the Clerk invitation
 *     webhook (app/api/webhooks/clerk → linkClerkUserToEmployee), which creates
 *     the User when an invited person accepts and links it to their existing
 *     Employee. The other is prisma/seed-test-data.ts, which is demo-only and
 *     refuses to run unless DEMO_MODE=true. Phase 5 onboarding itself creates
 *     an Employee and NO User row — the User appears later, on acceptance.
 *   • Neither path is obliged to attach an Employee, and a Super Admin can
 *     authenticate through Clerk with no DB row at all.
 *
 * So "every HR user has an Employee record" is NOT structurally guaranteed.
 * No row counts are quoted here on purpose: a count describes whatever data
 * happens to exist at one moment and is wrong again the next time anyone is
 * onboarded, offboarded, or the demo accounts are cleared.
 *
 * Rather than restructure Notification (adding a nullable `recipientRole` would
 * make `employeeId` nullable and weaken the guarantee every existing
 * PAYSLIP_READY row relies on), this resolves recipients through the existing
 * User→Employee link and makes the zero-recipient case LOUD instead of silent.
 * If HR users ever exist without Employee records, the count returned here goes
 * to 0 and the caller logs it — which is the signal to add `recipientRole` for
 * real.
 */

export type Tx = Prisma.TransactionClient;

export interface NotifyResult {
  recipients: number;
  /** True when nobody could be notified — the caller should log this. */
  noRecipients: boolean;
}

/**
 * Active employees whose linked User has role HR.
 *
 * A single query with a relation filter — no per-user lookup, and it stays one
 * query however many HR staff exist.
 */
export async function hrRecipients(tx: Tx): Promise<{ id: string }[]> {
  return tx.employee.findMany({
    where: { active: true, user: { role: "HR" } },
    select: { id: true },
  });
}

/**
 * Notify HR that a candidate applied.
 *
 * Uses tx.notification.createMany — the identical model and creation pattern
 * as Phase 7's PAYSLIP_READY (see app/api/admin/payroll/finalize/route.ts).
 * No second notification mechanism is introduced.
 */
export async function notifyHrOfApplication(
  tx: Tx,
  input: { candidateName: string; requisitionTitle: string },
): Promise<NotifyResult> {
  const recipients = await hrRecipients(tx);
  if (recipients.length === 0) return { recipients: 0, noRecipients: true };

  await tx.notification.createMany({
    data: recipients.map((r) => ({
      employeeId: r.id,
      type: "NEW_APPLICATION",
      message: `${input.candidateName} applied for ${input.requisitionTitle}.`,
    })),
  });

  return { recipients: recipients.length, noRecipients: false };
}
