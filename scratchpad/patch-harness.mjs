// One-off patch of scripts/loadtest/harness.ts (test harness only).
import { readFileSync, writeFileSync } from "node:fs";
const f = "scripts/loadtest/harness.ts";
let s = readFileSync(f, "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing: " + a.slice(0, 70)); s = s.replace(a, b); };
const between = (start, end, b) => {
  const i = s.indexOf(start), j = s.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error("markers: " + start.slice(0, 40));
  s = s.slice(0, i) + b + s.slice(j);
};

rep(`import { writeFileSync } from "node:fs";`, `import { writeFileSync } from "node:fs";\nimport { AsyncLocalStorage } from "node:async_hooks";`);
rep(`import { client, pct, queryCounts } from "./ltdb.ts";`, `import { client, pct, queryEvents, chunk } from "./ltdb.ts";`);

between("// ── instances, sampling, measurement", "/** Postgres backends for this database", `// ── instances, sampling, measurement ────────────────────────────────────────
// One simulated Vercel instance = one PrismaClient. \`base\` emits a query event
// per round trip (with Prisma's own duration); \`db\` is the same client with a
// timing extension, and is what app code gets through the proxy.
type Inst = { base: PrismaClient; db: PrismaClient; cl: number };
type Ctx = { maxCallMs: number };
const reqStore = new AsyncLocalStorage<Ctx>();
const timing = (base: PrismaClient) => base.$extends({ query: { async $allOperations({ args, query }) {
  const t = performance.now();
  try { return await query(args); }
  finally { const ctx = reqStore.getStore(); if (ctx) ctx.maxCallMs = Math.max(ctx.maxCallMs, performance.now() - t); }
} } }) as unknown as PrismaClient;
const instances = (n: number, cl = 1): Inst[] => Array.from({ length: n }, () => {
  const base = client({ connectionLimit: cl, poolTimeout: 60, countQueries: true });
  return { base, db: timing(base), cl };
});
const closeAll = (xs: Inst[]) => Promise.all(xs.map((c) => c.base.$disconnect()));
/** Connect every instance before measuring (10 at a time, up to 4 tries each); connect failures are reported, not hidden. */
async function warm(xs: Inst[]) {
  let failures = 0;
  for (const batch of chunk(xs, 10)) await Promise.all(batch.map(async (c) => {
    for (let k = 0; ; k++) { try { await c.base.$queryRaw\`SELECT 1\`; return; } catch (e) { failures++; if (k === 3) throw e; } }
  }));
  return { instances: xs.length, connectionLimit: xs[0]?.cl, connectFailuresBeforeRetry: failures };
}

// Distance model, set by baseline(): C = what one query costs from this machine
// to Sydney. Estimated Mumbai time = measured − RT×C + RT×5 ms (an ESTIMATE).
let C = NaN, TS_IS_START = true;
const MUMBAI_MS_PER_RT = 5;
/** Round trips on the request's critical path: all q when they ran one after another (connection_limit=1), fewer when they overlapped. */
function criticalRT(evs: { ts: number; dur: number }[]) {
  if (!evs.length) return 0;
  const iv = evs.map((e) => (TS_IS_START ? [e.ts, e.ts + e.dur] : [e.ts - e.dur, e.ts])).sort((a, b) => a[0] - b[0]);
  let busy = 0, [s0, e0] = iv[0];
  for (const [s1, e1] of iv.slice(1)) { if (s1 > e0) { busy += e0 - s0; s0 = s1; e0 = e1; } else e0 = Math.max(e0, e1); }
  busy += e0 - s0;
  const sum = evs.reduce((a, e) => a + e.dur, 0);
  return sum > 0 ? evs.length * Math.min(1, busy / sum) : evs.length;
}

`);

