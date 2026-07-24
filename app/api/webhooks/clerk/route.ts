import { NextResponse, type NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { db } from "@/lib/db";
import type { Role } from "@/lib/auth-types";
import { linkClerkUserToEmployee } from "@/lib/employees/invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Clerk → SESS webhook. Called by Clerk's servers, not a signed-in user, so it
 * is listed in middleware.ts's public matcher alongside /careers.
 *
 * Register in Clerk dashboard: <your-deployment-origin>/api/webhooks/clerk
 * with the `user.created` event, and put the generated signing secret in
 * CLERK_WEBHOOK_SECRET.
 *
 * On user.created: match the new account to an Employee by email and create
 * the User row (clerkId, role, employeeId) — closing the gap the Phase 8
 * audit flagged. Signature verification is the trust boundary here; without
 * it anyone could forge a user-creation event and mint themselves a link.
 *
 * Contract with Clerk: 400 ONLY for a bad signature, 200 for every handled
 * event including no-ops (uninvited signups are legitimate, e.g. unrelated
 * career-page visitors), 503 only for genuine DB faults so Clerk redelivers.
 * Nothing here ever throws out of the handler.
 */

function coerceRole(value: unknown): Role | null {
  if (
    value === "EMPLOYEE" ||
    value === "MANAGER" ||
    value === "HR" ||
    value === "SUPER_ADMIN"
  ) {
    return value;
  }
  return null;
}

export async function POST(req: NextRequest) {
  let evt: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    evt = await verifyWebhook(req, { signingSecret: process.env.CLERK_WEBHOOK_SECRET });
  } catch {
    return NextResponse.json(
      { error: "Webhook signature verification failed", code: "BAD_SIGNATURE" },
      { status: 400 },
    );
  }

  try {
    if (evt.type !== "user.created") {
      return NextResponse.json({ ok: true, handled: false });
    }

    const data = evt.data;
    const email =
      data.email_addresses?.find((e) => e.id === data.primary_email_address_id)
        ?.email_address ??
      data.email_addresses?.[0]?.email_address ??
      null;

    if (!email) {
      console.warn(`[webhooks/clerk] user.created ${data.id} has no email — skipped`);
      return NextResponse.json({ ok: true, handled: false });
    }

    // Role travels via the invitation's publicMetadata. A signup WITHOUT one
    // (uninvited) still gets linked if the email matches — as EMPLOYEE, the
    // least-privileged role, never anything elevated by default.
    const role = coerceRole(data.public_metadata?.role) ?? "EMPLOYEE";

    const result = await linkClerkUserToEmployee(db, { clerkId: data.id, email, role });
    if (result.linked) {
      console.log(
        `[webhooks/clerk] linked clerkId=${data.id} to employee=${result.employeeId} as ${role}`,
      );
    } else {
      // Legitimate no-op (uninvited signup, retry, already linked) — log, 200.
      console.log(`[webhooks/clerk] user.created ${data.id} not linked: ${result.reason}`);
    }
    return NextResponse.json({ ok: true, handled: true, linked: result.linked });
  } catch (err) {
    console.error("[webhooks/clerk] failed:", err);
    // Clean 503 (never a throw) — Clerk redelivers with backoff on 5xx.
    return NextResponse.json(
      { error: "Could not process the webhook event", code: "SERVER_ERROR" },
      { status: 503 },
    );
  }
}
