-- Catch-up migration. schema.prisma has had these three things for a while and
-- the live database has them, but no migration created them — so a database
-- rebuilt from prisma/migrations alone (disaster recovery, a new environment)
-- came out different from production. Found by the 2026-10 load test.
--
-- Written to be a NO-OP wherever the change already exists, so it is safe to
-- `migrate deploy` against live: the columns use IF NOT EXISTS, and the
-- foreign key is only replaced when it is not already the right rule.

-- Careers terms acceptance (Application.termsAcceptedAt / termsVersion).
ALTER TABLE "Application" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Application" ADD COLUMN IF NOT EXISTS "termsVersion" TEXT;

-- Notification.employee is optional in schema.prisma, so Prisma's rule is
-- ON DELETE SET NULL / ON UPDATE CASCADE. 0_init created it as RESTRICT.
-- confdeltype 'n' = SET NULL, confupdtype 'c' = CASCADE.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Notification_employeeId_fkey'
      AND conrelid = '"Notification"'::regclass
      AND confdeltype = 'n'
      AND confupdtype = 'c'
  ) THEN
    ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_employeeId_fkey";
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
