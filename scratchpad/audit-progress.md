# SESS audit — progress log

Task brief: three parts (P1 six fixes, P2 audit+fix, P3 live browser verification).
STOP + checkpoint report after each part; wait for user go-ahead.
Standing rules: no migrate dev/reset/db push --force/shadow-db/DROP/DELETE/TRUNCATE;
no git commit/push; don't "fix" deliberate design decisions (SA employeeId NULL,
SA rejected from manager actions, MFA removed, RED-tier never cached, TDS manual,
no AI in decisions, self-heal fails closed).

## Status
- Current part: 2 (user said go 2026-10-02)
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
