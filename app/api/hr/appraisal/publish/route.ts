import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCurrentRole } from "@/lib/auth";
import { getActiveEmployees } from "@/lib/data/scope";
import { notifyEmployees } from "@/lib/notify";
import { withPrivilegedRoute } from "@/lib/mfa-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may publish cycles", 403);

  let body: { cycleId?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const cycleId = typeof body.cycleId === "string" ? body.cycleId : "";
  if (!cycleId) return fail("BAD_INPUT", "cycleId is required", 400);

  try {
    const cycle = await db.appraisalCycle.findUnique({ where: { id: cycleId } });
    if (!cycle) return fail("NOT_FOUND", "Cycle not found", 404);
    if (cycle.published) return fail("PUBLISHED", "Cycle is already published", 409);

    const [employees, scores] = await Promise.all([
      getActiveEmployees(cycle.department),
      db.appraisalScore.findMany({
        where: { cycleId },
        select: { employeeId: true, finalScore: true, excluded: true },
      }),
    ]);
    const byEmp = new Map(scores.map((s) => [s.employeeId, s]));

    // Every in-scope employee must be COMPLETE (finalScore set) or excluded.
    const blocking = employees
      .filter((e) => {
        const row = byEmp.get(e.id);
        return !row || (row.finalScore === null && !row.excluded);
      })
      .map((e) => ({ employeeId: e.id, name: e.name }));

    if (blocking.length > 0) {
      return NextResponse.json(
        {
          error:
            "Cannot publish: some employees are not scored. Compute scores, or exclude them from this cycle.",
          code: "INCOMPLETE_SCOPE",
          blocking,
        },
        { status: 409 },
      );
    }

    // Only employees whose score was actually INCLUDED — an excluded employee
    // has no published score, so telling them one is ready would be wrong.
    const notifyIds = scores
      .filter((s) => !s.excluded && s.finalScore !== null)
      .map((s) => s.employeeId);

    const notified = await db.$transaction(async (tx) => {
      await tx.appraisalCycle.update({ where: { id: cycleId }, data: { published: true } });
      await tx.auditLog.create({
        data: { actorUserId: userId, action: "APPRAISAL_CYCLE_PUBLISHED", targetEntity: cycleId },
      });
      return notifyEmployees(
        tx,
        notifyIds,
        "APPRAISAL_PUBLISHED",
        `Your appraisal score for ${cycle.period} has been published and is available on My Appraisal.`,
      );
    });

    return NextResponse.json({ ok: true, cycleId, published: true, notified });
  } catch (err) {
    console.error("[hr/appraisal/publish] failed:", err);
    return fail("SERVER_ERROR", "Could not publish the cycle", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
