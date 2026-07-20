import type { Prisma } from "@prisma/client";

/**
 * Candidate data retention.
 *
 * Closes the gap flagged in Phase 8: rejected applicants' resumes and contact
 * details were retained indefinitely. Under the DPDP Act, personal data should
 * not outlive the purpose it was collected for.
 *
 * THE POLICY
 *   • Rejected, no talent-pool consent → review in 1 year.
 *   • Rejected, talent-pool consent given → review in 2 years. Bounded, not
 *     indefinite: an unbounded "consent" window is the same problem wearing a
 *     permission slip.
 *   • HIRED candidates are never scheduled. Their lawful basis changed from
 *     "recruitment" to "employment records", which is governed by employment
 *     law and a much longer clock. Deleting the hiring trail of a current
 *     employee would also destroy the provenance of their own employment.
 *
 * NOTHING DELETES AUTOMATICALLY. Reaching scheduledDeletionAt only puts a
 * candidate on HR's review list. A human decides, because a silent purge can
 * destroy data needed for a live dispute, a background check or a reference —
 * and it cannot be undone.
 */

export type Tx = Prisma.TransactionClient;

/** Retention window (days) for a rejected candidate WITHOUT consent. */
export const RETENTION_DAYS_NO_CONSENT = 365;
/** Retention window (days) for a rejected candidate WITH talent-pool consent. */
export const RETENTION_DAYS_WITH_CONSENT = 730;
/** How far "Extend Retention" pushes the review date out. */
export const EXTENSION_DAYS = 180;

export function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

/** The review date a rejected candidate should get, given their consent. */
export function retentionDateFor(consented: boolean, now = new Date()): Date {
  return addDays(now, consented ? RETENTION_DAYS_WITH_CONSENT : RETENTION_DAYS_NO_CONSENT);
}

/**
 * Schedule a rejected candidate's retention review.
 *
 * Called when an application moves to REJECTED. Safe to call repeatedly: a
 * candidate rejected for a second role keeps the LATER of the two dates, so a
 * fresh rejection never shortens a window they already had.
 *
 * Returns null when nothing was scheduled (candidate hired, or already has a
 * later date), so callers can report accurately rather than guess.
 */
export async function scheduleRetentionOnRejection(
  tx: Tx,
  candidateId: string,
  now = new Date(),
): Promise<{ scheduledFor: Date; consented: boolean } | null> {
  const candidate = await tx.candidate.findUnique({
    where: { id: candidateId },
    select: {
      id: true,
      talentPoolConsent: true,
      scheduledDeletionAt: true,
      applications: { select: { stage: true } },
    },
  });
  if (!candidate) return null;

  // Hired anywhere → never scheduled. See the note above on lawful basis.
  if (candidate.applications.some((a) => a.stage === "HIRED")) return null;

  const target = retentionDateFor(candidate.talentPoolConsent, now);

  // Never shorten an existing window.
  if (candidate.scheduledDeletionAt && candidate.scheduledDeletionAt >= target) return null;

  await tx.candidate.update({
    where: { id: candidateId },
    data: { scheduledDeletionAt: target },
  });

  return { scheduledFor: target, consented: candidate.talentPoolConsent };
}

/**
 * Ordered deletion of everything belonging to a candidate.
 *
 * Prisma cascades NOTHING here — every relation to Candidate/Application is
 * required, and Prisma's default referential action for a required relation is
 * Restrict. Verified empirically: deleting a Candidate with applications fails
 * with P2003 `Application_candidateId_fkey`, and deleting an Application with
 * an Offer or feedback fails the same way. So the order below is mandatory,
 * children first.
 *
 * The caller is responsible for deleting the resume FILE (see
 * lib/recruitment/storage.ts deleteResume) — it has no DB relation and would
 * otherwise survive this entirely.
 */
export async function deleteCandidateData(
  tx: Tx,
  candidateId: string,
): Promise<{
  offers: number;
  interviewFeedback: number;
  applications: number;
  candidates: number;
}> {
  const apps = await tx.application.findMany({
    where: { candidateId },
    select: { id: true },
  });
  const appIds = apps.map((a) => a.id);

  const offers = await tx.offer.deleteMany({ where: { applicationId: { in: appIds } } });
  const feedback = await tx.interviewFeedback.deleteMany({
    where: { applicationId: { in: appIds } },
  });
  const applications = await tx.application.deleteMany({ where: { candidateId } });
  const candidates = await tx.candidate.deleteMany({ where: { id: candidateId } });

  return {
    offers: offers.count,
    interviewFeedback: feedback.count,
    applications: applications.count,
    candidates: candidates.count,
  };
}
