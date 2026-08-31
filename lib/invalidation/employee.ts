import "server-only";
import { revalidateTag } from "next/cache";
import { TAG_DEPARTMENTS } from "@/lib/cache/departments";
import { TAG_SHIFTS, TAG_HOLIDAYS } from "@/lib/cache/shifts";
import { TAG_ROSTER, teamTag, employeeTag } from "@/lib/cache/employees";
import { TAG_HR_DASHBOARD, TAG_RECRUITMENT, TAG_APPRAISALS } from "@/lib/cache/dashboard";

/**
 * SESS_Caching_Strategy.docx §5 — the event → invalidation mapping for
 * employee records and org reference data.
 *
 *     WRITE → DATABASE → INVALIDATE CACHE → NEXT READ = FRESH DATA
 *
 * Every function here is called IMMEDIATELY AFTER the successful write that
 * caused it, inside the same handler and after the transaction has committed
 * — never before, because invalidating a cache the write then fails to change
 * simply refills it with the old value.
 *
 * WHY SHIFTS AND HOLIDAYS LIVE IN THIS FILE: §9 specifies four invalidation
 * modules — employee, attendance, leave, payroll — and gives shift and
 * holiday changes no home of their own, while §5's table gives them no row.
 * They are org-wide employee-facing configuration edited from the HR portal
 * alongside the roster, so they are grouped here rather than inventing a
 * fifth module the specified layout does not have. The function names say
 * what each event is, so a call site reads correctly regardless.
 *
 * These are fire-and-forget: revalidateTag() only marks entries stale, it
 * issues no query and can fail nothing that matters. A caller never awaits a
 * result from them and never branches on one.
 */

/**
 * §5 "Department changed → invalidate department cache and affected team
 * views."
 *
 * In THIS schema there is no department record to edit — `department` is a
 * String column on Employee, so the department LIST changes exactly when an
 * employee is created, imported or offboarded. That is the same set of events
 * that changes the roster, the headcount aggregates and every report's
 * employee scope, which is why one function covers all of them.
 *
 * @param employeeId        the employee written, when known.
 * @param managerEmployeeId their manager, so that manager's roster and
 *                          approval counts drop too ("affected team views").
 */
export function onEmployeeRosterChanged(opts: {
  employeeId?: string | null;
  managerEmployeeId?: string | null;
} = {}) {
  revalidateTag(TAG_DEPARTMENTS);
  revalidateTag(TAG_ROSTER);
  revalidateTag(TAG_HR_DASHBOARD);
  // NOTE: reports are deliberately absent. A roster change does change what
  // every report covers, and this function used to drop a report cache tag
  // for exactly that reason — but reports are no longer cached in any format
  // (app/api/reports/[report]/route.ts), so there is nothing to drop and the
  // next report read is fresh by construction.
  if (opts.employeeId) revalidateTag(employeeTag(opts.employeeId));
  if (opts.managerEmployeeId) revalidateTag(teamTag(opts.managerEmployeeId));
}

/**
 * An employee's own displayed profile changed (name, emergency contact) — the
 * narrow case of the above. Nothing org-wide moves, so nothing org-wide is
 * dropped.
 */
export function onEmployeeProfileChanged(employeeId: string) {
  revalidateTag(employeeTag(employeeId));
  revalidateTag(TAG_ROSTER);
}

/**
 * A shift was assigned to an employee. The shift DEFINITIONS are unchanged;
 * what changed is the roster row that prints the shift name.
 */
export function onEmployeeShiftAssigned(opts: {
  employeeId: string;
  managerEmployeeId?: string | null;
}) {
  revalidateTag(employeeTag(opts.employeeId));
  revalidateTag(TAG_ROSTER);
  if (opts.managerEmployeeId) revalidateTag(teamTag(opts.managerEmployeeId));
}

/**
 * A shift definition was created, edited, deactivated or reactivated.
 *
 * The roster goes with it: a roster row prints the shift's name and start
 * time, so renaming a shift must not leave the old name on a manager's page
 * for the rest of the shift cache's hour.
 */
export function onShiftDefinitionChanged() {
  revalidateTag(TAG_SHIFTS);
  revalidateTag(TAG_ROSTER);
}

/** A holiday was added to or removed from the calendar. */
export function onHolidayCalendarChanged() {
  revalidateTag(TAG_HOLIDAYS);
}

/**
 * §2 "Recruitment dashboard · invalidate when candidate/application change"
 * and "Candidate list · candidate change".
 *
 * Drops the two cached recruitment readers in lib/cache/dashboard.ts: the HR
 * requisition board and the PUBLIC /careers listing. Both are YELLOW (5 min),
 * and five minutes is exactly long enough for HR to open a requisition, look
 * at the board, and not see it — which is why this is event-invalidated
 * rather than left to expire.
 *
 * §9 gives no `recruitment.ts`, and §5's table gives recruitment no row, so
 * this lives here for the same reason onShiftDefinitionChanged() does: it is
 * org-wide HR-portal reference data, and inventing a fifth invalidation module
 * the specified layout does not have would be worse than one honest comment.
 */
export function onRecruitmentChanged() {
  revalidateTag(TAG_RECRUITMENT);
}

/**
 * §2 "Appraisal summaries · invalidate when appraisal changed".
 *
 * Drops getAppraisalCycleSummaries() — cycle metadata plus a score-row COUNT.
 * Fired on cycle creation, scoring, exclusion and publication, because each of
 * those changes one of the three fields that summary actually prints.
 *
 * Individual SCORES are not cached anywhere and so are not mentioned here.
 */
export function onAppraisalChanged() {
  revalidateTag(TAG_APPRAISALS);
}
