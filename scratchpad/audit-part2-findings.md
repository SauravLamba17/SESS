# SESS Part 2 audit — ranked findings (2026-10-03)

Legend: ✔ = verified by the lead by reading the code; (a) = reported by an area agent with quoted
code, not independently re-read. FIXED = changed in the working tree. DECIDE = needs the user.

## CRITICAL
| # | Finding | Where | Status |
|---|---|---|---|
| C1 ✔ | HR can mint a SUPER_ADMIN: invite role accepted from request body against `ROLES` (includes SUPER_ADMIN) and written to the Clerk invitation `publicMetadata.role`; both HR dropdowns offer it | app/api/hr/employee/invite/route.ts:33, app/api/hr/employee/route.ts:45, app/api/hr/offer/status/route.ts:281 → lib/employees/invite.ts sendEmployeeInvitation; components/hr/invite-button.tsx:83, onboard-form.tsx:135 | DECIDE (also: may HR invite HR?) Fix ready: one guard in sendEmployeeInvitation taking actorRole + filter dropdowns |

## HIGH
| # | Finding | Where | Status |
|---|---|---|---|
| H1 ✔ | Double offboard → two Full & Final settlements (active check was a read; update keyed on id) | app/api/hr/employee/offboard/route.ts | FIXED: updateMany {id, active:true}; verify-audit-fixes step 6 (real concurrent race, 1 of 2 wins) |
| H2 ✔ | Finalize silently `continue`s when no ACTIVE advance can absorb loanDeduction → payslip deducts money the ledger never records | app/api/admin/payroll/finalize/route.ts:~105,~115 | DECIDE: refuse finalize (blocks SA) vs store advanceId on Payroll (schema) |
| H3 ✔ | Offboard after a regular run creates a settlement for the same month → month paid twice | offboard/route.ts settlement block | DECIDE: refuse/flag vs widen partial unique index (schema) |
| H4 ✔ | Stale/typo Clerk invitation → self-heal creates an employee-less User with ANY role (MANAGER/HR) | lib/employees/invite.ts ensureUserForClerkIdentity NO_EMPLOYEE_MATCH branch | DECIDE: allow employee-less only for SUPER_ADMIN; revoke invitations on resend/offboard/redact |
| H5 ✔ | Attendance report "expected/no-punch" = weekdays × ALL employees incl. leavers and future joiners | lib/reports/attendance.ts:~290 (+ scope.ts unfiltered) | DECIDE: verify-phase12 deliberately asserts 88/84; correct clipped June values are 52/48 |
| H6 (a) | Form 16 gross omits bonus (bonus is taxable salary) | app/api/form16/route.ts:78-98 | DECIDE (tax content) |
| H7 | caching.selfcheck edited a real employee | scripts/caching.selfcheck.ts | FIXED: own TEST-CACHE-MGR/EMP fixtures; 67 pass; real rows identical |
| H8 | verify-phase11 flipped the live kill switch | prisma/verify-phase11.ts | FIXED: real handler in-process on rolled-back txn; 18 pass; live row identical |

