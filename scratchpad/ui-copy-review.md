# UI copy review — help text, descriptions, hints and empty states

**Status:** proposal only — nothing applied yet.
**Rules applied:** at most ~15 words, plain English, no technical terms (.env, redeploy, heartbeat, API, routes, variable names, audit codes, file names, IDs), short warnings kept, professional tone.
**How this list was built:** every visible string in the app's pages and components (330 strings of 6+ words, parsed from the source, comments excluded). The 134 that break a rule are below; the other ~196 already comply and are unchanged.
`{…}` = a value the app fills in (name, count, month). Those stay exactly as they are; only the words around them change.

---

## Super Admin

### System Dashboard (`/admin`)
| # | Where | Before | After |
|---|---|---|---|
| A1 | Action list — offer awaiting approval | Drafted by HR. An offer cannot be sent to a candidate until a Super Admin approves its figures. | Drafted by HR. It can't be sent until you approve it. |
| A2 | Headcount trend note | Measured at each month end (today for the current month), using the same employed-on-this-date rule as the Headcount report. | Measured at each month end, or today for the current month. |
| A3 | Role distribution note | Linked SESS accounts only. Employees without a login do not appear — manage on Roles & Permissions. | Only people with a login are counted. Manage accounts on Roles & Permissions. |
| A4 | Action required — all clear | No payroll awaiting finalize, no offers awaiting approval, no failed role syncs, no unclosed attendance records. | Nothing needs your attention right now. |
| A5 | System status note | Status comes from a live SELECT 1 against the database on each load — the same probe the Integrations page runs. | Checked live each time this page loads. |

### Audit Log (`/admin/audit-log`)
| # | Where | Before | After |
|---|---|---|---|
| A6 | Page description | Every governed action across the system, newest first. Append-only — entries can never be edited or deleted, by anyone, through any code path. | Every important action in the system, newest first. Entries can never be edited or deleted. |
| A7 | Footer | Paginated server-side — each page fetches only its own {…} rows from the database, never the whole table. | Shows {…} entries per page. |

### Integrations (`/admin/integrations`)
| # | Where | Before | After |
|---|---|---|---|
| A8 | Page description | Connection status only. Secrets live in .env and are never shown or editable here. | Connection status only. Passwords and keys are never shown here. |
| A9 | Note | To change any of these, edit the deployment's .env and restart — deliberately not editable from the browser, so a compromised admin session cannot exfiltrate or rotate credentials. | These settings are managed by your technical team and can't be changed here, for security. |

### Module Toggles (`/admin/modules`)
| # | Where | Before | After |
|---|---|---|---|
| A10 | Page description | Org-wide switches for the genuinely optional features. Changes apply immediately — no redeploy. | Turn optional features on or off for everyone. Changes apply immediately. |
| A11 | Idle tracking switch | When off, EVERY desktop-agent heartbeat is rejected regardless of individual consent records or tokens. Agents pause themselves on the rejection. Consent records and historical data are untouched. | When off, idle tracking stops for everyone. Consent records and past data are kept. |
| A12 | Idle threshold help | Default is 210s (3.5 minutes). Agents pick up a change on their next heartbeat — within 15 minutes, with no reinstall. Lower values are more intrusive; consider carefully before going below the default. | Default: 210 seconds. Changes apply within 15 minutes. Lower values are more intrusive. |
| A13 | Attendance validation | NONE records every punch unchecked. IP_LOCK checks the office IP allowlist, GEOFENCE checks office coordinates, BOTH checks both. A failing punch is still recorded — it is flagged for HR review, never dropped. Allowlist/coordinates still come from .env; this replaces the redeploy that changing the MODE used to need. | Choose how clock-ins are checked. A failed check is flagged for HR review, never blocked. |
| A14 | Engagement switch | When paused, /community and /pulse show a notice and new posts/responses are rejected. Nothing is deleted — everything returns when re-enabled. | When paused, the community wall and pulse surveys are hidden. Nothing is deleted. |
| A15 | Footer | Every change is written to the audit log as MODULE_TOGGLED with the setting and new value. | Every change is recorded in the audit log. |

