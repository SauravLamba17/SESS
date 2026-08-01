-- Prevent DUPLICATE PAYROLL RUNS at the database level.
--
-- THE BUG THIS CLOSES
-- app/api/hr/payroll/run/route.ts guarded against a repeat run by SELECTing
-- the rows that already exist and then INSERTing the ones that did not. That
-- is a check-then-write with nothing behind it: two HR users clicking
-- "Run payroll" for the same period within the same moment both read an empty
-- set, both insert a full roster, and every employee ends up with two DRAFT
-- rows. Both then submit, both finalize, and every employee is PAID TWICE —
-- with the salary-advance recovery applied twice against the same balance.
-- No application-level check can close that window; only the database can.
--
-- WHY IT IS PARTIAL
-- Three kinds of Payroll row share (employeeId, month) legitimately:
--
--   1. the REGULAR monthly run                    isFinalSettlement=false, adjustmentForPayrollId IS NULL
--   2. the FULL & FINAL SETTLEMENT at offboarding isFinalSettlement=true
--   3. POST-FINALIZATION ADJUSTMENTS              adjustmentForPayrollId IS NOT NULL
--
-- Only (1) may ever exist twice for one employee-month, so only (1) is
-- constrained.
--
-- Settlements are excluded deliberately, not for convenience: offboarding
-- (app/api/hr/employee/offboard/route.ts) creates its settlement row
-- unconditionally, with no check for an existing regular row. If payroll for
-- July has already been run and the employee is then offboarded on 20 July,
-- both a regular and a settlement row exist for 2026-07 — both with
-- adjustmentForPayrollId IS NULL. A constraint covering only the adjustment
-- condition would make that legitimate offboarding fail with P2002.
--
-- Adjustments are excluded because they are deltas against an already-
-- finalized row and are expected to share its month; several may exist.
--
-- Postgres partial unique indexes cannot be expressed in Prisma's schema DSL,
-- so this is raw SQL. The corresponding comment on the Payroll model in
-- schema.prisma has been updated to point here.

CREATE UNIQUE INDEX "Payroll_one_regular_run_per_employee_month"
  ON "Payroll" ("employeeId", "month")
  WHERE "adjustmentForPayrollId" IS NULL AND "isFinalSettlement" = false;
