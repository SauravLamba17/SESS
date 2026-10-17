// Shared guard + client factory for every load-test script. Run only through
// scripts/loadtest/lt-run.mjs, which injects .env.loadtest and nothing else.
import { PrismaClient } from "@prisma/client";

export const LIVE_REF = "ukjzcsvjbvlrhpmjwzfo";

/** Queries issued per client (populated when created with countQueries). */
export const queryCounts = new WeakMap<PrismaClient, number>();
/** Every query event per client: Prisma's timestamp (ms epoch), duration (ms), and whether it is
 *  pgbouncer-mode wrapping (BEGIN / DEALLOCATE ALL / COMMIT) rather than a real statement. */
export const queryEvents = new WeakMap<PrismaClient, { ts: number; dur: number; wrap: boolean }[]>();

export function refOf(url: string | undefined): string | null {
  return /postgres\.([a-z0-9]+)[:@]/.exec(url ?? "")?.[1] ?? null;
}

/** The test DATABASE_URL, or a throw. Checked again here, not just in lt-run. */
export function testUrl(url = process.env.DATABASE_URL): string {
  const ref = refOf(url);
  if (!url || !ref) throw new Error("REFUSING: no DATABASE_URL");
  if (ref === LIVE_REF || url.includes(LIVE_REF)) throw new Error("REFUSING: that is the LIVE database");
  if (ref !== process.env.LT_TEST_REF) throw new Error(`REFUSING: ref ${ref} is not the load-test ref`);
  return url;
}

/**
 * A client pinned to the test URL. The url is passed EXPLICITLY so Prisma can
 * never fall back to anything it might auto-load from an .env file.
 * `connectionLimit` rewrites the pool size (1 = one Vercel instance).
 */
export function client(opts: { url?: string; connectionLimit?: number; poolTimeout?: number; countQueries?: boolean } = {}): PrismaClient {
  let url = testUrl(opts.url);
  const u = new URL(url);
  if (opts.connectionLimit !== undefined) u.searchParams.set("connection_limit", String(opts.connectionLimit));
  if (opts.poolTimeout !== undefined) u.searchParams.set("pool_timeout", String(opts.poolTimeout));
  url = u.toString();
  if (!opts.countQueries) return new PrismaClient({ datasources: { db: { url } }, log: ["error"] });
  // Query events let the harness count database round trips per operation —
  // a number that, unlike wall time, does not depend on how far away the
  // test database is.
  const c = new PrismaClient({
    datasources: { db: { url } },
    log: [{ emit: "event", level: "query" }, { emit: "stdout", level: "error" }],
  });
  queryEvents.set(c, []);
  (c as unknown as { $on: (e: "query", f: (e: { timestamp: Date; duration: number; query: string }) => void) => void }).$on("query", (e) => {
    queryCounts.set(c, (queryCounts.get(c) ?? 0) + 1);
    queryEvents.get(c)!.push({ ts: +e.timestamp, dur: Number(e.duration), wrap: /^(BEGIN|COMMIT|ROLLBACK|DEALLOCATE ALL)/.test(e.query) });
  });
  return c;
}

/** Deterministic PRNG so a re-seed produces the same volume. */
export function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (a: number, b: number) => a + Math.floor(next() * (b - a + 1)),
    pick: <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Percentile of a sorted-ascending array (nearest-rank). */
export function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}