> Optional follow-up (not in this change): the dropdown still shows the codes NONE / IP_LOCK / GEOFENCE / BOTH. I can relabel them "No checks / Office network / Office location / Network and location" without changing what is saved — say if you want it.

### Offer Approvals (`/admin/offers`)
| # | Where | Before | After |
|---|---|---|---|
| A16 | Page description | Offers drafted by HR awaiting your authorisation. HR cannot send an offer until it is approved here — and cannot approve their own. | Offers drafted by HR that need your approval. HR can't send an offer until you approve it. |
| A17 | Note | Approval authorises the terms. HR then marks the offer as sent, and records the candidate's real-world response — accepting converts them into an employee automatically. | After approval, HR sends the offer. If the candidate accepts, they become an employee automatically. |
| A18 | Approve confirmation | Approving authorises HR to send {…} an offer at ₹ {…}/month. HR still controls when it is sent. | Approving lets HR send {…} an offer at ₹{…}/month. HR decides when to send it. |

### Organization (`/admin/organization`)
| # | Where | Before | After |
|---|---|---|---|
| A19 | Departments note | Departments are free-text values on employee records (set at onboarding). Renaming or merging a department would mean reassigning every employee's record — flagged as future work, not a quick edit. | Departments are set on each employee's record. Renaming a department isn't available yet. |

### Payroll Finalization (`/admin/payroll`)
| # | Where | Before | After |
|---|---|---|---|
| A20 | Page description | Runs submitted by HR and awaiting the permanent lock. Finalizing is irreversible — afterwards no code path can alter a figure, and corrections must be issued as separate adjustment records. | Payroll submitted by HR for your approval. Finalized payroll can't be undone. |
| A21 | Draft rows note | Note: HR has {…} DRAFT payroll row{…} ({…}) that have not been submitted yet. Draft rows never appear here — HR must run "Submit run for approval" before you can finalize them. | HR has {…} draft payroll row{…} ({…}) not yet submitted. They appear here once HR submits them. |
| A22 | Footer | Finalization is all-or-nothing: if any row changes state mid-transition the whole run is rolled back rather than left half-finalized. | A run is finalized completely or not at all — never halfway. |

### Roles & Permissions (`/admin/roles`)
| # | Where | Before | After |
|---|---|---|---|
| A23 | HR role summary | Org view + consent + tokens | Organisation view, consent and desktop agent setup |
| A24 | Role change note | A role change updates the SESS database first, then the Clerk account's metadata. If the Clerk sync fails, the row shows an explicit retry — it is never left silently out of sync. Audit: USER_ROLE_CHANGED. The last Super Admin cannot be demoted. | If a role change doesn't fully apply, use Retry on that row. The last Super Admin can't be demoted. |
| A25 | Invitations note | Invitations are sent from the Employee Master page — roles here apply only once an account exists. | Invite new people from Employee Master. You can set their role here once they sign up. |
| A26 | Hierarchy note | Hierarchy: SUPER_ADMIN > HR > MANAGER > EMPLOYEE — each level can also open the portals below it. Enforced in middleware and in every API route; this table is documentation, not the enforcement. | Higher roles can also open lower portals: Super Admin > HR > Manager > Employee. |

### Appraisal Formula (`/admin/appraisal-formula`)
| # | Where | Before | After |
|---|---|---|---|
| A27 | Form note | These weights are the single source of truth. HR snapshots them at cycle creation but cannot edit them. This endpoint is role-gated to Super Admin server-side. | These weights apply to every new appraisal cycle. Only a Super Admin can change them. |
| A28 | Frequency weight help | How much of punctuality comes from HOW OFTEN someone is late. Suggested: 70. Industry HR-analytics practice generally weights how OFTEN someone is late more heavily than how late any single instance was — occasional lateness should have limited impact, while a consistent pattern is the stronger signal. 70/30 is a reasonable starting split; adjust for your context. | How much punctuality depends on how often someone is late. Suggested: 70. |
| A29 | Severity weight help | How much comes from HOW LATE they are, on the days they ARE late. Must sum to 100 with frequency weight. Suggested: 30. | How much punctuality depends on how late someone is. Both must total 100. Suggested: 30. |
| A30 | Severity cap help | Minutes-late at which the severity sub-score bottoms out at 0 (counted only on days someone was actually late). Suggested: 60. A common reference point: many attendance policies treat lateness beyond about an hour as materially more serious than a short delay. This is a suggested default, not a fixed standard — set it to what your organization considers a serious incident. | Being this many minutes late, or more, scores zero. Suggested: 60. |

