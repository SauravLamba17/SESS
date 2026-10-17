import { readFileSync, writeFileSync } from "node:fs";
const edit = (f, pairs) => { let s = readFileSync(f, "utf8"); for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(f + " missing: " + a.slice(0, 70)); s = s.replace(a, b); } writeFileSync(f, s); };
edit("scripts/loadtest/ltdb.ts", [
  [`/** Every query event per client: Prisma's timestamp (ms epoch) and duration (ms). */
export const queryEvents = new WeakMap<PrismaClient, { ts: number; dur: number }[]>();`,
   `/** Every query event per client: Prisma's timestamp (ms epoch), duration (ms), and whether it is
 *  pgbouncer-mode wrapping (BEGIN / DEALLOCATE ALL / COMMIT) rather than a real statement. */
export const queryEvents = new WeakMap<PrismaClient, { ts: number; dur: number; wrap: boolean }[]>();`],
  [`$on: (e: "query", f: (e: { timestamp: Date; duration: number }) => void) => void`, `$on: (e: "query", f: (e: { timestamp: Date; duration: number; query: string }) => void) => void`],
  [`queryEvents.get(c)!.push({ ts: +e.timestamp, dur: Number(e.duration) });`, `queryEvents.get(c)!.push({ ts: +e.timestamp, dur: Number(e.duration), wrap: /^(BEGIN|COMMIT|ROLLBACK|DEALLOCATE ALL)\b/.test(e.query) });`],
]);
edit("scripts/loadtest/harness.ts", [
  [`// Distance model, set by baseline(): C = what one query costs from this machine
// to Sydney. Estimated Mumbai time = measured − RT×C + RT×5 ms (an ESTIMATE).
let C = NaN, TS_IS_START = true;
const MUMBAI_MS_PER_RT = 5;
/** Round trips on the request's critical path: all q when they ran one after another (connection_limit=1), fewer when they overlapped. */
function criticalRT(evs: { ts: number; dur: number }[]) {
  if (!evs.length) return 0;`,
   `// Distance model, set by the baseline. With pgbouncer=true Prisma sends every call as
// BEGIN · DEALLOCATE ALL · statement · COMMIT — the wrappers are 1 network round trip
// each, the statement 2 (parse, then bind/execute). RT_MS = SELECT 1 time ÷ its round
// trips. Estimated Mumbai time = measured − RT×RT_MS + RT×5 ms (an ESTIMATE).
let C = NaN, RT_MS = NaN, TS_IS_START = true;
const MUMBAI_MS_PER_RT = 5;
type Ev = { ts: number; dur: number; wrap: boolean };
const roundTrips = (evs: Ev[]) => evs.reduce((a, e) => a + (e.wrap ? 1 : 2), 0);
/** Round trips on the request's critical path: all of them when they ran one after another (connection_limit=1), fewer when they overlapped. */
function criticalRT(evs: Ev[]) {
  if (!evs.length) return 0;`],
  [`  return sum > 0 ? evs.length * Math.min(1, busy / sum) : evs.length;`, `  return roundTrips(evs) * (sum > 0 ? Math.min(1, busy / sum) : 1);`],
  [`type Op = { ms: number; ok: boolean; q: number; rt: number; maxCallMs: number };`, `type Op = { ms: number; ok: boolean; q: number; rt: number; rtCrit: number; maxCallMs: number };`],
  [`const op: Op = { ms, ok, q: mine.length, rt: criticalRT(mine), maxCallMs: ctx.maxCallMs };`, `const op: Op = { ms, ok, q: mine.filter((e) => !e.wrap).length, rt: roundTrips(mine), rtCrit: criticalRT(mine), maxCallMs: ctx.maxCallMs };`],
  [`const estMumbai = (o: Op) => Math.max(o.rt * MUMBAI_MS_PER_RT, o.ms - o.rt * C + o.rt * MUMBAI_MS_PER_RT);`, `const estMumbai = (o: Op) => Math.max(o.rtCrit * MUMBAI_MS_PER_RT, o.ms - o.rtCrit * RT_MS + o.rtCrit * MUMBAI_MS_PER_RT);`],
  [`  queriesPerOp: p3(s.ops.map((o) => o.q)),`, `  queriesPerOp: p3(s.ops.map((o) => o.q)),\n  roundTripsPerOp: p3(s.ops.map((o) => o.rt)),`],
  [`  C = 0; // estimates are meaningless until set; the baseline row itself is reported raw`, `  C = RT_MS = 0; // estimates are meaningless until set; the baseline row itself is reported raw`],
  [`  C = pct(sorted(s.ops.map((o) => o.ms)), 50);`, `  C = pct(sorted(s.ops.map((o) => o.ms)), 50);\n  RT_MS = C / pct(sorted(s.ops.map((o) => o.rt)), 50);`],
  [`roundTripsPerSelect1: p3(s.ops.map((o) => o.q)),
    sydneyCostPerRoundTripMs: Math.round(C),`, `roundTripsPerSelect1: p3(s.ops.map((o) => o.rt)),
    sydneyCostPerRoundTripMs: Math.round(RT_MS),`],
]);
console.log("ok");
