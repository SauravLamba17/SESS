import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, getCurrentRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { withPrivilegedRoute } from "@/lib/mfa-guard";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Onboarding checklist: tick an item, add an item, remove an item.
 *
 * Deliberately a checklist and not a workflow engine — no dependencies between
 * tasks, no assignees, no due dates. HR wanted a list they can tick.
 */
async function POSTHandler(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);
  const role = await getCurrentRole();
  if (role !== "HR" && role !== "SUPER_ADMIN")
    return fail("FORBIDDEN", "Only HR or Super Admin may manage onboarding tasks", 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const action = typeof body.action === "string" ? body.action : "toggle";

  try {
    if (action === "add") {
      const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
      const taskName =
        typeof body.taskName === "string" ? body.taskName.trim().slice(0, 200) : "";
      if (!employeeId || !taskName)
        return fail("BAD_INPUT", "employeeId and taskName are required", 400);

      const employee = await db.employee.findUnique({
        where: { id: employeeId },
        select: { id: true },
      });
      if (!employee) return fail("NOT_FOUND", "Employee not found", 404);

      const task = await db.onboardingTask.create({ data: { employeeId, taskName } });
      return NextResponse.json({ ok: true, id: task.id });
    }

    if (action === "remove") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return fail("BAD_INPUT", "id is required", 400);
      const del = await db.onboardingTask.deleteMany({ where: { id } });
      if (del.count === 0) return fail("NOT_FOUND", "Task not found", 404);
      return NextResponse.json({ ok: true, id });
    }

    // ── toggle ──
    const id = typeof body.id === "string" ? body.id : "";
    const completed = body.completed === true;
    if (!id) return fail("BAD_INPUT", "id is required", 400);

    const upd = await db.onboardingTask.updateMany({
      where: { id },
      data: { completed, completedAt: completed ? new Date() : null },
    });
    if (upd.count === 0) return fail("NOT_FOUND", "Task not found", 404);

    return NextResponse.json({ ok: true, id, completed });
  } catch (err) {
    console.error("[hr/onboarding-task] failed:", err);
    return fail("SERVER_ERROR", "Could not update the checklist", 503);
  }
}

// MFA gate — see lib/mfa-guard.ts. Rejects only when the caller's role
// requires two-factor auth and it is not enabled; every other status this
// route returns is produced by the handler above, unchanged.
export const POST = withPrivilegedRoute(POSTHandler);