---

## HR

### HR Dashboard (`/hr`)
| # | Where | Before | After |
|---|---|---|---|
| H1 | Compliance note | Idle tracking is consent-gated: no active consent, no tracking. Retention rows are redacted, never deleted — the financial record stays intact. | Idle tracking only runs with consent. Former employees' personal details are removed; pay records stay. |

### Employee Master (`/hr/employees`)
| # | Where | Before | After |
|---|---|---|---|
| H2 | Bulk import help | Columns: employeeCode, name, department, designation, managerEmployeeCode, joiningDate (YYYY-MM-DD), machineId, email (optional). Managers are referenced by their employee code, not an internal id. Login invitations are NOT sent at import — use "Send invitation" on the roster afterwards. Nothing is written until you confirm. | Columns: employeeCode, name, department, designation, managerEmployeeCode, joiningDate (YYYY-MM-DD), machineId, email (optional). Invitations aren't sent — use "Send invitation" afterwards. Nothing is saved until you confirm. *(column names kept — they must match the file)* |
| H3 | Bulk import errors | These rows will NOT be imported — the whole file is rejected until they are fixed: | Fix these rows first — the file can't be imported until they're corrected: |
| H4 | Invitation option help | Optional — the record is created either way. Skip it for employees who won't personally use SESS. | Optional. Skip it for employees who won't use SESS themselves. |
| H5 | Offboard confirmation | Raises a DRAFT full & final settlement pro-rated to this date, including any outstanding advance in full. | Creates a draft final settlement up to this date, including any unpaid advance. |

### Data Retention Review — employees (`/hr/employees/retention-review`)
| # | Where | Before | After |
|---|---|---|---|
| H6 | Removed fields note | Direct personal identifiers with no remaining audit purpose. Emergency contact names a third party who never worked here. | Personal details no longer needed, including the emergency contact. |
| H7 | Kept records note | Plus every payroll, attendance, appraisal, warning, expense and salary record. The employee row is never deleted — the retention period exists precisely to keep these auditable. | Plus all payroll, attendance, appraisal, warning, expense and salary records. The employee record is never deleted. |
| H8 | Why the name is kept | Why the name is kept: payslips, Form 16 and warning letters are legal documents that name the person they concern. Redacting the name would leave financial records that cannot be tied to anyone, defeating the audit purpose of the retention period and making a lawful subject-access request unanswerable. Erasing a name is a deliberate legal decision for a human, not this routine default. | The name stays so payslips, Form 16 and warning letters still show who they belong to. |
| H9 | Keep summary (confirm) | Will be kept: {…} — and every payroll, attendance, appraisal, warning and expense record, which stay complete and queryable. The employee record itself is never deleted. | Kept: {…}, plus all payroll, attendance, appraisal, warning and expense records. The employee record is never deleted. |
| H10 | Extend confirmation | Push {…}'s redaction date out by one year. Use this only when there is a live legal or audit reason to hold their full record. | Delay removing {…}'s details by one year. Use only for a legal or audit reason. |

