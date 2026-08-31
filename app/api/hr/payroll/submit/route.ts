import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { isPeriod } from "@/lib/period";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RED TIER — never cache, see SESS_Caching_Strategy.docx Section 3.
 *
 * Payroll calculation inputs and the DRAFT -> SUBMITTED transition. Read and
 * written straight from PostgreSQL inside a transaction; nothing on this path
 * is read from or written to any cache. No import from lib/cache/ exists here
 * and none may be added.
 */

/**
 * DRAFT → SUBMITTED for every row in a period.
 *
 * SUBMITTED is a soft lock: HR can still SEE the run, but can no longer edit
 * the figures (enforced in app/api/hr/payroll/row/route.ts, not just in the
 * UI). The hard, permanent lock is FINALIZED, and only a Super Admin sets it.
 */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may submit a payroll run", 403);

  let body: { period?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const period = typeof body.period === "string" ? body.period.trim() : "";
  if (!isPeriod(period)) return fail("BAD_INPUT", "period must be YYYY-MM", 400);

  try {
    const drafts = await db.payroll.count({ where: { month: period, status: "DRAFT" } });
    if (drafts === 0)
      return fail(
        "NO_DRAFTS",
        `No DRAFT payroll rows for ${period} — the run is already submitted, finalized, or was never created.`,
        409,
      );

    const count = await db.$transaction(async (tx) => {
      const upd = await tx.payroll.updateMany({
        where: { month: period, status: "DRAFT" },
        data: { status: "SUBMITTED", processedBy: userId },
      });
      if (upd.count === 0) return 0;
      await tx.auditLog.create({
        data: { actorUserId: userId, action: "PAYROLL_RUN_SUBMITTED", targetEntity: period },
      });
      return upd.count;
    });

    if (count === 0)
      return fail("NO_DRAFTS", "The run changed state before it could be submitted.", 409);

    return NextResponse.json({ ok: true, period, submitted: count });
  } catch (err) {
    console.error("[hr/payroll/submit] failed:", err);
    return fail("SERVER_ERROR", "Could not submit the payroll run", 503);
  }
}
