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

  let body: { employeeId?: unknown; subject?: unknown; date?: unknown; summary?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const date = parseDateOnly(body.date);
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  if (!employeeId || !subject || !date)
    return fail("BAD_INPUT", "employeeId, subject and a valid date are required", 400);

  try {
    const manager = await getEmployeeByClerkId(userId);
    if (!manager)
      return fail("NO_EMPLOYEE", "No employee record linked to this account", 403);

    // Direct-report check folded into the same transaction as the create.
    const result = await db.$transaction(async (tx) => {
      const report = await tx.employee.findFirst({
        where: { id: employeeId, managerId: manager.id, active: true },
        select: { id: true },
      });
      if (!report) return null;
      // summaryViaClaude holds manager-entered text for now (no AI this phase).
      return tx.clientMail.create({
        data: { employeeId, subject, date, summaryViaClaude: summary || null, taggedByManagerId: userId },
      });
    });

    if (!result)
      return fail("NOT_DIRECT_REPORT", "That employee is not your direct report", 403);

    return NextResponse.json({ ok: true, id: result.id });
  } catch (err) {
    console.error("[manager/client-mail] failed:", err);
    return fail("SERVER_ERROR", "Could not tag the client mail", 503);
  }
}