### Attendance (`/hr/attendance`)
| # | Where | Before | After |
|---|---|---|---|
| H11 | Page description | Organisation-wide attendance for a date range, with exception handling and manual correction. Every correction is written to the audit log. | Attendance for everyone over a date range. Fix mistakes here; every correction is recorded. |
| H12 | Correction note | A correction rewrites the stored clock times and recalculates lateness from the employee's shift. Both the old and new values are recorded under ATTENDANCE_MANUALLY_CORRECTED in the audit log, with the reason given — the corrected row no longer holds what it previously said, so that entry is the only surviving record of the change. | A correction updates the clock times and lateness. The old and new times are recorded. |
| H13 | Correction form help | Lateness is recalculated from the new time against this employee's shift. Old and new values are written to the audit log. | Lateness is recalculated from the new time. Old and new times are recorded. |

### Shifts (`/hr/shifts`)
| # | Where | Before | After |
|---|---|---|---|
| H14 | Deactivate confirmation | Deactivate this shift? It disappears from assignment pickers {…} Shifts are never hard-deleted — you can reactivate it. | Deactivate this shift? It won't be offered for new assignments {…} You can reactivate it later. |

### Holidays (`/hr/holidays`)
| # | Where | Before | After |
|---|---|---|---|
| H15 | Page description | Holidays drive the celebratory banner across every portal. One row per actual date — no recurrence rules, because festival dates move each year. | Holidays show a banner in every portal. Add each date separately, as festival dates change yearly. |
| H16 | Date help | Enter the actual date for this year. Festival dates shift each year, so SESS never guesses them — add next year's dates when they're known. | Enter this year's date. Add next year's dates once they're known. |

### Onboarding (`/hr/onboarding`)
| # | Where | Before | After |
|---|---|---|---|
| H17 | Page description | New joiners get a default checklist automatically when they accept an offer. Tick items off as they're done, and add anything role-specific. | New joiners get a checklist when they accept an offer. Tick items off and add your own. |
| H18 | Empty state | A checklist is created automatically when a candidate accepts an offer. You can also add tasks to any employee from here once they have one. | Checklists are created when a candidate accepts an offer. You can then add tasks here. |

### Job Requisitions & Candidates
| # | Where | Before | After |
|---|---|---|---|
| H19 | Requisitions — page description | Open roles are published on the public career page. Closing a requisition removes it from that page and rejects further applications. | Open roles appear on the careers page. Closing a role removes it and stops new applications. |
| H20 | Close-role confirmation | Closing "{…}" removes it from the public career page and rejects any further applications, including from stale browser tabs. | Closing "{…}" removes it from the careers page and stops new applications. |
| H21 | Candidate — resume note | Read it yourself. SESS does not parse, extract or summarise resumes — no automated screening is applied to any applicant. | Please read the resume yourself. SESS doesn't scan or score resumes. |
| H22 | Interview feedback note | Written by you, for your team. Nothing on this page is generated, extracted or summarised automatically — read the resume and write what you think. | Your own notes for the hiring team. Read the resume and write your assessment. |
| H23 | Offer — terms locked | These figures are locked. Once an offer is SENT the terms are immutable through every code path — withdraw it and raise a new offer if the terms must change. | Terms are locked once the offer is sent. To change them, withdraw it and create a new offer. |
| H24 | Offer — record response | You are recording that {…} {…} this offer. Type their full name to confirm what you were told. Your user id, the time and your IP are recorded alongside it — this is a record of your data entry on the candidate's behalf, not of their own signature. | You're recording that {…} {…} this offer. Type their full name to confirm. Your account, the time and your IP are recorded. |
| H25 | Candidate retention — page description | Unsuccessful candidates whose retention window has elapsed. Nothing is deleted automatically — you decide, because a purge cannot be undone and may destroy data needed for a live matter. | Rejected candidates whose keep-period has ended. Nothing is deleted automatically, and deletion can't be undone. |
| H26 | Candidate retention — periods | Rejected without talent-pool consent — reviewed after {…} days. Rejected with consent — reviewed after {…} days; consent extends the window but does not make it indefinite. Hired candidates are never scheduled: their record becomes employment history under a different lawful basis. | Reviewed after {…} days, or {…} days if they agreed to stay on file. Hired candidates aren't listed. |
| H27 | Delete candidate confirmation | Permanently delete all data for {…}: their profile, resume file, {…} application{…}, interview feedback and any offer. This cannot be undone. An audit record of the deletion is kept. | Permanently delete all data for {…}: profile, resume, {…} application{…}, feedback and any offer. This can't be undone. |

