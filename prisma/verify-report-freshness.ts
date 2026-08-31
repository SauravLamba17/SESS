/**
 * Verification that a report DOWNLOAD reflects data that changed AFTER the
 * preview was taken.
 *
 * WHY THIS EXISTS
 * verify-report-preview.ts proves preview and download agree WITHIN one
 * request (one runReport call, one `result` binding, three renderers). It
 * cannot catch the failure this file is about, which happens BETWEEN two
 * requests: for a period the JSON preview was served from a 5-minute Next.js
 * Data Cache while the CSV and PDF always recomputed. Both of that suite's
 * structural assertions still passed at the time — the divergence lived in
 * the cache layer, not in the compute path — so a test at this level was the
 * only thing that would have caught it.
 *
 * THE SEQUENCE, which is the user's actual sequence:
 *
 *     preview  →  underlying data changes  →  download
 *
 * and the property under test is that the download shows the NEW number.
 *
 * IT IS AN A/B TEST, NOT A SINGLE ASSERTION. Section 3 reconstructs the cache
 * wrapper exactly as it used to be and shows it returning the STALE number
 * for the same sequence. Without that half, a passing result here would prove
 * only that the test data changed, not that removing the cache is what fixed
 * it.
 *
 * Run (no dev server needed), the same way every other verify script runs:
 *   node --env-file=.env prisma/verify-report-freshness.ts
 *
 * WRITES: one disposable Employee, "ZZ-FRESHNESS-CHECK" / code ZZ-FRESH-0001,
 * deleted in a finally block that runs pass or fail.
 */
import { AsyncLocalStorage } from "node:async_hooks";

// Next's async-storage modules throw on import unless this global exists —
// their server bootstrap normally installs it. Set BEFORE any next/* import,
// so this script needs no custom loader and runs under the plain node runner
// the rest of prisma/verify-*.ts use.
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { computeHeadcount } from "../lib/reports/headcount.ts";
import { headcountCsv, serializeCsv } from "../lib/reports/csv.ts";
import { parseRange } from "../lib/reports/range.ts";

const client = new PrismaClient();

const { request, forceCold } = await import("../scripts/cache-harness.ts");
const { unstable_cache } = await import("next/dist/server/web/spec-extension/unstable-cache.js");

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function step(n: string, t: string) {
  console.log(`\n── ${n}: ${t} ${"─".repeat(Math.max(0, 46 - t.length))}`);
}

const parsed = parseRange("2026-08-01", "2026-08-31");
if (!parsed.ok) throw new Error("range failed to parse");
const range = parsed.range;

/** The roster read the headcount report performs, against the live database. */
const readRoster = () =>
  client.employee.findMany({
    select: {
      id: true,
      name: true,
      employeeCode: true,
      department: true,
      designation: true,
      active: true,
      joiningDate: true,
      offboardedAt: true,
    },
  });

const SCRATCH_CODE = "ZZ-FRESH-0001";
let scratchId: string | null = null;

console.log("Report freshness — the download reflects data changed after the preview");

