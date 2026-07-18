import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getCurrentRole } from "@/lib/auth";
import { getActiveEmployees } from "@/lib/data/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
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

    await db.$transaction(async (tx) => {
      await tx.appraisalCycle.update({ where: { id: cycleId }, data: { published: true } });
      await tx.auditLog.create({
        data: { actorUserId: userId, action: "APPRAISAL_CYCLE_PUBLISHED", targetEntity: cycleId },
      });
    });

    return NextResponse.json({ ok: true, cycleId, published: true });
  } catch (err) {
    console.error("[hr/appraisal/publish] failed:", err);
    return fail("SERVER_ERROR", "Could not publish the cycle", 503);
  }
}