### Payroll & Financials (`/hr/payroll`)
| # | Where | Before | After |
|---|---|---|---|
| H28 | Page description | Create and edit the monthly run, then submit it. Finalizing is a Super Admin action — once finalized, no figure can be changed through any code path. | Create the monthly payroll and submit it. Finalized payroll can't be changed. |
| H29 | No run yet | No payroll run exists yet. Nothing has been created for this period — start with Step 1 · Create payroll run above. | No payroll for this month yet. Start with Step 1 · Create payroll run. |
| H30 | Drafts waiting | {…} draft row{…} created but not yet submitted. The Super Admin cannot see these until you run Step 2 · Submit run for approval. | {…} draft row{…} not yet submitted. Use Step 2 so the Super Admin can finalize. |
| H31 | Submitted | {…} row{…} submitted and awaiting Super Admin finalization. They now appear on the Super Admin's Payroll Finalization page. | {…} row{…} submitted, waiting for the Super Admin to finalize. |
| H32 | Form 16 note | Generated by aggregating an employee's FINALIZED payroll across a financial year (April–March). SESS formats and totals figures HR has already recorded — it computes no tax slab, exemption or TDS amount. | A yearly summary (April–March) of finalized payroll. It doesn't calculate tax. |
| H33 | Form 16 empty | No finalized payroll in FY {…} yet — Form 16 can only be generated from finalized runs. | No finalized payroll for FY {…} yet. Form 16 needs at least one finalized month. |
| H34 | Adjustment button | Creates a NEW draft row for {…} holding only the difference. The finalized payslip is not changed — it stays exactly as issued, and the adjustment goes through the same submit and finalize steps. | Creates a new draft for {…} with only the difference. The finalized payslip stays unchanged. |
| H35 | Adjustment editor header | Additional amount — these figures are ADDED to the original payslip, not a replacement for it. | These amounts are added to the original payslip. |
| H36 | Adjustment editor help | Enter only the difference. To pay ₹2,000 of arrears on Basic, enter Basic = 2000 and leave everything else at 0. To recover an overpayment, use a negative amount (e.g. -2000). The original {…} payslip stays exactly as issued. | Enter only the difference, e.g. 2000 for ₹2,000 arrears, or -2000 to recover an overpayment. |
| H37 | TDS help | TDS is entered from the company's accountant. SESS never calculates it, and never applies a tax slab or exemption. | Enter TDS from the company's accountant. SESS doesn't calculate tax. |
| H38 | Advance recovery note | Salary advance recovery of ₹{…} is included in deductions. It is not editable here — the amount is derived from the outstanding balance, and finalizing this run reduces that balance by exactly this figure. | Includes ₹{…} salary advance recovery. It's set automatically and reduces the balance when finalized. |

### Salary Structure (`/hr/salary-structure`)
| # | Where | Before | After |
|---|---|---|---|
| H39 | Page description | Set each employee's monthly salary breakup. A payroll run only picks up employees who have a structure — everyone else is reported as unpayable rather than given a zeroed row. | Set each employee's monthly pay. Payroll only includes employees with a salary structure. |
| H40 | Salary history note | Ranges are half-open: a version ends on the day the next takes effect. Finalized payslips are unaffected by any later change — they snapshot the figures at run time. | Each version ends when the next one starts. Finalized payslips never change. |
| H41 | Footer | One current structure per employee. Saving no longer discards the old one: the version being replaced is archived with its effective range closed, and the full timeline appears under "Salary history" above. The new structure must take effect after the current one — to fix a typo in the version in force, correct its effective date rather than recording a change that never happened. Payroll rows snapshot Basic/HRA/Special Allowance at run time, so finalized payslips are unaffected by any later structure change. | Saving a change keeps the old version in Salary history. Finalized payslips never change. |
| H42 | Saved message | Salary structure saved — this defines what the employee is paid, but it does not create a payslip. To actually pay them, go to Payroll & Financials and run Step 1 · Create payroll run for the period, then Step 2 · Submit. | Salary structure saved. To pay the employee, run payroll in Payroll & Financials. |
| H43 | Salary advance help | Recovered automatically on each payroll run, capped at the outstanding balance. On offboarding the full remaining balance is settled at once. A second advance can only be issued once this one closes. | Recovered from each payroll. Any balance is settled at offboarding. One advance at a time. |