between("type Stat = ", "// ── people", `type Op = { ms: number; ok: boolean; q: number; rt: number; maxCallMs: number };
type Stat = { name: string; requests: number; ok: number; errors: Record<string, number>; ops: Op[]; wallMs: number; extra?: Record<string, unknown>; conn?: unknown };
function stat(name: string): Stat { return { name, requests: 0, ok: 0, errors: {}, ops: [], wallMs: 0 }; }
/** One request on instance c. Records time, success, round trips (query events) and the longest single Prisma call. */
async function timed<T>(s: Stat, c: Inst, fn: () => Promise<T>, also?: Stat): Promise<T | undefined> {
  const ev = queryEvents.get(c.base)!, i0 = ev.length, ctx: Ctx = { maxCallMs: 0 };
  const t = performance.now();
  let v: T | undefined, ok = false, err = "";
  try { v = await reqStore.run(ctx, () => instanceStore.run(c.db, fn)); ok = true; }
  catch (e) { err = (e as { code?: string }).code ?? String((e as Error).message ?? e).slice(0, 90); }
  const ms = performance.now() - t;
  await new Promise((r) => setTimeout(r, 5)); // query events land just after the result
  const mine = ev.slice(i0);
  const op: Op = { ms, ok, q: mine.length, rt: criticalRT(mine), maxCallMs: ctx.maxCallMs };
  for (const x of also ? [s, also] : [s]) { x.requests++; x.ops.push(op); if (ok) x.ok++; else x.errors[err] = (x.errors[err] ?? 0) + 1; }
  return v;
}
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const p3 = (xs: number[]) => { const a = sorted(xs); return { p50: Math.round(pct(a, 50)), p95: Math.round(pct(a, 95)), max: Math.round(a.at(-1) ?? NaN) }; };
const estMumbai = (o: Op) => Math.max(o.rt * MUMBAI_MS_PER_RT, o.ms - o.rt * C + o.rt * MUMBAI_MS_PER_RT);
const core = (s: Stat) => ({
  requests: s.requests,
  successRate: s.requests ? +(100 * s.ok / s.requests).toFixed(2) : null,
  errors: s.errors,
  queriesPerOp: p3(s.ops.map((o) => o.q)),
  measuredMs: p3(s.ops.map((o) => o.ms)),
  estMumbaiMs: p3(s.ops.map(estMumbai)),
  // A request would have hit P2024 at pool_timeout=10 if one Prisma call waited >10 s for the
  // connection, i.e. took >10 s beyond its own one-query cost C.
  wouldFailAt10s: { measured: s.ops.filter((o) => o.maxCallMs - C > 10_000).length, estMumbai: s.ops.filter((o) => estMumbai(o) > 10_000).length },
});
const summary = (s: Stat) => ({ scenario: s.name, ...core(s), wallSeconds: +(s.wallMs / 1000).toFixed(1), peakConnections: s.conn, ...s.extra });
const results: ReturnType<typeof summary>[] = [];
async function scenario(name: string, body: (s: Stat) => Promise<void>, extra?: () => Record<string, unknown>) {
  const s = stat(name);
  const smp = await sampler();
  const t = performance.now();
  await body(s);
  s.wallMs = performance.now() - t;
  s.conn = await smp.done();
  s.extra = extra?.();
  const r = summary(s);
  results.push(r);
  console.log(JSON.stringify(r));
}

`);

between("const ROLES = [", "// ── (c) payroll", `const ROLES = ["SUPER_ADMIN", "HR", "MANAGER", "EMPLOYEE"] as const;
async function dashboardFor(role: (typeof ROLES)[number]) {
  if (role === "SUPER_ADMIN") return adminDashboard();
  if (role === "HR") return hrDashboard(pick(HR).clerkId);
  if (role === "MANAGER") return managerDashboard(pick(MGR).clerkId);
  return employeeDashboard(pick(EMP).clerkId);
}
async function sustainedDashboards(s: Stat, insts: Inst[], seconds: number, perRole: Record<string, Stat>) {
  const until = performance.now() + seconds * 1000;
  await Promise.all(insts.map(async (inst, i) => {
    const role = ROLES[i % 4];
    while (performance.now() < until) await timed(s, inst, () => dashboardFor(role), perRole[role]);
  }));
}
const roleStats = () => Object.fromEntries(ROLES.map((r) => [r, stat(r)]));
const roleSummary = (m: Record<string, Stat>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, core(v)]));

`);

