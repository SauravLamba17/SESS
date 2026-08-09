import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseDateOnly } from "@/lib/period";
import { getCurrentRole } from "@/lib/auth";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phase 11: FACE_VERIFICATION removed with the feature (never had any rows).
const CONSENT_TYPES = ["IDLE_TRACKING"] as const;

export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may record consent", 403);

  let body: { employeeId?: unknown; consentType?: unknown; givenOn?: unknown; retentionExpiry?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  const consentType = typeof body.consentType === "string" ? body.consentType : "";
  const givenOn = parseDateOnly(body.givenOn) ?? new Date();
  const retentionExpiry =
    body.retentionExpiry === undefined || body.retentionExpiry === null || body.retentionExpiry === ""
      ? null
      : parseDateOnly(body.retentionExpiry);

  if (!employeeId || !CONSENT_TYPES.includes(consentType as (typeof CONSENT_TYPES)[number]))
    return fail("BAD_INPUT", "employeeId and a valid consentType are required", 400);
  if (body.retentionExpiry && retentionExpiry === null)
    return fail("BAD_INPUT", "retentionExpiry must be YYYY-MM-DD", 400);

  try {
    const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
    if (!emp) return fail("NOT_FOUND", "Employee not found", 404);

    const record = await db.consentRecord.create({
      data: { employeeId, consentType, givenOn, retentionExpiry },
    });
    return NextResponse.json({ ok: true, id: record.id });
  } catch (err) {
    console.error("[hr/consent] failed:", err);
    return fail("SERVER_ERROR", "Could not record consent", 503);
  }
}
