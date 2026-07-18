import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getCurrentRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

function normalizeDepartment(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" || t.toLowerCase() === "global" ? null : t;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may create cycles", 403);

  let body: { period?: unknown; department?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const period = typeof body.period === "string" ? body.period.trim() : "";
  const department = normalizeDepartment(body.department);
  if (!period) return fail("BAD_INPUT", "period is required", 400);

  try {
    // Resolve the formula: department-specific, else global. Never fabricate.
    const own = await db.appraisalFormula.findFirst({ where: { department } });
    const globalOne =
      department === null
        ? own
        : await db.appraisalFormula.findFirst({ where: { department: null } });
    const formula = own ?? globalOne;
    if (!formula) {
      return fail(
        "NO_FORMULA",
        "No appraisal formula configured for this department or globally. Ask a Super Admin to configure the formula first.",
        400,
      );
    }

    const cycle = await db.$transaction(async (tx) => {
      const created = await tx.appraisalCycle.create({
        data: {
          period,
          department,
          // Snapshot — a copy, not a live reference to AppraisalFormula.
          weightsJson: formula.weightsJson as object,
          createdBy: userId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "APPRAISAL_CYCLE_CREATED",
          targetEntity: created.id,
        },
      });
      return created;
    });

    return NextResponse.json({ ok: true, id: cycle.id, period, department });
  } catch (err) {
    console.error("[hr/appraisal/cycle] failed:", err);
    return fail("SERVER_ERROR", "Could not create the cycle", 503);
  }
}
