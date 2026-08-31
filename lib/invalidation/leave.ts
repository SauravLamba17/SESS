import "server-only";
import { revalidateTag } from "next/cache";
import { approvalsTag, TAG_MANAGER_DASHBOARD } from "@/lib/cache/dashboard";

/**
 * SESS_Caching_Strategy.docx §5 — "Employee leave approved → update leave /
 * balance → invalidate employee leave balance, manager approvals and affected
 * dashboard."
 *
 *     WRITE → DATABASE → INVALIDATE CACHE → NEXT READ = FRESH DATA
 *
 * ─── LEAVE BALANCE ───────────────────────────────────────────────────────
 *
 * §2 and §5 both name a leave BALANCE. SESS has none. LeaveRequest
 * (prisma/schema.prisma:577) is startDate / endDate / reason / status — there
 * is no entitlement, accrual or balance anywhere in the schema, no column
 * holding one and no code computing one. So there is no balance cache to
 * invalidate, and this file does not pretend there is: what actually changes
 * on a decision is the manager's PENDING APPROVALS count, which is cached
 * (lib/cache/dashboard.ts#getPendingLeaveCount) and is dropped below.
 *
 * ─── WHY THE PENDING *RECORDS* NEED NO INVALIDATION ──────────────────────
 *
 * Only the count is cached; the list of pending requests a manager acts on is
 * read fresh every time. The decision itself is made by the atomic
 * updateMany() in app/api/manager/leave/route.ts, whose where-clause re-checks
 * both `status: "PENDING"` and `employee.managerId` inside the transaction —
 * so even a stale list could not cause a second approval, it would just show
 * a row that the next click rejects with ALREADY_PROCESSED. Caching a COUNT
 * cannot affect that path at all.
 */

/** A manager approved or rejected one of their direct reports' requests. */
export function onLeaveDecided(managerEmployeeId: string) {
  revalidateTag(approvalsTag(managerEmployeeId));
  revalidateTag(TAG_MANAGER_DASHBOARD);
}

/**
 * An employee submitted a request. The count on their manager's dashboard
 * goes up, so it is dropped for that manager only.
 *
 * `managerEmployeeId` is null for an employee with no manager assigned — a
 * real case in this schema (Employee.managerId is nullable) and one where
 * nobody's approval count changed, so nothing is invalidated.
 */
export function onLeaveRequested(managerEmployeeId: string | null) {
  if (!managerEmployeeId) return;
  revalidateTag(approvalsTag(managerEmployeeId));
  revalidateTag(TAG_MANAGER_DASHBOARD);
}