### Compliance & Consent (`/hr/compliance`)
| # | Where | Before | After |
|---|---|---|---|
| H44 | Page description | Record and track employee consent for idle tracking — and issue the desktop agent token from the same place. | Record employees' consent for idle tracking and set up their desktop agent. |
| H45 | Tip | Agent tokens are issued here — no need to leave this page | Set up the desktop agent from this page. |
| H46 | Token rule | A token can only be issued while idle-tracking consent is active — the same rule the server enforces on every heartbeat. Revoking consent stops tracking regardless of whether a token still exists. | The agent can only be set up while consent is active. Withdrawing consent stops tracking. |
| H47 | Consent form — also generate token | Idle tracking does nothing until {…}'s machine has a token. Ticking this issues it in the same step and shows it below — you won't need to go anywhere else. | Idle tracking needs a token on {…}'s computer. Tick this to create it now. |
| H48 | Token shown (consent form) | Agent token for {…}. Paste it into the SESS Idle Agent on their machine. Treat it like a password. | Paste this into the SESS Idle Agent on {…}'s computer. Keep it private. |
| H49 | Token shown (token manager) | Agent token for {…}. Paste it into the SESS Idle Agent on their machine. Treat it like a password. | Paste this into the SESS Idle Agent on {…}'s computer. Keep it private. |
| H50 | Replace token confirmation | This replaces {…}'s existing token. The agent already installed on their machine will stop reporting until the new token is entered into it. | This replaces {…}'s token. Their agent stops until the new token is entered. |

> H48/H49 note: the short status line "Consent recorded and agent token generated." is already fine and stays.

### Idle Tracking (`/hr/idle-tracking`)
| # | Where | Before | After |
|---|---|---|---|
| H51 | Scope note | Only idle-vs-active minutes, from whether the machine received keyboard or mouse input within {…}s. No screenshots, no application or website tracking, no keystrokes, and no productivity scoring. The desktop agent is visible in the employee's system tray at all times and can be paused by them. Issue a token only after recording consent on Compliance & Consent. | Tracks only active versus idle time — no screenshots, keystrokes or websites. Record consent first on Compliance & Consent. |
| H52 | Paused note | An employee whose consent is not active shows "tracking paused" — any totals beside it are historical, not current. The server rejects new heartbeats for them. | "Tracking paused" means consent isn't active. Any totals shown are from before. |

### Pulse Surveys (`/hr/pulse-surveys`)
| # | Where | Before | After |
|---|---|---|---|
| H53 | Page description | Short anonymous check-ins. You see averages and distributions only — individual responses are not stored against anyone, so there is nothing to drill into. | Short anonymous surveys. You see averages only — answers can't be traced to anyone. |
| H54 | Anonymity explainer | Ratings are stored with no employee field. A separate record tracks only that someone responded, to stop double-voting — it holds no rating. The two are never joined, so individual answers are not hidden from you, they genuinely do not exist in a linkable form. Small response counts still reveal a lot, so treat anything under about five responses as directional only. | Answers are saved without names. With fewer than five responses, treat results as a rough guide. |

---

