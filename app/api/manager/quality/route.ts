import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);

  let body: {
    employeeId?: unknown;
    date?: unknown;
    defectCount?: unknown;
    qualityScore?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  const date = parseDateOnly(body.date);
  const defectCount = Number(body.defectCount);
  const qualityScore = Number(body.qualityScore);

  if (
    !employeeId ||
    !date ||
    !Number.isInteger(defectCount) ||
    defectCount < 0 ||
    !Number.isFinite(qualityScore) ||
    qualityScore < 0 ||
    qualityScore > 100
  ) {
    return fail(
      "BAD_INPUT",
      "employeeId, a valid date, defectCount (int ≥ 0) and qualityScore (0–100) are required",
      400,
    );
  }

  try {
    const manager = await getEmployeeByClerkId(userId);
    if (!manager)
      return fail("NO_EMPLOYEE", "No employee record linked to this account", 403);

    // Authorization + write in one transaction — the direct-report check and
    // the upsert + audit all commit together (same shape as target-setting).
    const result = await db.$transaction(async (tx) => {
      const report = await tx.employee.findFirst({
        where: { id: employeeId, managerId: manager.id, active: true },
        select: { id: true },
      });
      if (!report) return null;

      const qr = await tx.qualityReport.upsert({
        where: { employeeId_date: { employeeId, date } },
        create: { employeeId, date, defectCount, qualityScore, reviewedBy: userId },
        update: { defectCount, qualityScore, reviewedBy: userId },
      });
      await tx.auditLog.create({
        data: { actorUserId: userId, action: "QUALITY_LOGGED", targetEntity: qr.id },
      });
      return qr;
    });

    if (!result)
      return fail("NOT_DIRECT_REPORT", "That employee is not your direct report", 403);

    return NextResponse.json({
      ok: true,
      id: result.id,
      employeeId,
      defectCount: result.defectCount,
      qualityScore: result.qualityScore,
    });
  } catch (err) {
    console.error("[manager/quality] failed:", err);
    return fail("SERVER_ERROR", "Could not save the quality report", 503);
  }
}
