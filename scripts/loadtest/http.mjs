// Public-route HTTP load against a LOCAL production build only (next start).
//   node scripts/loadtest/http.mjs http://localhost:3105 [concurrency=20] [seconds=30]
// Refuses any host that is not localhost / 127.0.0.1 — never the live site.
import { performance } from "node:perf_hooks";

const base = new URL(process.argv[2] ?? "http://localhost:3105");
if (!["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error(`REFUSING: ${base.hostname} is not local`);
const conc = Number(process.argv[3] ?? 20), seconds = Number(process.argv[4] ?? 30);
const PATHS = ["/", "/careers", "/api/health", "/api/health/ready"];
const pct = (a, p) => a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)];

const hit = async (path) => {
  const t = performance.now();
  try {
    const r = await fetch(new URL(path, base), { redirect: "manual", headers: { "user-agent": "sess-loadtest" } });
    await r.arrayBuffer();
    return { ms: performance.now() - t, status: r.status };
  } catch (e) {
    return { ms: performance.now() - t, status: `ERR ${e.cause?.code ?? e.message}` };
  }
};

const out = [];
for (const path of PATHS) {
  const first = await hit(path); // first request after the previous path's load: shows render/cache warm-up
  const res = [];
  const until = performance.now() + seconds * 1000;
  await Promise.all(Array.from({ length: conc }, async () => { while (performance.now() < until) res.push(await hit(path)); }));
  const ms = res.map((r) => r.ms).sort((a, b) => a - b);
  const statuses = {};
  for (const r of res) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  const ok = res.filter((r) => typeof r.status === "number" && r.status < 400).length;
  const row = { path, concurrency: conc, seconds, firstRequestMs: Math.round(first.ms), firstStatus: first.status, requests: res.length, rps: +(res.length / seconds).toFixed(1), successRate: +(100 * ok / res.length).toFixed(2), p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), max: Math.round(ms.at(-1)), statuses };
  out.push(row);
  console.log(JSON.stringify(row));
}
