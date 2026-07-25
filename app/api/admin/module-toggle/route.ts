import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { MODULE_KEYS, VALIDATION_MODES } from "@/lib/system-settings";
import { withPrivilegedRoute } from "@/lib/mfa-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

/** key → what counts as a valid value. Only the three real toggles exist. */
const ALLOWED: Record<string, (v: string) => boolean> = {
  [MODULE_KEYS.idleTracking]: (v) => v === "true" || v === "false",
  [MODULE_KEYS.engagement]: (v) => v === "true" || v === "false",
  [MODULE_KEYS.attendanceValidation]: (v) => (VALIDATION_MODES as string[]).includes(v),
};

/**
 * Flip a module toggle, Super Admin only. Same SystemSetting upsert + audit
 * shape as the Phase 10 idle-threshold route.
 */
async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only a Super Admin may change module toggles", 403);

  let body: { key?: unknown; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }
  const key = typeof body.key === "string" ? body.key : "";
  const value = typeof body.value === "string" ? body.value : "";
  const validate = ALLOWED[key];
  if (!validate) return fail("BAD_INPUT", "Unknown setting key", 400);
  if (!validate(value)) return fail("BAD_INPUT", `"${value}" is not a valid value for ${key}`, 400);

  try {
    await db.$transaction(async (tx) => {
      await tx.systemSetting.upsert({
        where: { key },
        update: { value, updatedBy: userId },
        create: { key, value, updatedBy: userId },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "MODULE_TOGGLED",
          targetEntity: `${key}=${value}`,
        },
      });
    });
    return NextResponse.json({ ok: true, key, value });
  } catch (err) {
    console.error("[admin/module-toggle] failed:", err);
    return fail("SERVER_ERROR", "Could not update the setting", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
