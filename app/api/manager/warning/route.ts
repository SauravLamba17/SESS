import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);

  let body: { employeeId?: unknown; reason?: unknown; fileUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const fileUrl = typeof body.fileUrl === "string" && body.fileUrl.trim() ? body.fileUrl.trim() : null;
  if (!employeeId || !reason)
    return fail("BAD_INPUT", "employeeId and reason are required", 400);

  try {
    const manager = await getEmployeeByClerkId(userId);
    if (!manager)
      return fail("NO_EMPLOYEE", "No employee record linked to this account", 403);

    // Direct-report check folded into the same transaction as the create.
    // Always DRAFT — managers cannot release (see /api/hr/warning/release).
    const result = await db.$transaction(async (tx) => {
      const report = await tx.employee.findFirst({
        where: { id: employeeId, managerId: manager.id, active: true },
        select: { id: true },
      });
      if (!report) return null;

      const letter = await tx.warningLetter.create({
        data: { employeeId, reason, fileUrl, issuedBy: userId, status: "DRAFT" },
      });
      await tx.auditLog.create({
        data: { actorUserId: userId, action: "WARNING_LETTER_ISSUED", targetEntity: letter.id },
      });
      return letter;
    });

    if (!result)
      return fail("NOT_DIRECT_REPORT", "That employee is not your direct report", 403);

    return NextResponse.json({ ok: true, id: result.id, status: "DRAFT" });
  } catch (err) {
    console.error("[manager/warning] failed:", err);
    return fail("SERVER_ERROR", "Could not create the warning letter", 503);
  }
}
