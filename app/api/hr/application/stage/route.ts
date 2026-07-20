import { NextResponse, type NextRequest } from "next/server";
import type { PipelineStage } from "@prisma/client";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { scheduleRetentionOnRejection } from "@/lib/recruitment/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

const STAGES: PipelineStage[] = [
  "APPLIED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
];

/**
 * Move an application between pipeline stages. HR only — a Manager may give
 * feedback but does not drive the pipeline.
 *
 * HIRED is deliberately NOT settable here: it is set only by hire-conversion
 * when an offer is ACCEPTED (app/api/hr/offer/status), so an application can
 * never read HIRED without a real Employee record behind it.
 */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may move applications", 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const id = typeof body.id === "string" ? body.id : "";
  const stage = body.stage as PipelineStage;
  const rejectedReason =
    typeof body.rejectedReason === "string" ? body.rejectedReason.trim() : "";

  if (!id || !STAGES.includes(stage))
    return fail("BAD_INPUT", `id and a valid stage (${STAGES.join("|")}) are required`, 400);

  if (stage === "HIRED")
    return fail(
      "NOT_ALLOWED",
      "HIRED is set automatically when an offer is accepted — it cannot be set by hand.",
      400,
    );

  // A rejection without a recorded reason is unauditable, so the reason is
  // required rather than optional.
  if (stage === "REJECTED" && !rejectedReason)
    return fail("BAD_INPUT", "A reason is required when rejecting a candidate.", 400);

  try {
    const current = await db.application.findUnique({
      where: { id },
      select: { id: true, stage: true, candidateId: true },
    });
    if (!current) return fail("NOT_FOUND", "Application not found", 404);

    if (current.stage === "HIRED")
      return fail(
        "ALREADY_HIRED",
        "This candidate has already been hired and converted to an employee.",
        409,
      );
    if (current.stage === stage)
      return fail("NO_CHANGE", `Application is already at ${stage}.`, 409);

    // Atomic: the previous stage is in the where-clause, so two people moving
    // the same candidate at once cannot both succeed and lose one transition.
    const result = await db.$transaction(async (tx) => {
      const upd = await tx.application.updateMany({
        where: { id, stage: current.stage },
        data: {
          stage,
          rejectedReason: stage === "REJECTED" ? rejectedReason : null,
        },
      });
      if (upd.count === 0) return { count: 0 as const };

      // Rejection starts the retention clock, in the same transaction as the
      // rejection itself — a rejected candidate must never be left with no
      // deletion date at all.
      const retention =
        stage === "REJECTED"
          ? await scheduleRetentionOnRejection(tx, current.candidateId)
          : null;

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "APPLICATION_STAGE_CHANGED",
          // Old and new stage both recorded, per the brief.
          targetEntity: `${id}: ${current.stage} → ${stage}${
            stage === "REJECTED" ? ` (${rejectedReason})` : ""
          }`,
        },
      });
      return { count: upd.count, retention };
    });

    if (result.count === 0)
      return fail(
        "CONCURRENT_CHANGE",
        "This application moved while you were viewing it. Reload and try again.",
        409,
      );

    return NextResponse.json({
      ok: true,
      id,
      from: current.stage,
      to: stage,
      ...(result.retention
        ? {
            retention: {
              scheduledDeletionAt: result.retention.scheduledFor.toISOString().slice(0, 10),
              talentPoolConsent: result.retention.consented,
            },
          }
        : {}),
    });
  } catch (err) {
    console.error("[hr/application/stage] failed:", err);
    return fail("SERVER_ERROR", "Could not move the application", 503);
  }
}
