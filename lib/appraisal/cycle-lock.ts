import type { Prisma } from "@prisma/client";

// Deliberately NOT "server-only": this takes a transaction client as an
// argument and imports nothing but a type, so it has no server-only
// dependency of its own. Keeping it importable lets a plain-Node verification
// script drive the real lock against a real transaction. Only server code
// calls it, because only server code has a Prisma transaction to pass.

/**
 * Take a row lock on an appraisal cycle and report whether it is still open
 * for writes.
 *
 * ─── WHY A LOCK AND NOT JUST A RE-READ ───────────────────────────────────
 * compute, exclude and manager-feedback all used to do:
 *
 *     const cycle = await db.appraisalCycle.findUnique(...)   // read
 *     if (cycle.published) return 409                          // check
 *     ...
 *     await db.appraisalScore.upsert(...)                      // write
 *
 * That is a check-then-write across a network round trip. HR clicking Publish
 * mid-compute meant the compute had already read `published: false`, so it
 * went on to overwrite finalScore on a cycle that had just been published and
 * whose employees had already been notified their score was final. The score
 * an employee saw could change after they were told it would not.
 *
 * Moving the check inside the transaction narrows that window but does not
 * close it: under Postgres' default READ COMMITTED, two transactions can still
 * each read `published = false` and both proceed.
 *
 * `SELECT ... FOR UPDATE` closes it properly. The first transaction to reach
 * this line holds the cycle row until it commits; publish's
 * `updateMany({ where: { id, published: false } })` must wait for that lock,
 * and any writer arriving after publish commits sees `published = true` and
 * aborts. Both orderings are safe, and no writer can interleave with a publish.
 *
 * Returns false when the cycle is missing OR already published — the caller
 * maps that to its own 404/409. Must be called inside a `$transaction`; a lock
 * taken outside one is released immediately and buys nothing.
 */
export async function lockCycleForWrite(
  tx: Prisma.TransactionClient,
  cycleId: string,
): Promise<{ ok: true } | { ok: false; reason: "NOT_FOUND" | "PUBLISHED" }> {
  const rows = await tx.$queryRaw<{ published: boolean }[]>`
    SELECT "published" FROM "AppraisalCycle" WHERE "id" = ${cycleId} FOR UPDATE
  `;
  if (rows.length === 0) return { ok: false, reason: "NOT_FOUND" };
  if (rows[0].published) return { ok: false, reason: "PUBLISHED" };
  return { ok: true };
}
