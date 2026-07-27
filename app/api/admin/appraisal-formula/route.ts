import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCurrentRole } from "@/lib/auth";
import { withPrivilegedRoute } from "@/lib/mfa-guard";
import { fail } from "@/lib/api/response";
import { normalizeDepartment, resolveFormula } from "@/lib/appraisal/formula-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function GETHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  // Read is Super-Admin-only too (this config is SA-owned).
  if ((await getCurrentRole()) !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only Super Admin may view the appraisal formula", 403);

  const dept = normalizeDepartment(req.nextUrl.searchParams.get("department"));

  try {
    return NextResponse.json({ ok: true, ...(await resolveFormula(db, dept)) });
  } catch (err) {
    console.error("[admin/appraisal-formula GET] failed:", err);
    return fail("SERVER_ERROR", "Could not load the formula", 503);
  }
}

async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  // Sole edit right — enforced at the API, not just hidden in the UI.
  if ((await getCurrentRole()) !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only Super Admin may edit the appraisal formula", 403);

  let body: { department?: unknown; weights?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const dept = normalizeDepartment(
    typeof body.department === "string" ? body.department : null,
  );
  const w = body.weights ?? {};
  const nums = {
    punctuality: Number(w.punctuality),
    production: Number(w.production),
    quality: Number(w.quality),
    feedback: Number(w.feedback),
    warningPenaltyPoints: Number(w.warningPenaltyPoints),
    punctualityFrequencyWeight: Number(w.punctualityFrequencyWeight),
    punctualitySeverityWeight: Number(w.punctualitySeverityWeight),
    punctualitySeverityCapMinutes: Number(w.punctualitySeverityCapMinutes),
  };

  if (Object.values(nums).some((n) => !Number.isFinite(n) || n < 0)) {
    return fail("BAD_INPUT", "All weights must be non-negative numbers", 400);
  }
  const positiveSum =
    nums.punctuality + nums.production + nums.quality + nums.feedback;
  if (positiveSum !== 100) {
    return fail(
      "BAD_WEIGHTS",
      `punctuality + production + quality + feedback must sum to 100 (got ${positiveSum}). warningPenaltyPoints is separate.`,
      400,
    );
  }
  // Phase 8: the punctuality frequency/severity split must sum to exactly 100.
  const punctSplit =
    nums.punctualityFrequencyWeight + nums.punctualitySeverityWeight;
  if (punctSplit !== 100) {
    return fail(
      "BAD_PUNCTUALITY_SPLIT",
      `punctualityFrequencyWeight + punctualitySeverityWeight must sum to 100 (got ${punctSplit}).`,
      400,
    );
  }
  if (!(nums.punctualitySeverityCapMinutes > 0)) {
    return fail(
      "BAD_PUNCTUALITY_CAP",
      "punctualitySeverityCapMinutes must be a positive number of minutes.",
      400,
    );
  }

  try {
    // department is a nullable unique — Postgres treats NULLs as distinct, so
    // upsert-by-null isn't reliable. Find-then-write in a transaction instead.
    const saved = await db.$transaction(async (tx) => {
      const existing = await tx.appraisalFormula.findFirst({ where: { department: dept } });
      const row = existing
        ? await tx.appraisalFormula.update({
            where: { id: existing.id },
            data: { weightsJson: nums, updatedBy: userId },
          })
        : await tx.appraisalFormula.create({
            data: { department: dept, weightsJson: nums, updatedBy: userId },
          });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "APPRAISAL_FORMULA_UPDATED",
          targetEntity: row.id,
        },
      });
      return row;
    });

    return NextResponse.json({ ok: true, id: saved.id, department: dept, weights: nums });
  } catch (err) {
    console.error("[admin/appraisal-formula POST] failed:", err);
    return fail("SERVER_ERROR", "Could not save the formula", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const GET = withPrivilegedRoute(GETHandler);
export const POST = withPrivilegedRoute(POSTHandler);
