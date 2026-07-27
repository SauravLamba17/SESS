import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { idleConsentState } from "@/lib/idle/consent";
import { idleThresholdSeconds } from "@/lib/idle/settings";
import { idleTrackingEnabled } from "@/lib/system-settings";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One 15-minute window can hold at most 15 minutes. Guards a bad/hostile agent. */
const MAX_WINDOW_MINUTES = 60;

/**
 * Desktop-agent ingestion.
 *
 * AUTH: a bearer AgentToken, NOT a Clerk session — the agent is a background
 * service on a machine with no browser and no interactive login. This route is
 * therefore outside the Clerk gate by the same mechanism as /api/careers/apply
 * (middleware only gates the four portal prefixes), and does its own auth here.
 *
 * TWO GATES, both checked on EVERY request:
 *   1. the token exists and is active
 *   2. the employee's IDLE_TRACKING consent is active RIGHT NOW
 *
 * Gate 2 matters most: consent can lapse days after a token was issued, and
 * the agent will happily keep sending. When it fails we return 403 with
 * code PAUSE_TRACKING and `shouldPause: true` — a distinct, actionable signal
 * telling the agent to stop and stop retrying, rather than a bare 401 it would
 * treat as a transient error and hammer us with forever.
 */
export async function POST(req: NextRequest) {
  // ── Bearer token ─────────────────────────────────────────────────
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token)
    return fail("NO_TOKEN", "Missing agent token. Send it as an Authorization: Bearer header.", 401);

  let body: {
    idleMinutes?: unknown;
    activeMinutes?: unknown;
    windowStart?: unknown;
    windowEnd?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const idleMinutes = Number(body.idleMinutes);
  const activeMinutes = Number(body.activeMinutes);
  const windowEndRaw = typeof body.windowEnd === "string" ? body.windowEnd : "";

  if (!Number.isFinite(idleMinutes) || idleMinutes < 0 || idleMinutes > MAX_WINDOW_MINUTES)
    return fail("BAD_INPUT", `idleMinutes must be between 0 and ${MAX_WINDOW_MINUTES}`, 400);
  if (!Number.isFinite(activeMinutes) || activeMinutes < 0 || activeMinutes > MAX_WINDOW_MINUTES)
    return fail("BAD_INPUT", `activeMinutes must be between 0 and ${MAX_WINDOW_MINUTES}`, 400);
  if (idleMinutes + activeMinutes > MAX_WINDOW_MINUTES)
    return fail(
      "BAD_INPUT",
      `idleMinutes + activeMinutes cannot exceed ${MAX_WINDOW_MINUTES} for one window`,
      400,
    );

  // The window's END decides which day the batch lands on — a window spanning
  // midnight is attributed to the day it finished in, so a single window is
  // never split across two IdleLog rows.
  const windowEnd = windowEndRaw ? new Date(windowEndRaw) : new Date();
  if (Number.isNaN(windowEnd.getTime()))
    return fail("BAD_INPUT", "windowEnd must be an ISO date-time", 400);

  try {
    // ── GATE 0 (Phase 11): the org-wide kill switch ──
    // Checked before the token is even looked up: when Super Admin turns idle
    // tracking off, EVERY heartbeat is rejected regardless of tokens or
    // individual consent records. shouldPause tells agents to stop retrying.
    if (!(await idleTrackingEnabled()))
      return fail(
        "IDLE_TRACKING_DISABLED",
        "Idle tracking is disabled org-wide by the administrator. Tracking is paused — this batch was not stored.",
        403,
        { shouldPause: true },
      );

    const agent = await db.agentToken.findUnique({
      where: { token },
      select: {
        id: true,
        active: true,
        employeeId: true,
        employee: { select: { id: true, name: true, active: true } },
      },
    });

    // Same generic message for unknown and revoked tokens — a caller probing
    // tokens learns nothing about which ones exist.
    if (!agent || !agent.active)
      return fail(
        "INVALID_TOKEN",
        "This agent token is not valid. It may have been revoked — contact HR for a new one.",
        401,
        { shouldPause: true },
      );

    if (!agent.employee.active)
      return fail(
        "INACTIVE_EMPLOYEE",
        "This employee is no longer active. Tracking has stopped.",
        403,
        { shouldPause: true },
      );

    // ── GATE 2: consent, re-checked on every heartbeat ──
    const consent = await idleConsentState(db, agent.employeeId);
    if (!consent.active)
      return fail(
        "PAUSE_TRACKING",
        consent.reason === "NEVER_GIVEN"
          ? "Idle-tracking consent is not recorded for this employee. Tracking is paused — this batch was not stored."
          : `Idle-tracking consent expired on ${consent.expiredOn?.toISOString().slice(0, 10)}. Tracking is paused — this batch was not stored.`,
        403,
        {
          // Explicit instruction to the agent: stop, don't retry.
          shouldPause: true,
          consentReason: consent.reason,
        },
      );

    // ── Store ────────────────────────────────────────────────────────
    const day = new Date(
      windowEnd.getFullYear(),
      windowEnd.getMonth(),
      windowEnd.getDate(),
    );

    // ATOMIC INCREMENT, not read-then-write.
    //
    // `increment` compiles to `UPDATE "IdleLog" SET "idleMinutes" =
    // "idleMinutes" + $1 ...` — the database does the addition, holding a row
    // lock for the duration. Two batches arriving milliseconds apart therefore
    // both land; a read-then-write would have each read the same starting
    // total and the second would silently overwrite the first's contribution.
    //
    // The upsert targets the @@unique([employeeId, date]) added for exactly
    // this purpose. The create branch can still lose a race (two batches for a
    // brand-new day at once) — that surfaces as P2002 and is retried below as
    // a pure update, which is the atomic path.
    const write = async () =>
      db.idleLog.upsert({
        where: { employeeId_date: { employeeId: agent.employeeId, date: day } },
        update: {
          idleMinutes: { increment: Math.round(idleMinutes) },
          activeMinutes: { increment: Math.round(activeMinutes) },
        },
        create: {
          employeeId: agent.employeeId,
          date: day,
          idleMinutes: Math.round(idleMinutes),
          activeMinutes: Math.round(activeMinutes),
        },
      });

    let row;
    try {
      row = await write();
    } catch (e) {
      if (typeof e === "object" && e && (e as { code?: string }).code === "P2002") {
        // Another batch created the row first — retry as a plain atomic update.
        row = await db.idleLog.update({
          where: { employeeId_date: { employeeId: agent.employeeId, date: day } },
          data: {
            idleMinutes: { increment: Math.round(idleMinutes) },
            activeMinutes: { increment: Math.round(activeMinutes) },
          },
        });
      } else throw e;
    }

    // Liveness, so HR can spot a silent agent.
    await db.agentToken.update({
      where: { id: agent.id },
      data: { lastSeenAt: new Date() },
    });

    // Hand back the current threshold so a Super Admin's change reaches the
    // agent on its next beat — no reinstall, no redeploy.
    return NextResponse.json({
      ok: true,
      date: day.toISOString().slice(0, 10),
      dayTotals: { idleMinutes: row.idleMinutes, activeMinutes: row.activeMinutes },
      idleThresholdSeconds: await idleThresholdSeconds(),
    });
  } catch (err) {
    console.error("[agent/heartbeat] failed:", err);
    return fail("SERVER_ERROR", "Could not record the heartbeat", 503);
  }
}