between("// ── scenarios", "await boot.$disconnect();", `// ── scenarios ───────────────────────────────────────────────────────────────
const which = process.argv[2] ?? "all";
const want = (k: string) => which === "all" || which.split(",").includes(k);
const notes: Record<string, unknown> = {};

// Baseline — always first: sets C (one query's cost from here) for every estimate below.
{
  const [one] = instances(1);
  await one.base.$queryRaw\`SELECT 1\`; // connect; not measured
  // Is Prisma's event timestamp the query's start or its end? (decides how overlap is measured)
  let dStart = 0, dEnd = 0;
  for (let i = 0; i < 5; i++) {
    const ev = queryEvents.get(one.base)!, t0 = Date.now();
    await one.base.$queryRaw\`SELECT 1\`;
    const t1 = Date.now();
    await new Promise((r) => setTimeout(r, 5));
    dStart += Math.abs(ev.at(-1)!.ts - t0); dEnd += Math.abs(ev.at(-1)!.ts - t1);
  }
  TS_IS_START = dStart <= dEnd;
  C = 0; // estimates are meaningless until set; the baseline row itself is reported raw
  const s = stat("0. baseline — plain SELECT 1 ×30, one warm instance, one after another");
  for (let i = 0; i < 30; i++) await timed(s, one, () => db.$queryRaw\`SELECT 1\`);
  C = pct(sorted(s.ops.map((o) => o.ms)), 50);
  const prismaDur = pct(sorted(queryEvents.get(one.base)!.slice(-30).map((e) => e.dur)), 50);
  const r = { scenario: s.name, requests: s.requests, successRate: +(100 * s.ok / s.requests).toFixed(2), errors: s.errors, measuredMs: p3(s.ops.map((o) => o.ms)), roundTripsPerSelect1: p3(s.ops.map((o) => o.q)),
    sydneyCostPerRoundTripMs: Math.round(C), prismaReportedDurMs: Math.round(prismaDur), mumbaiAssumedMsPerRoundTrip: MUMBAI_MS_PER_RT, prismaEventTimestampIs: TS_IS_START ? "start" : "end" };
  results.push(r as never);
  console.log(JSON.stringify(r));
  await closeAll([one]);
}

if (want("0")) {
  const cold = instances(20);
  await scenario("0b. 20 cold instances connect at the same moment (first query each)", async (s) => {
    await Promise.all(cold.map((c) => timed(s, c, () => db.$queryRaw\`SELECT 1\`)));
  });
  await closeAll(cold);
}

if (want("a")) {
  const staff = byRole("EMPLOYEE").concat(byRole("MANAGER"), byRole("HR"));
  const insts = instances(20);
  const w = await warm(insts);
  for (const phase of ["clock-in", "clock-out"] as const) {
    const actions: Record<string, number> = {};
    await scenario(\`a. 9am rush — \${staff.length} \${phase}s within 60 s (20 warm instances)\`, async (s) => {
      const free = [...insts];
      const waiters: ((c: Inst) => void)[] = [];
      const acquire = () => free.length ? Promise.resolve(free.pop()!) : new Promise<Inst>((r) => waiters.push(r));
      const release = (c: Inst) => { const w = waiters.shift(); if (w) w(c); else free.push(c); };
      await Promise.all(staff.map((u) => new Promise<void>((done) => setTimeout(async () => {
        const c = await acquire();
        const a = await timed(s, c, () => punch(u.clerkId));
        actions[String(a)] = (actions[String(a)] ?? 0) + 1;
        release(c); done();
      }, Math.random() * 60_000))));
    }, () => ({ outcomes: { ...actions }, warmup: w }));
  }
  await closeAll(insts);
}

async function busyMorning(cl: number) {
  const per = roleStats(), insts = instances(40, cl), w = await warm(insts);
  await scenario(\`b. busy morning — 40 concurrent dashboard loads, all 4 roles, 5 min, connection_limit=\${cl}\`, (s) => sustainedDashboards(s, insts, 300, per),
    () => ({ connectionLimit: cl, perRole: roleSummary(per), warmup: w, cache: "OFF (every read hits the DB — worst case)" }));
  await closeAll(insts);
}
if (want("b")) await busyMorning(1);
if (want("b5")) await busyMorning(5);

if (want("c")) {
  const [inst] = instances(1);
  await warm([inst]);
  const HR1 = HR[0].clerkId;
  const out: Record<string, unknown> = {};
  await scenario("c1. month-end payroll RUN for 2026-10", async (s) => { out.run = await timed(s, inst, () => payrollRun("2026-10", HR1)); }, () => ({ result: out.run }));
  await scenario("c2. payroll SUBMIT", async (s) => { out.sub = await timed(s, inst, () => payrollSubmit("2026-10", HR1)); }, () => ({ result: out.sub }));
  await scenario("c3. payroll FINALIZE (lock + loan recovery + notifications)", async (s) => { out.fin = await timed(s, inst, () => payrollFinalize("2026-10", SA.clerkId)); }, () => ({ result: out.fin }));
  const cycle = await boot.appraisalCycle.findFirst({ where: { published: false } });
  await scenario("c4. appraisal COMPUTE for all active employees", async (s) => { out.app = await timed(s, inst, () => appraisalCompute(cycle!.id, HR1)); }, () => ({ result: out.app }));
  await closeAll([inst]);
}

if (want("d")) {
  const ids = REPORTS.map((r) => r.id);
  const [inst] = instances(1);
  await warm([inst]);
  const threeYear = parseRange("2023-10-01", "2026-09-30");
  notes.threeYearRange = threeYear.ok ? "accepted" : \`refused by design: \${threeYear.code} — \${threeYear.message}\`;
  const per: Record<string, Stat> = Object.fromEntries(ids.map((id) => [id, stat(id)]));
  await scenario(\`d1. all \${ids.length} reports, max range 2024-10-01→2026-09-30 (data + PDF + CSV), one after another\`, async (s) => {
    for (const id of ids) await timed(s, inst, () => oneReport(id, "2024-10-01", "2026-09-30", ["json", "pdf", "csv"]), per[id]);
  }, () => ({ perReport: roleSummary(per), threeYearRange: notes.threeYearRange }));
  await closeAll([inst]);
  const insts = instances(10), w = await warm(insts);
  await scenario("d2. 10 people running reports at once (3 random PDF reports each, 2-year range)", async (s) => {
    await Promise.all(insts.map(async (c) => { for (let k = 0; k < 3; k++) await timed(s, c, () => oneReport(pick(ids), "2024-10-01", "2026-09-30", ["json", "pdf"])); }));
  }, () => ({ warmup: w }));
  await closeAll(insts);
}

if (want("e")) {
  const [inst] = instances(1);
  await warm([inst]);
  let n: unknown;
  await scenario("e. bulk import of 50 employees (validate + one transaction)", async (s) => { n = await timed(s, inst, () => bulkImport(50, HR[0].clerkId)); }, () => ({ imported: n }));
  await closeAll([inst]);
}

if (want("f")) {
  const per1 = roleStats(), per2 = roleStats();
  const insts = instances(80), w = await warm(insts);
  await scenario("f1. SPIKE — 80 concurrent dashboard loads (2× b) for 60 s", (s) => sustainedDashboards(s, insts, 60, per1), () => ({ perRole: roleSummary(per1), warmup: w }));
  await closeAll(insts.slice(40));
  await scenario("f2. RECOVERY — back to 40 concurrent for 60 s right after the spike", (s) => sustainedDashboards(s, insts.slice(0, 40), 60, per2), () => ({ perRole: roleSummary(per2) }));
  await closeAll(insts.slice(0, 40));
}

`);
writeFileSync(f, s);
console.log("patched", s.split("\n").length, "lines");
