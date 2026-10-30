# SESS fix batch — report (28–29 Oct 2026)

Status: **resume fix pushed and verified on live** (commit 4f6f762). **Everything else is uncommitted**, tested on the local dev server against the live database. Waiting for "push".

## A. Before → After

| # | Bug | Before (what the user saw) | After (what the user sees now) | How it was proven | Files changed |
|---|---|---|---|---|---|
| 1 | Careers application fails (critical) | Every application → "We could not submit your application right now" (503); resume saved to Vercel's read-only disk | Resume stored in a private Supabase bucket; "Application received" | Live: TEST Candidate Three applied on sess-sand.vercel.app → HR opened resume 200, 411 B PDF, correct text; public URL and key-less read → 400. Round-trip script passed | lib/recruitment/storage.ts, prisma/verify-terms-acceptance.ts, .env.example (pushed) |
| 2 | Production report target 0 (medium) | One's October target 0, achievement "—", while dashboard/appraisal said 42/55 | Report and My Data use the monthly target; whole months only (appraisal rule); part-month ranges show N/A with a note in PDF and CSV | Real data (localhost): Oct 1–31 → 52 / 55 = 94.5 %, variance −3 (dashboard shows 95 %); Oct 1–27 → target/achievement/variance "N/A" + note; PDF 200. Suite: 11 new pure checks | lib/reports/production.ts, range.ts, run.tsx, my-data.ts, csv.ts, pdf/production.tsx, pdf/my-data.tsx |
| 3 | Exclude never unblocked Publish (medium) | After Exclude the person stayed "incomplete" and Publish stayed disabled; score count stale until reload; Exclude list vanished on reload | One shared "can publish" rule for page and API; excluded people listed as "Excluded" with "Include"; count refreshes immediately; lists reload from saved scores | Real data (localhost, TEST QA 2026-Q4): 1/4 complete → exclude 3 → Publish enabled → reload keeps lists → Include one → disabled → Exclude → Publish from the page. DB: One scored 94.0, 3 excluded with no score, only One notified; audit shows every step. Suite: 14 new checks in verify-phase14 | lib/appraisal/publish-rule.ts (new), app/api/hr/appraisal/compute/route.ts, publish/route.ts, components/hr/cycle-actions.tsx |
| L1 | Correcting clock-out dropped clock-in seconds | 18:53:06 became 18:53:00 | Unchanged times keep their exact value | Real data: One's 18 Oct row, clock-out-only correction → check-in still 06:29:57.447, check-out 06:45:00 | app/api/hr/attendance/correct/route.ts |
| L2 | Expired pulse survey shown "Open" | "Open" + Close button after 19 Oct | "Closed", "closed 2026-10-19", no button | Screen check (HR pulse page) | app/hr/pulse-surveys/page.tsx |
| L3 | Technical help text on shifts/retention/idle/employees (+ appraisal, integrations, formula, board summary) | "lateFlag", "hard-deleted", "orphaned", "soft-delete", "snapshotted formula", raw field names, "/api/webhooks/clerk", "CLERK_WEBHOOK_SECRET not set", "configured (department)", "FINALIZED only", "INR 63650.50" | Plain English; retention shows "emergency contact, date of birth…"; formula shows "Using the company-wide weights"; board "INR 63,650.50 (finalised payroll only)" | Screen checks on every page + source checks in verify-fix-batch | app/hr/shifts, employees, idle-tracking, appraisal, retention-review pages; components/hr/shift-deactivate-button, agent-token-manager, employee-retention-actions; components/admin/appraisal-formula-form; app/admin/integrations; lib/employees/retention.ts; lib/reports/board-summary.ts; app/api/hr/agent-token |
| L4 | Raw code "IDLE_TRACKING" | "Active IDLE_TRACKING consent" | "Active idle-tracking consent" (also in the token messages) | Screen check | app/hr/idle-tracking/page.tsx, components/hr/agent-token-manager.tsx, app/api/hr/agent-token/route.ts |
| L5 | No read-only banner for offboarded staff | Forms only failed on submit | Banner "Your employment record is closed, so SESS is read-only…" on every employee page, community and pulse | Real data: signed in as Two → banner on /employee, /employee/attendance, /community, /pulse; no console errors | components/employee/offboarded-banner.tsx (new), app/employee/layout.tsx, app/community/layout.tsx, app/pulse/layout.tsx |
| L6 | Job stays Open after all openings filled | TEST job open after its 1 opening was hired | Hiring the last opening closes the job in the same transaction, with an audit row | Source check only (see D) | app/api/hr/offer/status/route.ts |
| L7 | Future joining date shown as "joined" | "joined 2026-11-02" | "joins 2026-11-02"; future joiners no longer counted in active headcount, Who's In Today, HR active count or shout-out list | Screen: onboarding "joins 2026-11-02"; admin "Active employees 5"; headcount report total 5 (was 6) | app/hr/onboarding/page.tsx, lib/reports/headcount.ts, lib/engagement/today.ts, lib/cache/dashboard.ts, app/community/page.tsx |
| L8 | Offer accept form stays after hire | Attestation form remained on screen | Form closes once the response is recorded | Source check (no new hire, see D) | components/hr/offer-panel.tsx |
| L9 | Raw account IDs | My Quality "Reviewed by user_3Hp…"; roles page and audit log IDs; audit in UTC | "Manager"; names on roles page (ID on hover); audit log names + "Time (IST)" | Screen: My Quality "Manager"; roles "Super Admin account", "TEST Employee One"…; audit "2026-10-29 07:47:33 … Super Admin account" | lib/data/names.ts (new), app/employee/quality, app/admin/roles, app/admin/audit-log |
| L10 | Appraisal "(w20)", "Warning penalty (0 × 0.00)" | Technical labels | "(20% of your score)", "Warning letters (none)" / "(1 on record)", "no deduction" | Screen (One's appraisal page, both cycles) | app/employee/appraisal/page.tsx |
| L11 | Clock-in validation wording | "IP validation enabled but ALLOWED_IPS is not configured; … OFFICE_LAT/…" (twice) | "Office network check is on, but no office network has been set up yet; Office location check is on, but the office location hasn't been set up yet" — each once; old stored rows shown the same way | Screen (manager + HR attendance); pure checks on validatePunch and the display mapper | lib/attendance/validation.ts, app/api/attendance/punch/route.ts, app/hr/attendance, app/manager/attendance |
| L12a | Offboarded report's late punch shows "—" | "—" for Two | "TEST Employee Two (left)" | Screen (manager attendance) | app/manager/attendance/page.tsx |
| L12b | Units/hr 11013.18 for 14-second punches | Meaningless rate | "—" under 15 minutes | Pure check | lib/time-efficiency.ts |
| L12c | Warning "Release" one click | Released immediately | "Confirm release" step with a plain warning | Source check | components/hr/release-button.tsx |
| L12d | Careers terms tab title | "Terms & Conditions — SESS Careers · SESS" | "Careers Terms & Conditions · SESS" | Screen (tab title) | app/careers/terms/page.tsx |
| N1 | Landing "Sign in" while signed in (new) | No-op, Clerk "cannot_render_single_session_enabled" | Button opens your portal ("Open my portal") | Source + behaviour of N2 | components/landing/sign-in-or-portal.tsx (new), cinematic-landing.tsx |
| N2 | 10–15 s "not logged in" after signing in from the landing page (new) | Marketing page with "Sign in" stayed on screen until the server redirect landed | "Signed in. Opening your portal…" screen, straight to the portal | You saw the screen when signing in as One; back-navigation as Manager went straight to /manager. Warm redirect measured ~0.4 s (the 10–15 s was the dev server compiling) | components/landing/signed-in-redirect.tsx (new), cinematic-landing.tsx |
| N3 | Hydration error "18 Oct 2026" vs "Oct 18, 2026" (new) | Red runtime error on the employee dashboard; dates formatted differently locally and on live | One pinned formatter: dates "18 Oct 2026", times "07:58 PM", numbers en-IN, all in IST | Reload as Two: no hydration errors; suite scans the code for any unpinned toLocale*String | lib/time-display.ts + 12 pages/components (notification panel, attendance calendar, clock-in widget, week strip, community, expenses, profile, holidays, manager pages, agent token, report preview, audit count) |

## B. Test results (all on the current working tree)

| Check | Result |
|---|---|
| tsc | pass |
| Production build (scratch copy) | pass — compiled, lint + types OK, middleware 79.5 kB |
| verify-phase14 (+14 new publish-rule checks) | 75 / 75 |
| verify-wig-fixes | 56 / 56 |
| verify-clerk-appearance | 193 / 193 |
| verify-employee-dashboard-fallback | 23 / 23 |
| verify-phase12-pdf (+1 partial-month production fixture) | 13 / 13 |
| verify-phase12 --pure (new DB-free mode) | 11 / 11 |
| verify-timezone-display | 29 + 35 |
| agent selfcheck | 26 / 26 |
| payroll compute selfcheck | all passed |
| caching selfcheck | all passed |
| verify-report-preview | 33 / 33 |
| verify-fix-batch (new) | 52 / 52 |

Suites whose expectations changed: **verify-phase12** (production now uses MonthlyTarget; board payroll headline now `INR ${inr(...)}`; new `--pure` mode), **verify-phase12-pdf** (production fixture has `targetsApply`, new N/A fixture, My Data production row has no `targetUnits`), **verify-phase12b** (MyDataInput gained `productionTarget`), **verify-phase14** (new section 9). DB-writing suites (verify-phase12 full, phase12b, terms-acceptance, etc.) were **not** run — they write to the database the dev server uses, which is live.

## C. Live checks done

- **Resume upload (live, after push):** TEST Candidate Three applied on https://sess-sand.vercel.app → "Application received" → HR opened the resume: 200, application/pdf, 411 bytes, correct marker text, `private, no-store`. Public URL 400, key-less read 400. TEST job reopened for the test and closed again (not on /careers).
- **Bug 2 numbers (localhost, live DB):** One October 52 / 55 = 94.5 % (dashboard 95 %); Oct 1–27 N/A in CSV + PDF.
- **Bug 3 publish flow (localhost, live DB):** TEST QA 2026-Q4 — exclude → enabled, include → disabled, exclude → publish; One 94.0, three excluded with no score, only One notified.
- Regression on live for the Phase 2–3 fixes happens **after** "push".

## D. Not fixed / limits

- **Job auto-close (L6) and accept-form closing (L8)** are proven by code checks only. A live proof needs another hire, which would create another real-series employee code (EMP-0005). Say if you want that run.
- **Time inputs not accepting typing** in the correction form: only seen with the browser automation; real keyboard input wasn't reproducible as an app bug. Not changed.
- **EMP-0004 numbering:** hire conversion always uses the EMP- series; not a bug. Cleanup decision for you.
- **Stored old validation text** is shown in the new wording but not rewritten in the database (by design: no data edits).
- **Report preview** (on-screen) shows "—" for an N/A target and "Targets Apply: No"; the PDF and CSV say "N/A" as requested.
- **Idle-tracking "consented 0 / 6"** still counts the future joiner (its own count; minor, not in scope).
- **Manager dashboard "late marks"** still counts the offboarded report's October late punches — they happened while on the team; the list now names them "(left)".

## E. TEST records created in this batch (add to the earlier cleanup list)

| Record | ID / detail |
|---|---|
| Supabase Storage bucket | `resumes` (private, PDF only, 5 MB) on ukjzcsvjbvlrhpmjwzfo |
| TEST Candidate Two (localhost test) | candidate cmvs5t1f70002wgakujod9vg0, application cmvs5t1hc0004wgak7zgdcfvi, resume file ca4ff995-9d14-4b84-bd41-850cbb25c8c4.pdf |
| TEST Candidate Three (live test) | candidate cmvs6repc0002kz088n8bjflj, application cmvs6repk0004kz0803vkinsw, resume file a5050317-aab5-4375-8417-2902c85874de.pdf |
| TEST requisition | cmvqrt73f0004jq08bcinyptg reopened/closed twice (audit rows); now CLOSED, 3 applications |
| Appraisal cycle | 2026-Q4 TEST QA cmvswu9sl0000wgx0s92s9d8i (published) + 4 score rows (One 94.0; Import One, Import Two, Candidate One excluded) + APPRAISAL_PUBLISHED notification to One |
| Attendance correction | One's 18 Oct row cmvd4bx5p0001kw07cdl6xh5h: check-out 06:30:11 → 06:45:00 (audit row, reason "TEST QA fix-batch check: clock-out only") |
| Audit rows | all actions above (append-only) |

## F. Risks after the push

- **Dates change format on live** from "Oct 18, 2026" to "18 Oct 2026" everywhere (intentional, consistent with British/Indian copy). Clock times stay "07:58 PM".
- **Active headcount drops for anyone with a future joining date** (dashboards, Who's In Today, headcount report, board summary, shout-out list). Correct, but numbers change.
- **Production report numbers change** for every real employee: targets now come from the monthly target, and part-month ranges show N/A instead of 0.
- **Publish API now refuses an empty department** (`EMPTY_SCOPE`), which it used to allow.
- **Offer acceptance can now close a job automatically** when the last opening is filled (audit row records it).
- **One extra small database query** per employee/community/pulse page (the offboarded banner check).
- **Landing redirect** reads the role from Clerk metadata, the same source the server uses; an account with no role is unchanged.
- No schema changes, no migrations, no data rewrites; the formula and module toggles were not touched.
