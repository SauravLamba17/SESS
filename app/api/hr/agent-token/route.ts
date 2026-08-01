import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { idleConsentState } from "@/lib/idle/consent";
import { newAgentToken, tokenFingerprint } from "@/lib/idle/token";
import { withPrivilegedRoute } from "@/lib/mfa-guard";
import { fail } from "@/lib/api/response";
import { ymd } from "@/lib/reports/range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Issue or revoke a desktop-agent token.
 *
 * ISSUING IS CONSENT-GATED: an employee with no ACTIVE IDLE_TRACKING consent
 * cannot be given a token at all. That is the first of two gates — the
 * heartbeat endpoint re-checks consent on every single request, because
 * consent can lapse long after a token was issued.
 */
async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may manage agent tokens", 403);

  let body: { action?: unknown; employeeId?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const action = typeof body.action === "string" ? body.action : "issue";
  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
  if (!employeeId) return fail("BAD_INPUT", "employeeId is required", 400);

  try {
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true, active: true },
    });
    if (!employee) return fail("NOT_FOUND", "Employee not found", 404);

    // ── REVOKE ───────────────────────────────────────────────────────
    if (action === "revoke") {
      const upd = await db.$transaction(async (tx) => {
        const res = await tx.agentToken.updateMany({
          where: { employeeId, active: true },
          data: { active: false },
        });
        if (res.count === 0) return 0;
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: "AGENT_TOKEN_REVOKED",
            targetEntity: `${employeeId} (${employee.name})`,
          },
        });
        return res.count;
      });
      if (upd === 0)
        return fail("NO_ACTIVE_TOKEN", "This employee has no active agent token.", 409);
      return NextResponse.json({ ok: true, employeeId, active: false });
    }

    // ── ISSUE ────────────────────────────────────────────────────────
    if (!employee.active)
      return fail(
        "INACTIVE_EMPLOYEE",
        "Cannot issue an agent token to an offboarded employee.",
        409,
      );

    // GATE 1 OF 2: consent must already exist and be active.
    const consent = await idleConsentState(db, employeeId);
    if (!consent.active)
      return fail(
        "NO_CONSENT",
        consent.reason === "NEVER_GIVEN"
          ? `No IDLE_TRACKING consent is recorded for ${employee.name}. Record their consent on the Compliance & Consent page before issuing an agent token.`
          : `${employee.name}'s IDLE_TRACKING consent expired on ${consent.expiredOn ? ymd(consent.expiredOn) : "an unknown date"}. Record fresh consent on the Compliance & Consent page before issuing an agent token.`,
        409,
      );

    const token = newAgentToken();

    // Upsert: re-issuing REPLACES the previous token, so a decommissioned
    // machine's copy stops working the instant a new one is generated.
    await db.$transaction(async (tx) => {
      await tx.agentToken.upsert({
        where: { employeeId },
        update: { token, active: true, lastSeenAt: null },
        create: { employeeId, token, active: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "AGENT_TOKEN_ISSUED",
          // The token itself is NEVER written to the audit log — only its
          // fingerprint, so the trail identifies which token without leaking it.
          targetEntity: `${employeeId} (${employee.name}) fingerprint=${tokenFingerprint(token)}`,
        },
      });
    });

    // The ONLY time the raw token is ever returned. It is not stored anywhere
    // retrievable by HR afterwards — losing it means issuing a new one.
    return NextResponse.json({
      ok: true,
      employeeId,
      token,
      fingerprint: tokenFingerprint(token),
      warning:
        "This token is shown once and cannot be retrieved again. Treat it like a password.",
    });
  } catch (err) {
    console.error("[hr/agent-token] failed:", err);
    return fail("SERVER_ERROR", "Could not complete the agent token action", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
