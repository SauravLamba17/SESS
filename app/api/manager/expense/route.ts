import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveUserId, hasAtLeastRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { notifyEmployee } from "@/lib/notify";
import { fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return fail("UNAUTHENTICATED", "Not authenticated", 401);

  // ROLE gate, IN ADDITION TO the direct-report scope check further down —
  // not instead of it. Org-chart position and role are decoupled in this
  // schema: an Employee.managerId can point at someone whose Clerk role is
  // still EMPLOYEE (a shift lead onboarded without a role bump). middleware.ts
  // deliberately does not gate /api/**, so without this an EMPLOYEE-role user
  // in a manager position could drive their reports' records through the API
  // even though the UI never offers them the page.
  if (!(await hasAtLeastRole("MANAGER")))
    return fail("FORBIDDEN", "Only a Manager or above may use this endpoint", 403);

  let body: { id?: unknown; decision?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("BAD_INPUT", "Invalid JSON body", 400);
  }

  const id = typeof body.id === "string" ? body.id : "";
  const decision = body.decision;
  if (!id || (decision !== "APPROVE" && decision !== "REJECT")) {
    return fail("BAD_INPUT", "id and decision (APPROVE|REJECT) are required", 400);
  }
  const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const action = decision === "APPROVE" ? "EXPENSE_APPROVED" : "EXPENSE_REJECTED";

  try {
    const manager = await getEmployeeByClerkId(userId);
    if (!manager)
      return fail("NO_EMPLOYEE", "No employee record linked to this account", 403);

    // Identical atomic pattern to Phase 2's leave approval: the updateMany
    // where-clause carries BOTH the authorization check (employee is this
    // manager's direct report) AND the state check (still PENDING), so a
    // concurrent second decision can never double-apply. Audit only writes
    // when exactly one row actually transitioned.
    const count = await db.$transaction(async (tx) => {
      const upd = await tx.expenseClaim.updateMany({
        where: {
          id,
          status: "PENDING",
          employee: { managerId: manager.id },
        },
        data: { status, approvedBy: userId, approvedAt: new Date() },
      });
      if (upd.count === 0) return 0;
      await tx.auditLog.create({
        data: { actorUserId: userId, action, targetEntity: id },
      });

      const claim = await tx.expenseClaim.findUnique({
        where: { id },
        select: { employeeId: true, amount: true, category: true },
      });
      if (claim) {
        await notifyEmployee(
          tx,
          claim.employeeId,
          decision === "APPROVE" ? "EXPENSE_APPROVED" : "EXPENSE_REJECTED",
          decision === "APPROVE"
            ? `Your ${claim.category.toLowerCase()} expense claim for ₹${claim.amount.toFixed(2)} was approved. It will be reimbursed with your next finalized payroll run.`
            : `Your ${claim.category.toLowerCase()} expense claim for ₹${claim.amount.toFixed(2)} was not approved. Speak to your manager if you need to discuss it.`,
        );
      }
      return upd.count;
    });

    if (count === 0) {
      // Already processed, or not this manager's report — don't assume which.
      return fail(
        "ALREADY_PROCESSED",
        "Claim is no longer pending or is not one of your direct reports",
        409,
      );
    }

    return NextResponse.json({ ok: true, id, status });
  } catch (err) {
    console.error("[manager/expense] failed:", err);
    return fail("SERVER_ERROR", "Could not process the claim", 503);
  }
}
