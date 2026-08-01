-- Database-backed rate limiting for the PUBLIC careers application form.
--
-- Replaces an in-process Map in lib/recruitment/rate-limit.ts. On Vercel each
-- request may be served by a different, short-lived instance, so a per-process
-- counter sees only a fraction of the traffic and resets constantly — it does
-- not limit anything there. Postgres is the shared state every instance
-- already has.
--
-- Deliberately no foreign keys and no relations: a row here is a disposable
-- tick mark, counted in aggregate and swept once it ages out. It must never
-- become something the rest of the schema depends on.

CREATE TABLE "RateLimitAttempt" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitAttempt_pkey" PRIMARY KEY ("id")
);

-- Serves the windowed COUNT (key + action + createdAt) directly, and its
-- createdAt component keeps the retention sweep's range delete cheap.
CREATE INDEX "RateLimitAttempt_key_action_createdAt_idx"
    ON "RateLimitAttempt" ("key", "action", "createdAt");