## MEDIUM (reported, not fixed)
- (a) Offboarded employees can still write: leave, expense, production actions; punch; shoutout; pulse; warning acknowledge (only updateProfile checks `active`). Behaviour change → DECIDE.
- (a) Manager leave/expense approvals don't require `employee.active` (pages do).
- (a) Clerk webhook defaults a missing role to EMPLOYEE (`?? "EMPLOYEE"`); role-less sessions can still hit payslip/punch/form16/month APIs.
- (a) Role change writes DB then Clerk; guards read Clerk → a demotion whose Clerk sync fails leaves the old power in effect.
- (a) Last-SUPER_ADMIN guard counts outside the transaction → two concurrent demotions can leave zero.
- (a) emergencyContact (third-party personal data) cached in shared Data Cache labelled ORANGE; redaction only marks stale.
- ✔ Shift "assigned" counts not invalidated on shift assignment (onEmployeeShiftAssigned lacks TAG_SHIFTS) → HR can deactivate a shift without the assigned warning for up to 1h. One-line fix ready.
- (a) Claim stamping ignores updateMany count (run + offboard) → a claim could be reimbursed twice under a race.
- (a) Global AppraisalFormula: @@unique([department]) doesn't stop duplicate NULLs (schema).
- (a) "One ACTIVE advance" is find-then-create (needs partial unique index — schema).
- (a) HR attendance correction can overwrite a concurrent real punch-out; night-shift after-midnight correction lands 24h early.
- (a) Offer accept sets HIRED without guarding application stage.
- (a) Appraisal publish checks completeness outside the cycle lock; feedback after compute leaves finalScore stale.
- (a) Clock-in widget shows "Clock in" to a night-shift worker after midnight (route treats it as check-out).
- (a) Heartbeat windowEnd unbounded (any day writable) and night-shift minutes split across two IdleLog days.
- (a) Payroll run includes employees who joined after the period (zero-pay draft, advance deducted).
- (a) Offboard accepts a future last working day but deactivates immediately (headcount cards disagree for weeks).
- (a) Idle-consent dashboard card counts expired consents and leavers.
- (a) attendance/punch and attendance/month non-2xx bodies lack `code` (additive fix).
- (a) hr/application/feedback and resume/[applicationId]: canAccessApplication DB lookup outside try → default 500 shape on DB outage.
- (a) Offer DRAFT salary edit has no AuditLog and approval doesn't bind to reviewed figures; several state changes unaudited (consent, acknowledge, requisition reopen, survey close, shift deactivate…).
- (a) clientIp in punch route vs lib differ in 3 ways — do NOT merge.

## LOW
- (a) HR can correct own attendance / own salary structure / own appraisal exclusion.
- (a) Employee can rename themselves, weakening warning-letter name attestation.
- (a) Payslip 404 vs 403 reveals id existence (cuids → negligible).
- (a) Impersonation token has no expiry (only while DEMO_MODE on).
- (a) Failed invite link still overwrites Employee.email.
- (a) TTL-bounded missed invalidations: warnings/consent → HR dashboard (30s); candidate retention → recruitment (5m); manager feedback → appraisals (5m).
- (a) Redaction/extend and profile-save vs redaction decided from an earlier read.
- (a) Races: two open adjustments; salary history duplicate versions; duplicate open attendance rows on double-tap; advance left ACTIVE at 0; candidate delete re-check.
- (a) Unhandled P2002 → 503 instead of 409 (shift name, formula, employeeCode on hire, bulk import, first salary upsert).
- (a) A new offer can't be raised after withdrawal (Offer.applicationId @unique) though the UI says to.
- (a) Float sums in display-only money (payslips page, HR/admin payroll pages, row editor preview).
- (a) Calendar joining-date cutoff in browser TZ; attendance/month missing `year` → 1900.
- ✔ Admin "on leave today" uses `lte: tomorrow` (includes tomorrow's leave).
- (a) HR "Present today" shows fabricated 0% at zero headcount; present count not limited to active.
- ✔ "Open warning letters" counts DRAFTs (double-counted with pending release).
- ✔ app/hr/pulse-surveys/page.tsx:151 `toISOString().slice(0,10)` (day early for 00:00–05:30 IST).
- ✔ lib/reports/pdf-layout.tsx:110 PDF "generated" stamp printed in UTC.
- (a) Webhook logs the email of every uninvited sign-up.
- (a) Stale comments: heartbeat MAX_WINDOW_MINUTES "15" vs 60; lib/api/response.ts "one deliberate exception".
- (a) Duplication (equivalent, optional): ymd-or-dash ×4, money() ×2, fmtDate ×4; ~15 needless `export`s.

## Verified correct (by area)
- Authz: no IDOR — every id is constrained in the WHERE or checked against the caller's own employee; manager pages only show direct reports; downloads scoped; search role-scoped; webhook signature verified.
- Integrity: payroll submit/edit/finalize transition, warnings, offers, leave/expense decisions, application stage, appraisal FOR UPDATE lock, careers apply, heartbeat upsert; notifications inside the state-change txn; server money math is string→Decimal, half-up once.
- Identity: exactly two User create sites (invite.ts:280, :417) reached from three entry points (webhook, self-heal, HR invite existing-account branch); clerkId/employeeId @unique; self-heal fails closed on null role; impersonation SA-only, non-nesting, cookie-bound, DEMO_MODE-gated.
- Caching: nothing RED cached except the emergencyContact point; no key mixes users; map of cache→invalidation verified.
- Errors: no stack/Prisma/connection-string leaks; error.tsx renders digest only; MFA fully gone (comments only).
