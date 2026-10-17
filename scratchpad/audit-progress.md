# SESS audit — progress log

Task brief: three parts (P1 six fixes, P2 audit+fix, P3 live browser verification).
STOP + checkpoint report after each part; wait for user go-ahead.
Standing rules: no migrate dev/reset/db push --force/shadow-db/DROP/DELETE/TRUNCATE;
no git commit/push; don't "fix" deliberate design decisions (SA employeeId NULL,
SA rejected from manager actions, MFA removed, RED-tier never cached, TDS manual,
no AI in decisions, self-heal fails closed).

## Status
- Current part: 3 (user: P2 fixes committed+pushed+deployed, Vercel Ready; go 2026-10-03)
- Current step: P2b DONE + REPORTED (2026-10-03). WAITING for user go-ahead on Part 3.
  Final: tsc 0, build4 OK, 33 suites 1615 passed 0 failed (+compute.selfcheck 53 = 1668/34), DB snapshot identical.
  Assertions changed on purpose: phase12 88/84->52/48 (D5); manager-punch widget seed today->punchRow (M3);
  self-heal race role MANAGER->SUPER_ADMIN (D4). LEFT for separate session: failed-Clerk-sync demotion. Then tsc/build/full suite/snapshot, report, WAIT for Part 3 go-ahead.
  P2b checklist (mark [x] as done; proof check for each):
  [x] D1 invite guard (invite.ts actorRole guard + 3 routes early 403 + dropdown filter; verify-clerk-invite-link step 5)
  [-] D1 invite guard: only SA may invite SA; HR may invite HR/MGR/EMP; drop SA from both HR dropdowns
  [x] D2 finalize: lib/payroll/loan-recovery.ts recoverLoans throws LoanUnmatchedError -> 409 LOAN_UNMATCHED; verify-payroll-workflow step 5.5 (41/41)
  [-] D2 finalize: refuse when a row's loanDeduction can't be matched to an ACTIVE advance; clear error naming row; no schema
  [x] D3 offboard: OK_REGULAR_EXISTS -> offboard stands, no settlement, warning (verify-audit-fixes step 7, 69/69)
  [-] D3 offboard: refuse F&F settlement if a regular payroll row exists for that month; message -> use payroll adjustment; no schema
  [x] D4 (ensureUser NO_EMPLOYEE for non-SA; revokePendingInvitation + clerkRevokeInvitation on resend(after success)/offboard/redaction; verify-clerk-invite-link step 6, self-heal step 2b)
  [-] D4 employee-less accounts only for SA; revoke outstanding Clerk invitation on resend, offboard, redaction
  [x] D5 employedWeekdays() clipped per employee; phase12 52/48 (attendance asserts pass; HTTP parts need dev server)
  [-] D5 attendance report expected days = employees active during range; verify-phase12 88/84 -> 52/48
  [x] D6 Form16 taxableGross=gross+bonus + CA comment; pdf.tsx comment corrected; verify-audit-fixes step 8
  [-] D6 Form16 include bonus in gross + comment (confirmed taxable salary, review by a CA)
  [x] M1 OFFBOARDED_READ_ONLY (lib/data/scope.ts) guard in 7 paths; verify-redaction-robustness step 4 (48/48)
  [-] M1 block offboarded writes: leave, expenses, production, punch, shoutout, pulse, warning ack
  [x] M2 changeUserRole: interactive txn + SELECT SA rows FOR UPDATE before count/update; verify-super-admin-identity 3k-3m (44/44)
  [-] M2 last-SA demotion check atomic
  [x] M3 own-summary punchRow (route's lookup) seeds ClockInWidget on employee+manager pages; verify-night-shift step 8 (69/69)
  [-] M3 night-shift clock-in button after midnight
  [x] M4 emergencyContact removed from getEmployeeProfileBasics; page reads me.emergencyContact; caching.selfcheck §7 checks
  [-] M4 emergencyContact out of shared cache
  [x] M5 onEmployeeShiftAssigned drops TAG_SHIFTS; caching.selfcheck §5b live hit/miss
  [-] M5 TAG_SHIFTS on shift assignment
  [x] M6 13 audit actions added in-txn; verify-audit-fixes step 9 (86/86)
  [-] M6 audit logs: offer DRAFT salary edit + consent create, warning ack, appraisal exclude/compute, shift deactivate,
        requisition reopen/hold/edit, pulse close/reopen, onboarding tasks, application review notes
  LEAVE: failed-Clerk-sync demotion (separate session).
  Full ranked list: scratchpad/audit-part2-findings.md. Done so far:
  * verify-phase11 REWRITTEN (kill switch tested via real heartbeat handler in-process on a
    rolled-back interactive txn; no live write; restore-upsert removed). Run cmd now:
    node --env-file=.env --import ./scripts/alias-loader.mjs prisma/verify-phase11.ts
    RAN: 18/18 pass, LIVE row identical, full DB snapshot identical (scratchpad/snap-p2-*.json).
  * caching.selfcheck REWRITTEN to own TEST-CACHE-MGR/EMP fixtures (no real employee). RAN after build3:
    67 PASS, ALL CHECKS PASSED, snapshot incl. full real-employee rows + kill switch IDENTICAL.
  * Agents: authz DONE, identity+caching DONE, data-integrity DONE, date/aggregate DONE.
    error-handling/dead-code died twice on rate limit -> relaunched 3rd time (2026-10-03).
  * FULL SUITE RUN (2026-10-03, dev :3005): 32 suites all pass (audit-fixes 65, phase11 18, rest as P1);
    caching 67 (post-build3); + lib/payroll/compute.selfcheck.ts 53 (newly found suite). Snapshot identical.
    Totals: 33 suites = 1546 (+compute.selfcheck 53 = 1599 over 34). Baseline 1551 composition unknown;
    check call sites in caching/phase11 not reduced vs HEAD.
  * Date H1 attendance report VERIFIED; NOT fixed: verify-phase12 deliberately asserts 88/84 (Delta joined July
    counted in June). Correct clipped values = 52 expected / 48 no-punch. -> decision.
  * Date H2 Form16 omits bonus -> decision (tax content).
  * (old) NEXT: verify date-audit H1 (attendance report expectedWeekdayCount = weekdays * ALL employees incl leavers;
    lib/reports/attendance.ts ~290; verify-phase12 asserts 88 — check fixture join/off dates) and H2 (Form16 omits bonus).
  * Inline new Date(y,m,d) -> startOfDay: offboard route, lib/idle/aggregate.ts, attendance-calendar.tsx,
    lib/payroll/proration.ts (relative ../period.ts), heartbeat `day`, lib/attendance/validation.ts shiftDateFor
    (relative ../period.ts). night-shift 63/63 still passes. ROLE_RANK removed from lib/auth-types.ts.
  * FIXED H1 double offboard: offboard route employee.update -> updateMany {id, active:true}, count!==1 -> ALREADY_INACTIVE.
    verify-audit-fixes step 6 (+2 checks, real concurrent race) -> 65/65, snapshot identical.
  * VERIFIED, NOT FIXED (needs decision): CRITICAL HR can invite SUPER_ADMIN (3 routes, ROLES incl SA, both dropdowns);
    HIGH finalize silently skips loan recovery (finalize/route.ts `continue`); HIGH offboard after regular run pays month twice.

## User decisions (2026-10-02)
- Heartbeat cap 120/h APPROVED.
- Suites: option (b) — run the 24 tagged-fixture suites; SKIP verify-phase11 and
  scripts/caching.selfcheck.ts until rewritten (Part 2 HIGH items below).

## Part 1
- [x] 1 startOfDay: 4 startOfDay + 3 todayMidnight copies, all identical local-midnight -> lib/period.ts startOfDay (client-safe, no imports). Files: app/admin/page.tsx, app/hr/holidays/page.tsx, lib/engagement/today.ts, lib/attendance/own-summary.ts, components/attendance/own-attendance.tsx, app/employee/{attendance,expenses,production}/actions.ts. Left inline new Date(y,m,d) in offboard route, idle/aggregate, attendance-calendar, proration, heartbeat (P2 dup note).
- [x] 2 role-check: 8 app/api/manager/** routes hasAtLeastRole("MANAGER") -> getCurrentRole() + explicit MANAGER/HR/SUPER_ADMIN (exactly equivalent, same resolveIdentity().role). Removed now-dead hasAtLeastRole from lib/auth.ts. Updated prisma/verify-audit-fixes.ts static check (same check count). ROLE_RANK now unused (P2 dead code).
- [x] 3 heartbeat: checkRateLimit gained optional `max`; heartbeat keyed by AgentToken.id after token check; cap 120/h NOT 20 because installed agent discards on 429 and drains up to 96 buffered batches -> FLAG to user. verify-rate-limit step 8 added (4 checks).
- [x] 4 CSP: Content-Security-Policy-Report-Only in next.config.mjs; Clerk host derived from publishable key (fluent-lemur-9.clerk.accounts.dev), challenges.cloudflare.com, img.clerk.com, clerk-telemetry.com, 'unsafe-inline' script/style (Next RSC inline + theme script), fonts self-hosted by next/font (no Google domains), no Vercel analytics installed.
- [x] 5 no-store: measured on prod build :3006. Pages: dynamic already `private, no-cache, no-store, max-age=0, must-revalidate`; /careers/terms static s-maxage (public T&C, fine). API: NONE before -> `private, no-store` via next.config `/api/:path*` rule. Health + PDF routes now send 2 Cache-Control lines (all no-store). Authenticated page headers to confirm in P3 on live.
- [x] 6 min-h-dvh on account, careers layout, error, not-found, sign-in, sign-up. Built CSS has .min-h-dvh{min-height:100dvh}; print block .h-dvh,.h-screen reset intact (min-h was never in it).
- [~] checkpoint: tsc 0 errors; build OK; DB-free suites all pass:
  phase14 61, wig-fixes 56, clerk-appearance 193, dashboard-fallback 23, phase12-pdf 11,
  timezone-display 29+35, agent selfcheck 26  (= 434)
  24 DB suites (dev server :3005): ats-enh 26, ats-ret 30, audit-fixes 63, clerk-invite 30,
  demo-mode 58, engagement 27, idle 27, mgr-punch 27, night-shift 63, payroll-adj 30,
  payroll-wf 37, phase10 48, phase12 119, phase12b 56, phase13 72, punch-loc 49,
  rate-limit 39 (+4 new), recruitment 30, redaction 41, freshness 13, preview 33,
  self-heal 49, SA-identity 41, terms 17  (= 1025). TOTAL 31 suites, 1459 passed, 0 failed.
  Baseline 33/1551; skipped phase11+caching => implied 96 checks there (1551-(1459-4)).
  DB row-count snapshot (scratchpad/db-snapshot.cjs, read-only) identical before/after.
  Logs: session scratchpad suites/*.log (temp). Header measurements: headers-before/after.txt.

## Part 2 — user-mandated items (add to ranked list)
- HIGH: rewrite scripts/caching.selfcheck.ts to use its own TEST- employee + leave request
  (no real employee managerId edit). Then run it; confirm real employee unchanged.
- HIGH: rewrite verify-phase11 so it cannot affect the live IDLE_TRACKING_ENABLED row
  (txn save/restore or test logic without writing live row). If not safely possible,
  report options. Then run; confirm kill switch unchanged (currently: row ABSENT = default ON).
- Consolidate remaining inline new Date(y,m,d): offboard route:69, lib/idle/aggregate.ts:56,
  components/employee/attendance-calendar.tsx:111/114, lib/payroll/proration.ts:110, heartbeat route day.
- Remove unused ROLE_RANK (lib/auth-types.ts).

## Notes / findings (feed into Part 2)
- ROLE_RANK in lib/auth-types.ts now unused.
- app/api/attendance/punch/route.ts has its own clientIp() duplicate of lib/recruitment/rate-limit clientIp.
- heartbeat MAX_WINDOW_MINUTES comment says 15, constant is 60.
- Agent discards batch on any non-shouldPause 4xx incl. 429 (agent/src/tracker.js flush).
- verify-phase11 flips live IDLE_TRACKING kill switch temporarily -> live agents can latch stopped.
- caching.selfcheck temporarily edits a REAL employee managerId + LeaveRequest.
- Stopping a bg `npx next start` task leaves the node child holding the port; kill by port.


## Part 3 — live browser verification (https://sess-sand.vercel.app, Claude in Chrome)
Browser: Claude in Chrome NOT connected (no browsers) -> user chose built-in browser pane; user signs in themselves.
Live signed-out header checks DONE (scratchpad headers-live.txt in session temp): all good.
Rules: no irreversible actions on real data (open confirm dialogs then CANCEL); reversible actions only
on TEST- records I create, all cleaned up; no real emails/invites. One role at a time; ask user to switch.
HR pass DONE: themes x4 on /hr/payroll PASS (default restored), user menu PASS (1002lambasaurav@gmail.com).
  DONE also: /hr/pulse-surveys PASS | /community PASS (TEST- shoutout add+delete) | boundary: /admin -> /hr redirect, admin APIs 403 FORBIDDEN | HR's own /employee portal: 9/10 pages 200
  HIGH BUG FOUND+FIXED LOCALLY (NOT deployed, NOT browser-reverified): /employee/expenses 500 'u.map is not a function' —
    EXPENSE_CATEGORIES exported from "use server" app/employee/expenses/actions.ts (pre-existing since Phase 8 3c43350).
    Fix: moved to new lib/expense-categories.ts; actions.ts + components/employee/expense-form.tsx import it. tsc 0, build5 OK. Guard: verify-audit-fixes step 10 ("use server" files export only async fns) 93/93 — HEAD version would fail. Needs full suite + user deploy + live recheck.
  SIGNED-OUT DONE: landing PASS (canvas, nav links + dots scroll inner container, 6 module tabs swap panels, Explore->Modules, Enter a portal->Portals, portal cards + header Sign in open Clerk modal, close works); /careers PASS (no open positions); /careers/terms 200; bad job id 404; empty apply 400 BAD_INPUT.
  USER DECISIONS 2026-10-03: APPLY Form16-list fix + appraisal period validation fix. SKIP TEST- requisitions/shifts/surveys (verify to confirm, then cancel).
  FIXES DONE LOCALLY (not deployed): Form16 picker = employees w/ FINALIZED payroll in FY of viewed period (+empty-state hint) in app/hr/payroll/page.tsx; appraisal cycle route rejects periods resolvePeriodRange can't parse. verify-audit-fixes step 11 (+9) -> 102/102, snapshot identical.
  MANAGER PASS DONE: / -> /manager PASS | dashboard PASS (0 reports; clock-in dialog opened, Confirm disabled w/o comment, CANCELLED, no punch) | all 13 sidebar pages 200 + no console errors | reports: 6 visible = 6 allowed (team/department/self), 4 forbidden 403 | warnings + client-mail validation (no request; pre-hydration click reloads page LOW) | boundary: /hr,/admin redirect to /manager; HR/admin APIs 403; IDOR target on non-report -> 403 NOT_DIRECT_REPORT; search scoped | themes x4 PASS | user menu PASS | own /employee reachable; /employee/expenses 500 (same bug, fixed locally); no nav link to own portal (same as HR).
  FINAL (2026-10-03): tsc 0, build6 OK, 33 suites 1631 passed 0 failed (+compute 53), suite snapshot identical.
  vs pre-Part-3 DB: +1 RateLimitAttempt (careers probe, auto-swept 24h), +2 AuditLog (HOLIDAY_ADDED/REMOVED for TEST- holiday; append-only by design). Nothing else.
  PART 3 REPORTED. User deployed the 3 fixes; LIVE RECHECK DONE (2026-10-03):
    /employee/expenses 200 as Manager, 5 categories render, no console error, empty-submit validation, no request.
    /hr/payroll Form16: hint 'No finalized payroll in FY 2026-27 yet', list empty (0 finalized payroll in DB = correct), FY follows period (2026-02 -> 2025-26, 2026-04 -> 2026-27).
    /hr/appraisal: 'TEST-not-a-period' -> POST 400 + message shown, no cycle created; DB snapshot identical (AppraisalCycle 0).
  ALL THREE PARTS COMPLETE.

## Follow-up batch (user 2026-10-03) — standing rules apply, NO commit/push
  [x] F1 (role-select proposed+Confirm/Cancel) role dropdown confirm step (components/admin/role-select.tsx)
  [x] F2 (computeAttendance asOf cap; phase12 +3) attendance report: clip expected days to today when range includes future
  [x] F3 (CROSS_PORTAL SELF_SERVICE_NAV hr+manager; back link in employee portal; SA excluded) sidebar link for HR + Manager to own employee pages (clock-in, payslips, profile, expenses)
  [x] F4 (shift assign propose+Confirm; deactivate confirm) confirm before roster shift assignment change + before shift deactivate
  [x] F5 (buildAuditQuery rangeError; page shows it; phase10 +3) audit log reversed date range -> clear error
  [x] F6 (61/61 pages export metadata) per-page <title> on every page
  SKIP: pre-hydration forms, Clerk dev instance.
  Checks: verify-audit-fixes step 12 (+10) -> 112/112. FINAL: tsc 0, build7 OK, 33 suites 1647 passed 0 failed (+compute 53), snapshot identical. REPORTED. Not committed. UI confirm steps need a live browser check after user deploys.
  LIVE RECHECK (user deployed): HR sidebar 4 links PASS (all land, 'HR Portal' back link) | roster shift assign: prompt 'Assign Morning Shift?' -> Cancel reverts, no POST | shift Deactivate: prompt -> Cancel, no POST, both still active | titles: 45 HR-reachable + sign-in/up + careers + landing all PASS. SA: role-change prompt 'Change role from Manager to Employee? ...' -> Cancel reverted, NO /api/admin/user-role request, reload shows roles unchanged | 10 admin titles PASS | SA in HR portal: no self-service links (by design). DB identical. FOLLOW-UP BATCH FULLY VERIFIED LIVE.
  Then: check per fix, tsc, build, full suite, before/after snapshots, report. -> Manager pass -> final tsc/build/suite/snapshot -> report. -> Manager pass -> signed-out landing + /careers ->
    apply fix candidates (Form16 list, appraisal period validation) only if user agrees -> final tsc/build/suite/snapshot -> Part 3 report.
HR pass detail: / -> /hr PASS | /hr PASS | /hr/employees PASS (D1 live HR: roles Emp/Mgr/HR; API HR->SA 403 FORBIDDEN_ROLE) | retention-review PASS | /hr/requisitions PASS (client validation, no request) | /hr/candidates PASS | candidates retention PASS | /hr/onboarding PASS | /hr/shifts PASS (edit prefill ok; deactivate no-confirm LOW) | /hr/attendance PASS (filters, reversed msg) | /hr/salary-structure PASS (not exercised) | /hr/payroll PASS w/ BUG (Form16 list) | /hr/appraisal PASS (period validation gap, not probed) | /hr/warnings PASS | /hr/reports PASS (10, all 200) | /hr/compliance PASS (validation, no request) | /hr/idle-tracking PASS | /hr/holidays PASS (TEST- add+remove)
Roles: SA lsaurav.1702@gmail.com (DONE) -> HR 1002lambasaurav@gmail.com (NEXT — waiting for user to switch) -> Manager saurav@simplenbilling.co.in
### TEST- records created (must be cleaned up)
- (side effect) 1 RateLimitAttempt row for my IP from an empty /api/careers/apply probe (400, nothing else written); auto-swept by app after 24h
- Holiday 'TEST-Audit Holiday' 2099-12-31 (HR, /hr/holidays) — CREATED (POST 200, shown 'Thu, Dec 31, 2099') then REMOVED (POST 200); reload shows Upcoming · 0 — CLEANED UP
- ShoutOut 'TEST- audit check — deleting immediately' from HR to Manager (/community) — CREATED (POST 200, Wall·1) then DELETED via 'Delete my shout-out' (POST 200); reload shows Wall · 0 — CLEANED UP
### Pages tested
SA DONE (2026-10-03): /admin/modules PASS (toggles present, NOT flipped — live config) | /admin/integrations PASS | /admin/audit-log PASS (filters action/actor/date, print wired, Clear) | /community PASS (no-employee notice) | /pulse PASS | /hr/employees PASS (D1 live: invite roles Emp/Mgr/HR; Offboard confirm opened + CANCELLED, no request sent) | /hr PASS | search PASS | /employee,/manager graceful for employee-less SA | /account PASS | user menu PASS | signed-in Cache-Control confirmed live (pages private no-store; API private no-store) | boundary: SA -> /api/manager/leave,target 403 NO_EMPLOYEE (intentional)
SA: /admin/organization PASS | /admin/payroll PASS (0 queued; finalize btn n/a) | /admin/offers PASS (0 awaiting) | /admin/appraisal-formula PASS (live validation: sev auto-balance, 110% disables Save; NOT saved, reload confirmed unchanged) | /admin/reports PASS (all 10 json/pdf/csv 200 no-store via in-page fetch; reversed range 400 REVERSED; D5 live: expected=44)
SA: /admin PASS (themes x4 PASS, / -> /admin redirect PASS, counts consistent) | /admin/roles PASS (dropdowns not exercised)
### Issues
- MEDIUM /admin/roles role <select> saves on change, no confirm (components/admin/role-select.tsx:59) — decision
- MEDIUM Attendance report counts FUTURE weekdays of current range as expected/no-punch (Oct default: 44 no-punch, only 4 elapsed) — decision (clip to today?)
- LOW /hr/employees roster shift <select> saves on change, no confirm (components/shifts/shift-assign-select.tsx)
- LOW audit-log reversed date range silently returns 0 rows (reports page rejects with REVERSED)
- INFO/DECISION live site runs on a Clerk DEVELOPMENT instance (pk_test, 'Development mode' badge in Clerk UI)
- MEDIUM (known A1) /api/attendance/punch error bodies lack `code` — confirmed live
- HIGH BUG /employee/expenses crashes (see status) — FIXED LOCALLY
- MEDIUM UX HR has no nav link to own employee portal (SA sidebar has 'Other portals'; HR/employee sidebars don't)
- MEDIUM BUG /hr/payroll Form 16 employee <select> built from CURRENT MONTH rows (app/hr/payroll/page.tsx ~426, disabled={rows.length===0}) -> empty/disabled when month has no run; leavers unselectable. FIX CANDIDATE (safe, contained)
- LOW /hr/shifts Deactivate acts on click, no confirm (components/hr/shift-deactivate-button.tsx)
- UX HR account (also EMP-0002) has no sidebar link to its own employee portal (payslips/attendance) — verify
- QUESTION: TEST- requisitions/shifts cannot be deleted (only closed/deactivated) — ask user before creating
- LOW /api/hr/appraisal/cycle accepts any non-empty period (UI says YYYY-MM or YYYY-Qn) -> uncomputable cycle. FIX CANDIDATE
- LOW forms clicked before hydration do a native submit/reload (seen on /manager/warnings first click)
- LOW 56/61 pages lack own <title> (generic 'SESS — Simplen Employee Self-Service')

## LOAD TEST task (user 2026-10-14) — separate disposable Supabase DB ONLY
Rules: only .env.loadtest (never .env/.env.local/Vercel env); compare refs before ANY db cmd (STOP if match);
no load on sess-sand.vercel.app; local `npm run build` + `npm start` against test DB; migrate deploy only;
no commit/push; scripts under scripts/loadtest/; .env.loadtest gitignored (already covered by `.env*`).
- 2026-10-14: STOPPED at gate — .env.loadtest does not exist. Live .env ref = ukjzcsvjbvlrhpmjwzfo.
  No DB command run. Asked user to create .env.loadtest (DATABASE_URL txn 6543 pgbouncer, DATABASE_URL_SESSION 5432,
  Clerk keys, NEXT_PUBLIC_APP_URL=http://localhost:3005, ATTENDANCE_VALIDATION_MODE=NONE) + decide load tool.
- 2026-10-15: GATE PASSED. TEST ref dapvajclqsoaxcivlkwv (aws-0-ap-southeast-2 :6543 pgbouncer cl=1 / :5432 cl=5),
  LIVE ref ukjzcsvjbvlrhpmjwzfo — differ. Clerk keys present (pk_test/sk_test). Remaining "<PLACEHOLDER>" is in a comment.
  PLAN: isolated copy at <session scratchpad>/lt-app (no .env* files; node_modules junction) so next/prisma can't
  auto-load .env/.env.local; env injected from .env.loadtest only; every script hard-refuses live ref.
- STEP 1 DONE: isolated copy lt-app (0 .env files, node_modules junction); scripts/loadtest/lt-run.mjs guard (reads only
  .env.loadtest, refuses live ref). migrate deploy: 5 repo migrations applied OK. FINDING: migrations-only DB drifts from
  schema.prisma (Application.termsAcceptedAt/termsVersion missing; Notification FK onDelete differs) -> DR gap.
  Synced TEST DB via migration that exists ONLY in lt-app copy (20261015000000_loadtest_only_drift_sync). Drift now empty.
- STEP 2 DONE: seed.ts (lt copy) 145s, ~141k rows (Attendance 52207, Production 44033, IdleLog 20649, Payroll 2541 FINALIZED...).
  stats in session scratchpad lt-stats-seed.json.
- STEP 3 harness ready: scripts/loadtest/{hooks.mjs,register.mjs,db-proxy.ts,next-cache-stub.ts,harness.ts}. @/lib/db -> ALS proxy
  (N clients cl=1 txn pooler), next/cache passthrough (cache OFF = worst case), lib/auth import forbidden. tsc 0. Smoke OK.
  Run: LT_APP_DIR=<lt-app> node scripts/loadtest/lt-run.mjs -- node --import ./scripts/loadtest/register.mjs scripts/loadtest/harness.ts <a|b|c|d|e|f>
  Results JSON written in lt-app cwd: loadtest-results-<x>.json
- STEP 3 PAUSED (2026-10-15). Ran a (9am rush) + z diagnostics + b (5 min dashboards) on TEST DB.
  a: 74 IN p50 11.4s p95 15.1s 93.2% ok (5x P1001 at start), 74 OUT 100% p50 11.3s; 12 ALREADY = night shift ended 03:00 (correct).
  z: TCP RTT to Sydney pooler ~380ms; SELECT 1 warm = 1.9s (~5 RTT); cold connect x20 p50 4.9s.
  b: 0% success — 830 P2024 (pool timeout 10s) + 2 P1001; dashboards fan out 17 queries p50 (max 34) on connection_limit=1.
  DIAGNOSIS: geography (test DB ap-southeast-2 vs this machine ~380ms RTT) makes absolute timings meaningless.
  REAL FINDING: dashboard Promise.all fan-out x connection_limit=1 x pool_timeout 10s -> total failure if per-query >~0.6s.
  ASKED USER: recreate test project in ap-south-1 (Mumbai, same as live) & rerun; confirm Vercel function region (no pin in repo).
  Test DB now has today's (2026-10-15) attendance from scenario a. Not yet run: c, d, e, f, HTTP, Step 4.

### LOAD TEST — resumed 2026-10-16 (Sydney test ref dapvajclqsoaxcivlkwv, not recreated)
- Ref gate re-run: test=dapvajclqsoaxcivlkwv, live=ukjzcsvjbvlrhpmjwzfo (live ref only in .env.loadtest comment line 1). OK.
- .env.loadtest: pool_timeout=60 appended to both URLs (backup in session scratchpad).
- Harness: per-request round trips from Prisma query events; wrappers (BEGIN/DEALLOCATE ALL/COMMIT)=1 RT, statements=2 RT.
  Baseline: SELECT 1 = 5 RT, 1647 ms -> 329 ms/RT (TCP RTT 331-358). Est Mumbai = measured − RT×329 + RT×5.
  would-fail@10s = a Prisma call that took >10 s beyond one call's cost (pool wait).
- FINDING: pgbouncer=true makes Prisma send BEGIN; DEALLOCATE ALL; stmt; COMMIT for EVERY call = 5 RT/query (prod too).
- Added scripts/loadtest/correctness.ts (snapshot/check, read-only) and http.mjs (localhost only).
- Running: b (cl=1), b5 (cl=5). Next: snapshot, a,c,d,e,f, HTTP, check.
- DONE 2026-10-17: b(cl=1) 100%/57s, b5(cl=5) 96.1% (9 P1001)/56s — cl=5 no help, pooler server pool (~23 backends) is the ceiling.
  a 100%/100%; c1-c4 100% (no retry needed); d1/d2 100%; e P2028 at route 60s tx timeout from Sydney, retry 182s OK; f1 0% (80 P2024 @60s), f2 96.7%.
  HTTP (local build :3105): / /careers /api/health 100% <0.4s p95; /ready 100% but p50 34s (20 queued on 1 conn).
  Step 4: 16/17 pass; "orphan" fail = bulk import creates no onboarding checklist (only offer-accept does) — real behaviour, not orphan.
  Loan recovery NOT exercised: seed left 0 ACTIVE advances. lt-app copy had been incomplete (components/types) — re-synced for build.
  REPORT delivered; no app fixes applied.

### MUST-FIX batch (2026-10-17) — applied in working tree, NOT committed; test project only
1. prisma/migrations/20261017000000_catch_up_terms_and_notification_fk (idempotent; DO-block FK swap only if not SET NULL).
   Test: lt-only migration + its _prisma_migrations row removed; deploy -> status clean, diff "No difference detected".
   Rebuild proof in scratch schema lt_rebuild (dropped after): 5 migrations -> 3 gaps; +catch-up -> only the
   recipientUserId FK artifact (20260904 guard checks conname w/o schema; real fresh DB unaffected; don't edit applied migration).
2. Dashboards: lib/dashboard/{admin,manager,employee,notifications}.ts; loadToday 3->1, moduleToggleValues 3->1,
   loadOwnAttendance 3->1, getEmployeeByClerkId 2->1, HR totals 7->1 (still ORANGE), funnel YELLOW-cached (+stage route invalidates).
   Statements cache-off before->after: SA 23->8, HR 15->5, MGR 19->9, EMP 22->9; warm: 22->7, 6->2, 15->6, 21->8.
   Parity vs HEAD loaders (scripts/loadtest/before/): 22/22 identical cold and warm.
3. Vercel URL ending: ?pgbouncer=true&connection_limit=1&pool_timeout=30 (user changes it).
4. Loan recovery (scenario l): 2 advances, 2026-11 + 2026-12: deductions exact, capped final installment closes. OK.
5. b after: 533 loads (was 230), 100%, 9 q/42 RT (was 21/90), p50 25.7s (was 56.7). f1 100% (was 0%), f2 100%. Step4 28/28.
6. tsc 0; build OK (lt-app copy, test env); DB-free 9 suites pass (wig-fixes, dashboard-fallback updated for moved code);
   DB suites on TEST: all pass except self-healing-identity 47/52 + super-admin-identity 42/44 (assert LIVE accounts).
   recruitment-pipeline needed lt-app-only tx timeout (Sydney). manager-punch source check updated.