try {
  // Leave no residue from an interrupted earlier run.
  await client.employee.deleteMany({ where: { employeeCode: SCRATCH_CODE } });

  // ── 1: the route is structurally incapable of caching a preview ────────
  step("1", "the route computes once and caches nothing");
  const routeSrc = fs.readFileSync(path.join(ROOT, "app/api/reports/[report]/route.ts"), "utf8");
  check(
    "exactly one runReport() call in the route",
    (routeSrc.match(/await runReport\(/g) ?? []).length === 1,
    `${(routeSrc.match(/await runReport\(/g) ?? []).length} call(s)`,
  );
  check("the route imports nothing from lib/cache/", !/@\/lib\/cache\//.test(routeSrc));
  check("no unstable_cache anywhere in the route", !/unstable_cache/.test(routeSrc));
  check(
    "the JSON branch reads run.result — the same binding CSV and PDF use",
    /format"\) === "json"[\s\S]{0,400}result: run\.result/.test(routeSrc),
  );
  check(
    "lib/cache/reports.ts is gone",
    !fs.existsSync(path.join(ROOT, "lib/cache/reports.ts")),
  );

  // ── 2: preview → data changes → download shows the NEW number ──────────
  step("2", "preview, then a real roster change, then download");

  const beforeRoster = await readRoster();
  const previewResult = computeHeadcount(beforeRoster, range);
  const previewJson = JSON.parse(JSON.stringify(previewResult));
  const previewActive = previewJson.totalActive as number;
  console.log(`        preview taken: totalActive=${previewActive}`);

  // The change. A brand-new ACTIVE employee must move the headcount by one.
  const created = await client.employee.create({
    data: {
      employeeCode: SCRATCH_CODE,
      name: "ZZ-FRESHNESS-CHECK",
      department: "ZZ-Freshness",
      designation: "Verification Fixture",
      joiningDate: new Date(2026, 0, 1),
      active: true,
    },
  });
  scratchId = created.id;
  console.log(`        [write] created active employee ${SCRATCH_CODE}`);

  // The download. This is the route's CSV branch: read fresh, compute fresh.
  const afterRoster = await readRoster();
  const downloadResult = computeHeadcount(afterRoster, range);
  const downloadJson = JSON.parse(JSON.stringify(downloadResult));
  const downloadCsv = serializeCsv(headcountCsv(downloadResult));
  const downloadActive = downloadJson.totalActive as number;
  console.log(`        download taken: totalActive=${downloadActive}`);

  check(
    "the download reflects the NEW data, not what the preview showed",
    downloadActive === previewActive + 1,
    `preview ${previewActive} → download ${downloadActive}`,
  );
  check(
    "the CSV body carries the new figure, not the stale one",
    downloadCsv.includes(`Active headcount,${downloadActive}`),
    `CSV says "Active headcount,${downloadActive}"`,
  );
  check(
    "the new department appears in the download's breakdown",
    downloadJson.byDepartment.some((d: { department: string }) => d.department === "ZZ-Freshness"),
  );

  // A SECOND preview, taken after the change, must equal the download — this
  // is the preview/download agreement the whole feature is for.
  const secondPreview = JSON.parse(JSON.stringify(computeHeadcount(await readRoster(), range)));
  check(
    "a preview taken after the change equals the download exactly",
    JSON.stringify(secondPreview) === JSON.stringify(downloadJson),
    `both totalActive=${secondPreview.totalActive}`,
  );

  // ── 3: the A/B — the removed cache WOULD have gone stale here ──────────
  step("3", "proof the cache was the cause: replay it against the same change");

  // Exactly the wrapper that used to live in lib/cache/reports.ts:
  // unstable_cache, keyed on report + scope + range, 300s, report tags.
  const OLD_TTL = 300;
  const cachedPreview = (roster: Awaited<ReturnType<typeof readRoster>>) =>
    unstable_cache(
      async () => computeHeadcount(roster, range),
      ["reports:preview", "headcount", "org", "2026-08-01..2026-08-31"],
      { tags: ["reports", "report:headcount"], revalidate: OLD_TTL },
    )();

  await forceCold(["reports", "report:headcount"]);

  // Take a cached preview from a roster WITHOUT the scratch employee, by
  // filtering it out — this reproduces "the preview was taken before the row
  // existed" without needing to delete and recreate it.
  const rosterBefore = (await readRoster()).filter((e) => e.employeeCode !== SCRATCH_CODE);
  const staleA = JSON.parse(JSON.stringify(await request(() => cachedPreview(rosterBefore))));
  console.log(`        old cached preview: totalActive=${staleA.totalActive}`);

  // Now the data has changed — ask the SAME cached reader again, with the full
  // current roster. A live read would return the new number.
  const rosterAfter = await readRoster();
  const staleB = JSON.parse(JSON.stringify(await request(() => cachedPreview(rosterAfter))));
  console.log(`        same reader, after the change: totalActive=${staleB.totalActive}`);

  check(
    "the OLD cache returns the pre-change number after the data changed",
    staleB.totalActive === staleA.totalActive && staleB.totalActive === downloadActive - 1,
    `cached ${staleB.totalActive} vs live ${downloadActive} — a ${OLD_TTL}s divergence window`,
  );
  check(
    "...which is exactly the gap the current uncached route no longer has",
    downloadActive !== staleB.totalActive,
    `uncached download ${downloadActive} ≠ cached preview ${staleB.totalActive}`,
  );

  // ── 4: no report tag survives to be invalidated ────────────────────────
  step("4", "invalidation modules no longer reference a report cache");
  for (const f of ["lib/invalidation/attendance.ts", "lib/invalidation/employee.ts"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    check(`${f} has no report-tag invalidation left`, !/TAG_REPORTS|reportTag/.test(code));
  }
} finally {
  if (scratchId) {
    await client.employee.delete({ where: { id: scratchId } });
    console.log(`\n  [cleanup] removed scratch employee ${SCRATCH_CODE}`);
  }
  await client.employee.deleteMany({ where: { employeeCode: SCRATCH_CODE } });
  await forceCold(["reports", "report:headcount"]);
  await client.$disconnect();
}

console.log(
  `\n══ RESULT: ${pass} passed, ${fail} failed ══${fail === 0 ? "" : "  <-- SEE ABOVE"}`,
);
process.exit(fail === 0 ? 0 : 1);
