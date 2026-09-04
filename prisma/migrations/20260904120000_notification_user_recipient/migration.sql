-- Notification: make User the recipient, demote Employee to optional context.
--
-- WHY
-- `employeeId` was the REQUIRED recipient, which encoded an assumption that is
-- not universally true: that everyone who can receive a message has an HR
-- profile. An employee-less administrator (a valid User with employeeId = NULL)
-- could therefore never be sent a system alert — "payroll awaiting
-- finalization" would simply have nobody to address. That is a delivery gap,
-- not a cosmetic one.
--
-- After this migration:
--   recipientUserId  NOT NULL  -> who receives it   (application identity)
--   employeeId       NULL      -> what it concerns  (HR context, optional)
--
-- ─── ORDER MATTERS, AND WHY THERE IS NO DELETE ANYWHERE IN THIS FILE ──────
-- The new column is added NULLABLE, backfilled from each row's existing
-- employee -> User link, and only THEN promoted to NOT NULL. If any row could
-- not be backfilled — a Notification whose Employee has no linked User, i.e.
-- someone who was sent a message but never had a login — the SET NOT NULL at
-- step 3 FAILS and the whole migration rolls back.
--
-- That abort is deliberate and is the safe behaviour. The alternative, deleting
-- unbackfillable rows to let the constraint through, would silently destroy
-- notification history; this instead stops and surfaces the rows so a human
-- decides. Verified read-only against production before writing this file:
-- 0 Notification rows exist, so 0 can be stranded. The guarantee is structural
-- regardless of that count.
--
-- Written by hand, following the precedent set by
-- 20260816120000_attendance_accuracy: every step is guarded so the file is
-- correct both against a database that already has the column and one that does
-- not, and so it can be re-run without damage.

-- 1. New recipient column, nullable for now.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "recipientUserId" TEXT;

-- 2. Backfill: each notification's recipient is the User linked to the Employee
--    it was addressed to. User.employeeId is UNIQUE, so this matches at most
--    one User per row — no fan-out, no ambiguity.
UPDATE "Notification" n
   SET "recipientUserId" = u."id"
  FROM "User" u
 WHERE u."employeeId" = n."employeeId"
   AND n."recipientUserId" IS NULL;

-- 3. Promote to required. Fails loudly (and rolls the migration back) if step 2
--    left anything behind — see the note above. Nothing is deleted to make this
--    pass.
ALTER TABLE "Notification" ALTER COLUMN "recipientUserId" SET NOT NULL;

-- 4. Employee becomes optional context.
ALTER TABLE "Notification" ALTER COLUMN "employeeId" DROP NOT NULL;

-- 5. Foreign key to User. Postgres has no ADD CONSTRAINT IF NOT EXISTS, so the
--    existence check is explicit — keeping the file re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Notification_recipientUserId_fkey'
  ) THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT "Notification_recipientUserId_fkey"
      FOREIGN KEY ("recipientUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 6. Indexes. The panel query filters by recipient, so that composite replaces
--    the old employee-keyed one; employeeId keeps a plain index because the
--    orphan sweep and the verify suites still count by employee context.
CREATE INDEX IF NOT EXISTS "Notification_recipientUserId_read_idx"
  ON "Notification"("recipientUserId", "read");
CREATE INDEX IF NOT EXISTS "Notification_employeeId_idx"
  ON "Notification"("employeeId");
DROP INDEX IF EXISTS "Notification_employeeId_read_idx";
