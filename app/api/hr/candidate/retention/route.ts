import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteResume } from "@/lib/recruitment/storage";
import {
  deleteCandidateData,
  addDays,
  EXTENSION_DAYS,
} from "@/lib/recruitment/retention";
import { withPrivilegedRoute } from "@/lib/mfa-guard";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retention actions on a candidate past their review date.
 *
 * `delete` is irreversible and removes real personal data, so it is HR-only,
 * requires the candidate id explicitly, and refuses on a hired candidate.
 * `extend` pushes the review date out when there is a legitimate reason to
 * keep the record (live dispute, pending reference check).
 */
async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may act on candidate retention", 403);

  let body: { action?: unknown; candidateId?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  const candidateId = typeof body.candidateId === "string" ? body.candidateId : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!candidateId) return fail("BAD_INPUT", "candidateId is required", 400);
  if (action !== "delete" && action !== "extend")
    return fail("BAD_INPUT", "action must be 'delete' or 'extend'", 400);

  try {
    const candidate = await db.candidate.findUnique({
      where: { id: candidateId },
      select: {
        id: true,
        name: true,
        resumeUrl: true,
        scheduledDeletionAt: true,
        applications: { select: { stage: true } },
      },
    });
    if (!candidate) return fail("NOT_FOUND", "Candidate not found", 404);

    // ── Extend ───────────────────────────────────────────────────────
    if (action === "extend") {
      // A retention extension without a stated reason is exactly the kind of
      // indefinite drift this policy exists to stop.
      if (!reason)
        return fail(
          "BAD_INPUT",
          "A reason is required to extend retention — record why this candidate's data must be kept longer.",
          400,
        );

      // Extend from today, not from the (already past) original date.
      const newDate = addDays(new Date(), EXTENSION_DAYS);
      await db.$transaction(async (tx) => {
        await tx.candidate.update({
          where: { id: candidateId },
          data: { scheduledDeletionAt: newDate },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: "CANDIDATE_RETENTION_EXTENDED",
            targetEntity: `${candidateId} until ${newDate.toISOString().slice(0, 10)} (${reason})`,
          },
        });
      });

      return NextResponse.json({
        ok: true,
        candidateId,
        scheduledDeletionAt: newDate.toISOString().slice(0, 10),
      });
    }

    // ── Delete ───────────────────────────────────────────────────────
    // A hired candidate's record is employment provenance now, governed by a
    // different lawful basis and a much longer clock. Deleting it would erase
    // the origin of a current employee's own record.
    if (candidate.applications.some((a) => a.stage === "HIRED"))
      return fail(
        "HIRED_CANDIDATE",
        `${candidate.name} was hired. Their recruitment record is part of their employment history and is retained under employment-records rules, not the candidate retention policy.`,
        409,
      );

    // Guard against deleting someone who is not actually due.
    if (!candidate.scheduledDeletionAt || candidate.scheduledDeletionAt > new Date())
      return fail(
        "NOT_DUE",
        candidate.scheduledDeletionAt
          ? `This candidate is not due for review until ${candidate.scheduledDeletionAt.toISOString().slice(0, 10)}.`
          : "This candidate has no scheduled deletion date — they are still in an active process.",
        409,
      );

    // Prisma cascades NOTHING here (verified: P2003 on
    // Application_candidateId_fkey), so deletion is explicitly ordered.
    const counts = await db.$transaction(async (tx) => {
      const c = await deleteCandidateData(tx, candidateId);
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "CANDIDATE_DATA_DELETED",
          // The candidate row is gone, so the audit row carries the detail —
          // this is the only surviving evidence the erasure happened.
          targetEntity: `${candidateId} (${candidate.name}) applications=${c.applications} feedback=${c.interviewFeedback} offers=${c.offers}`,
        },
      });
      return c;
    });

    // The resume file has no DB relation — without this the CV would outlive
    // every database row about its owner.
    const resumeDeleted = await deleteResume(candidate.resumeUrl);

    return NextResponse.json({
      ok: true,
      candidateId,
      deleted: { ...counts, resumeFile: resumeDeleted },
    });
  } catch (err) {
    console.error("[hr/candidate/retention] failed:", err);
    return fail("SERVER_ERROR", "Could not complete the retention action", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
