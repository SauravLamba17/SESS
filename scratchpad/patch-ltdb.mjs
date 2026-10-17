import { readFileSync, writeFileSync } from "node:fs";
const f = "scripts/loadtest/ltdb.ts";
let s = readFileSync(f, "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing: " + a.slice(0, 60)); s = s.replace(a, b); };
rep(`/** Queries issued per client (populated when created with countQueries). */
export const queryCounts = new WeakMap<PrismaClient, number>();`,
`/** Queries issued per client (populated when created with countQueries). */
export const queryCounts = new WeakMap<PrismaClient, number>();
/** Every query event per client: Prisma's timestamp (ms epoch) and duration (ms). */
export const queryEvents = new WeakMap<PrismaClient, { ts: number; dur: number }[]>();`);
rep(`  (c as unknown as { $on: (e: "query", f: () => void) => void }).$on("query", () => {
    queryCounts.set(c, (queryCounts.get(c) ?? 0) + 1);
  });`,
`  queryEvents.set(c, []);
  (c as unknown as { $on: (e: "query", f: (e: { timestamp: Date; duration: number }) => void) => void }).$on("query", (e) => {
    queryCounts.set(c, (queryCounts.get(c) ?? 0) + 1);
    queryEvents.get(c)!.push({ ts: +e.timestamp, dur: Number(e.duration) });
  });`);
rep(`export function client(opts: { url?: string; connectionLimit?: number; countQueries?: boolean } = {}): PrismaClient {
  let url = testUrl(opts.url);
  if (opts.connectionLimit !== undefined) {
    const u = new URL(url);
    u.searchParams.set("connection_limit", String(opts.connectionLimit));
    url = u.toString();
  }`,
`export function client(opts: { url?: string; connectionLimit?: number; poolTimeout?: number; countQueries?: boolean } = {}): PrismaClient {
  let url = testUrl(opts.url);
  const u = new URL(url);
  if (opts.connectionLimit !== undefined) u.searchParams.set("connection_limit", String(opts.connectionLimit));
  if (opts.poolTimeout !== undefined) u.searchParams.set("pool_timeout", String(opts.poolTimeout));
  url = u.toString();`);
writeFileSync(f, s);
console.log("ok");