## Manager
| # | Where | Before | After |
|---|---|---|---|
| M1 | Team Appraisal — description | Enter numeric feedback (0–100) and comments for your direct reports on open cycles. Formula weights are owned by Super Admin. | Give feedback scores (0–100) and comments for your team on open cycles. |
| M2 | Team Expenses — footer | Approved claims are picked up by the next payroll run and stamped as reimbursed, so the same claim can never be paid twice. | Approved claims are paid with the next payroll and can't be paid twice. |
| M3 | Team Idle Tracking — description | Roughly how much of tracked time your direct reports' machines were in use. Aggregates only — there is no minute-by-minute timeline here, by design. | How much of tracked time your team's computers were in use. Totals only. |
| M4 | Team Idle Tracking — note | This shows idle-vs-active minutes only. It does not show what anyone worked on, which applications they used, or any productivity score — and it is not part of appraisal. Treat a low figure as a prompt for a conversation, not a conclusion: someone in meetings all day or working away from their machine will read as idle here. | Active versus idle time only, not used in appraisals. A low figure is a reason to talk, not a verdict. |
| M5 | Team Payroll — description | Reference view of payroll for your direct reports. Managers cannot edit payroll — this view is read-only, and the payroll APIs reject manager writes. | Payroll for your team, view only. Contact HR about any changes. |
| M6 | Team Payroll — note | Read-only. Salary figures are managed by HR and locked by the Super Admin — raise any correction with HR rather than here. | View only. Contact HR about any salary correction. |
| M7 | Team Quality — description | Log defect counts and quality scores for your direct reports — one review per employee per day. | Record defect counts and quality scores for your team, one per person per day. |
| M8 | Warnings — description | Draft warning letters for your direct reports. Only HR can release a draft to the employee. | Draft warning letters for your team. Only HR can send them to the employee. |

---

## Employee
| # | Where | Before | After |
|---|---|---|---|
| E1 | Attendance — not linked | No employee record is linked to your account yet. Attendance and leave will appear once HR completes onboarding. | Your account isn't linked to an employee record yet. HR will set this up. |
| E2 | Profile — not linked | No employee record is linked to your account yet. Your profile will appear once HR completes onboarding. | Your account isn't linked to an employee record yet. HR will set this up. |
| E3 | Clock-in comment dialog | Your manager requires a comment with every web clock-in. Add a short note about what you're starting on. | Add a short note about what you're starting on. |
| E4 | Expenses — description | Submit reimbursement claims. Your manager approves them, and approved claims are paid out with your next finalized payroll run. | Submit expense claims. Once your manager approves, they're paid with your next payslip. |
| E5 | Expenses — footer | An approved claim is paid as a reimbursement line on your payslip — added after deductions, since a reimbursement is not taxable salary. | Approved claims are added to your payslip after deductions, as they aren't taxed. |
| E6 | Payslips — description | Your finalized payslips and annual Form 16 Part B statement. A payslip appears here once the payroll run for that month has been finalized. | Your payslips and yearly Form 16. A payslip appears once that month's payroll is finalized. |
| E7 | Payslips — empty | No finalized payslips yet. A payslip becomes downloadable only after the payroll run for that month has been finalized. | No payslips yet. They appear once a month's payroll is finalized. |
| E8 | Form 16 note | An annual statement aggregating your finalized payroll for a financial year (April–March). If a year has fewer than 12 finalized months, the statement is clearly labelled as partial — no month is ever estimated. | A yearly summary (April–March) of your finalized pay. Incomplete years are marked as partial. |
| E9 | My Data — what's included | Your profile, attendance, leave requests, production and quality records, published appraisal scores, released warning letters, consent records and expense claims — for the period you choose. | Your profile, attendance, leave, production, quality, appraisals, warnings, consents and expenses for the dates you choose. |
| E10 | My Data — appraisal note | · Appraisal scores appear only once a cycle has been published. Scores still being worked on are not yours yet, so they are not included. | · Appraisal scores appear only after they're published. |
| E11 | My Data — privacy note | This export always contains your own records only. It is generated from your signed-in identity, so it is not possible for this page to return anyone else's data. | This file only ever contains your own records. |
| E12 | Warning acknowledgement | Must match your name on record: {…}. Your name, the time, and your IP address are recorded. | Type your name as on record: {…}. Your name, the time and your IP address are recorded. |

