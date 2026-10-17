import { readFileSync, writeFileSync } from "node:fs";
const f = "scripts/loadtest/harness.ts";
let s = readFileSync(f, "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing: " + a.slice(0, 70)); s = s.replace(a, b); };

rep(`async function payrollRun(period: string, actor: string) {`, `async function payrollRun(period: string, actor: string, txTimeout = 30_000) {`);
rep(`    return { created: fresh.length, claims: claims.length };
  }, { timeout: 30_000 });`, `    return { created: fresh.length, claims: claims.length };
  }, { timeout: txTimeout });`);
rep(`async function payrollFinalize(period: string, actor: string) {`, `async function payrollFinalize(period: string, actor: string, txTimeout = 30_000) {`);
rep(`    return { finalized: upd.count, ...loans };
  }, { timeout: 30_000 });`, `    return { finalized: upd.count, ...loans };
  }, { timeout: txTimeout });`);
rep(`async function appraisalCompute(cycleId: string, actor: string) {`, `async function appraisalCompute(cycleId: string, actor: string, txTimeout = 60_000) {`);
rep(`  }, { timeout: 60_000 });
  return { employees: employees.length, complete };`, `  }, { timeout: txTimeout });
  return { employees: employees.length, complete };`);
rep(`async function bulkImport(n: number, actor: string) {`, `async function bulkImport(n: number, actor: string, txTimeout = 60_000) {`);
rep(`    return out.length;
  }, { timeout: 120_000 });`, `    return out.length;
  }, { timeout: txTimeout });`);

// A write step: first with the route's own transaction timeout; if that fails, say so and
// retry once with a long timeout so later steps (and the Step 4 checks) have data.
rep(`if (want("c")) {`, `const LONG_TX = 15 * 60_000;
async function writeStep<T>(inst: Inst, label: string, run: (txTimeout?: number) => Promise<T>): Promise<T | undefined> {
  let v: T | undefined;
  await scenario(label, async (s) => { v = await timed(s, inst, () => run()); }, () => ({ result: v ?? null, txTimeout: "route's own" }));
  if (v !== undefined) return v;
  await scenario(\`\${label} — RETRY with 15-min transaction timeout (harness-only distance compensation)\`, async (s) => { v = await timed(s, inst, () => run(LONG_TX)); }, () => ({ result: v ?? null }));
  return v;
}

if (want("c")) {`);
rep(`  await scenario("c1. month-end payroll RUN for 2026-10", async (s) => { out.run = await timed(s, inst, () => payrollRun("2026-10", HR1)); }, () => ({ result: out.run }));`,
    `  out.run = await writeStep(inst, "c1. month-end payroll RUN for 2026-10", (t) => payrollRun("2026-10", HR1, t));`);
rep(`  await scenario("c3. payroll FINALIZE (lock + loan recovery + notifications)", async (s) => { out.fin = await timed(s, inst, () => payrollFinalize("2026-10", SA.clerkId)); }, () => ({ result: out.fin }));`,
    `  out.fin = await writeStep(inst, "c3. payroll FINALIZE (lock + loan recovery + notifications)", (t) => payrollFinalize("2026-10", SA.clerkId, t));`);
rep(`  await scenario("c4. appraisal COMPUTE for all active employees", async (s) => { out.app = await timed(s, inst, () => appraisalCompute(cycle!.id, HR1)); }, () => ({ result: out.app }));`,
    `  out.app = await writeStep(inst, "c4. appraisal COMPUTE for all active employees", (t) => appraisalCompute(cycle!.id, HR1, t));`);
rep(`  let n: unknown;
  await scenario("e. bulk import of 50 employees (validate + one transaction)", async (s) => { n = await timed(s, inst, () => bulkImport(50, HR[0].clerkId)); }, () => ({ imported: n }));`,
    `  await writeStep(inst, "e. bulk import of 50 employees (validate + one transaction)", (t) => bulkImport(50, HR[0].clerkId, t));`);
writeFileSync(f, s);
console.log("ok");
