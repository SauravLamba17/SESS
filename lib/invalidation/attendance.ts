import "server-only";
import { revalidateTag } from "next/cache";
import { TAG_HR_DASHBOARD } from "@/lib/cache/dashboard";

/**
 * SESS_Caching_Strategy.docx §5 — "Attendance punch created/edited → write
 * attendance record → invalidate relevant attendance summary/history."
 *
 *     WRITE → DATABASE → INVALIDATE CACHE → NEXT READ = FRESH DATA
 *
 * ─── WHAT AN ATTENDANCE WRITE DOES *NOT* HAVE TO INVALIDATE ──────────────
 *
 * The employee's OWN attendance — today's row, this week's rows, the month
 * calendar — is not cached at all, so there is nothing to drop. That is
 * deliberate and it is the single most important exclusion in this layer.
 * lib/attendance/own-summary.ts#loadOwnAttendance() feeds the clock-in
 * widget's initial state, and app/api/attendance/month is the calendar behind
 * it. If either were cached for even fifteen seconds, an employee who has
 * just punched would reload and see themselves as not yet punched in, and
 * would punch again. A person must always see their own punch the instant it
 * lands; a shared cache in that path is a way to lose a punch, and this
 * codebase's first rule is that a punch is never dropped.
 *
 * REPORTS are likewise absent, and used not to be. The Attendance &
 * Punctuality preview was briefly cached and these functions dropped its tag;
 * that cache has been removed (see app/api/reports/[report]/route.ts), so
 * there is no report entry left to invalidate and the tag drops went with it.
 * Every report format now recomputes on every request. A revalidateTag() call
 * for a tag nothing carries is not harmless documentation — it reads like a
 * cache exists, which is exactly the wrong thing to leave behind.
 *
 * What IS cached and therefore dropped here: the org-wide "present today"
 * figure on the HR dashboard.
 */
export function onAttendanceRecorded() {
  // "Present Today" on the HR dashboard is a distinct-employee count over
  // today's punches — a new punch changes it.
  revalidateTag(TAG_HR_DASHBOARD);
}

/** HR corrected an existing punch. Same aggregate, same reason. */
export function onAttendanceCorrected() {
  revalidateTag(TAG_HR_DASHBOARD);
}