---

## Shared (all portals)
| # | Where | Before | After |
|---|---|---|---|
| S1 | Community — description | Shout-outs and celebrations. Visible to everyone, and deliberately kept separate from appraisals — nothing posted here feeds into anyone's review. | Shout-outs and celebrations, visible to everyone. Posts here don't affect appraisals. |
| S2 | Community — not linked | No employee record is linked to your account yet, so you can't post. You can still read the wall. | Your account isn't linked to an employee record yet, so you can read but not post. |
| S3 | Community/Pulse — paused | The engagement module has been paused by the administrator. Nothing is deleted — everything returns when it is switched back on. | This feature is paused by your administrator. Nothing has been deleted. |
| S4 | Pulse — anonymity note | Your rating is stored in a table that has no employee field at all. A separate record notes only that you responded, so you aren't asked twice — it never stores what you said. The two are never joined, anywhere. HR sees averages and counts only, never individual answers. | Your answer is saved without your name. HR sees averages only, never individual answers. |
| S5 | Pulse — scale legend | {…} = strongly disagree · {…} = strongly agree. One response each, and it can't be changed afterwards — that's part of how responses stay unlinkable to you. | {…} = strongly disagree · {…} = strongly agree. One answer each, and it can't be changed. |
| S6 | Who's In Today widget | Presence only — this view shows whether someone has marked attendance today, not when they arrived. | Shows who has marked attendance today, not what time. |
| S7 | Reports — description | Generate a PDF report for any period. Every report is scoped to what your role may see. | Create a PDF report for any period. You only see data your role allows. |
| S8 | Report preview note | These are the same figures the PDF and CSV contain — the server computes the report once and renders whichever format is requested. | The PDF and CSV downloads contain these same figures. |
| S9 | Error page | This page could not be loaded. Nothing you were working on has been lost. Try again, and if it keeps happening, contact your system administrator. | This page couldn't load. Your work hasn't been lost. Try again or contact your administrator. |
| S10 | Error page — reference | Quote this when reporting the problem — it identifies this exact event in the server log. | Share this code when reporting the problem. |
| S11 | Home — no role yet | You're signed in, but no role is set on your account yet. Ask an administrator to assign one. | You're signed in, but no role is assigned yet. Ask an administrator. |

---

## Careers (public)
| # | Where | Before | After |
|---|---|---|---|
| C1 | Careers footer | Simplen is an equal-opportunity employer. Applications are reviewed by our people — every resume is read by a person, not scored by software. | Simplen is an equal-opportunity employer. Every application is read by a person. |
| C2 | Careers intro | We're hiring. Browse the roles below and apply with your resume — a member of our team reads every application. | We're hiring. Browse the roles below and apply with your resume. |
| C3 | Application submitted | Thank you. Someone from our team will read your resume and be in touch if there's a fit. You won't receive an automated score or rejection — a person reviews every application. | Thank you. Our team will read your resume and contact you if there's a fit. |

---

## Not changed — your call
These were flagged by length but aren't help text. I recommend leaving them as they are:

- **Careers Terms & Conditions** (`/careers/terms`, 6 strings) — legal wording on what data is collected, why, how long it's kept and how to delete it. Change it only with whoever approved the terms.
- **Landing page** (`components/landing/cinematic-landing.tsx`, 9 strings) — marketing copy (product story, overnight shifts, access control, no-AI, payroll separation, data retention). It's meant to persuade, not instruct. Happy to tighten it separately if you want.
- **Sign-in / sign-up** — the forms are Clerk's own and have no app help text to change.

## What happens on approval
1. Apply exactly the "After" text above (text only — no logic, layout or behaviour changes).
2. Update any verify suites that check the old wording.
3. Run tsc, the build and the DB-free suites, then commit and push.

**Total: 118 changes** (Super Admin 30 · HR 54 · Manager 8 · Employee 12 · Shared 11 · Careers 3) — plus 16 left unchanged (15 above, and the short "Consent recorded and agent token generated." line, which is already fine).
