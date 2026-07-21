import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { checkAttestation, attestationIp } from "@/lib/attestation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

/**
 * Acknowledge a warning letter via an Attestation Record.
 *
 * The employee types their own full name; it must match Employee.name
 * (case- and whitespace-insensitive) or the acknowledgement is refused. On
 * success we store what they typed, when, and the originating IP — alongside
 * the legacy `acknowledged` boolean, which stays set for backward
 * compatibility with Phase 2's views.
 *
 * This is an internal record, NOT a legal e-signature. See lib/attestation.ts.
 */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);

  let body: { id?: unknown; attestedName?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return fail("BAD_INPUT", "id is required", 400);

  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee)
      return fail("NO_EMPLOYEE", "No employee record linked to this account", 403);

    // Name check BEFORE any write — a mismatched attestation must leave no
    // trace of a partial acknowledgement.
    const att = checkAttestation(body.attestedName, employee.name);
    if (!att.ok) return fail(att.code, att.message, 400);

    // Owner + RELEASED enforced in the where-clause: a letter that isn't this
    // employee's, or isn't released yet, matches zero rows. `acknowledged`
    // also guards re-attestation — the first attestation is the record.
    const upd = await db.warningLetter.updateMany({
      where: { id, employeeId: employee.id, status: "RELEASED", acknowledged: false },
      data: {
        acknowledged: true,
        attestedName: att.attestedName,
        attestedAt: new Date(),
        attestedIp: attestationIp(req.headers),
      },
    });
    if (upd.count === 0)
      return fail(
        "NOT_ACKNOWLEDGEABLE",
        "Letter not found, not yours, not yet released, or already acknowledged",
        409,
      );

    return NextResponse.json({ ok: true, id, acknowledged: true, attestedName: att.attestedName });
  } catch (err) {
    console.error("[employee/warning/acknowledge] failed:", err);
    return fail("SERVER_ERROR", "Could not acknowledge the letter", 503);
  }
}
