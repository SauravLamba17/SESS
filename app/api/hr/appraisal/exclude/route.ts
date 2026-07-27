import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCurrentRole } from "@/lib/auth";
import { withPrivilegedRoute } from "@/lib/mfa-guard";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may exclude employees", 403);

  let body: { cycleId?: unknown; employeeId?: unknown; excluded?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const cycleId = typeof body.cycleId === "string" ? body.cycleId : "";
  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  const excluded = body.excluded === true;
  if (!cycleId || !employeeId)
    return fail("BAD_INPUT", "cycleId and employeeId are required", 400);

  try {
    const cycle = await db.appraisalCycle.findUnique({ where: { id: cycleId } });
    if (!cycle) return fail("NOT_FOUND", "Cycle not found", 404);
    if (cycle.published)
      return fail("PUBLISHED", "Cycle is published; scope is immutable", 409);

    await db.appraisalScore.upsert({
      where: { employeeId_cycleId: { employeeId, cycleId } },
      create: { employeeId, cycleId, excluded },
      update: { excluded },
    });

    return NextResponse.json({ ok: true, cycleId, employeeId, excluded });
  } catch (err) {
    console.error("[hr/appraisal/exclude] failed:", err);
    return fail("SERVER_ERROR", "Could not update exclusion", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
