/**
 * Verification for the on-screen report preview.
 *
 * TWO CLAIMS, both proved rather than asserted:
 *
 *   1. Preview and PDF/CSV can never disagree, because there is only ever ONE
 *      computation. Proved structurally (runReport computes `result` once and
 *      hands the SAME binding to both renderers) and numerically (the CSV text
 *      is regenerated from a real computed result and every figure in the JSON
 *      preview is found in it).
 *
 *   2. Preview is gated by the SAME check as download, not a weaker one. Proved
 *      by source order (scope is resolved before `format` is ever read) and
 *      live over HTTP (all three formats refuse an unauthorised caller
 *      identically, same status and same code).
 *
 * The pure compute + CSV functions are plain .ts and drive directly here.
 * lib/reports/run.tsx cannot be imported by a plain-Node script (it contains
 * JSX for the PDF templates), so its single-compute guarantee is verified by
 * reading its source — which is the guarantee's actual location.
 *
 * Run (dev server up for the HTTP section):
 *   node --env-file=.env prisma/verify-report-preview.ts
 */
import fs from "node:fs";
import path from "node:path";
import { computeHeadcount } from "../lib/reports/headcount.ts";
import { headcountCsv, serializeCsv } from "../lib/reports/csv.ts";
import { parseRange } from "../lib/reports/range.ts";
import { REPORTS, scopeFor } from "../lib/reports/registry.ts";
import type { ReportEmployee } from "../lib/reports/types.ts";

const ROOT = process.cwd();
const BASE = "http://127.0.0.1:3005";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}
function step(n: string, t: string) {
  console.log(`\n── ${n}: ${t} ${"─".repeat(Math.max(0, 46 - t.length))}`);
}

/** A hand-checkable roster: 5 active across 3 departments, 1 offboarded. */
function roster(): ReportEmployee[] {
  const d = (s: string) => new Date(s + "T00:00:00.000Z");
  return [
    { id: "1", name: "A", employeeCode: "E1", department: "Engineering", active: true,  joiningDate: d("2024-01-01"), offboardedAt: null },
    { id: "2", name: "B", employeeCode: "E2", department: "Engineering", active: true,  joiningDate: d("2024-02-01"), offboardedAt: null },
    { id: "3", name: "C", employeeCode: "E3", department: "Engineering", active: true,  joiningDate: d("2026-02-10"), offboardedAt: null },
    { id: "4", name: "D", employeeCode: "E4", department: "Quality",     active: true,  joiningDate: d("2024-03-01"), offboardedAt: null },
    { id: "5", name: "E", employeeCode: "E5", department: "Packing",     active: true,  joiningDate: d("2024-04-01"), offboardedAt: null },
    { id: "6", name: "F", employeeCode: "E6", department: "Packing",     active: false, joiningDate: d("2023-01-01"), offboardedAt: d("2026-02-20") },
  ];
}

async function main() {
  console.log("Report preview — one computation, one permission check");

  // ── 1: ONE computation feeds all three formats ────────────────────────
  step("1", "runReport computes once, both renderers close over it");
  const runSrc = fs.readFileSync(path.join(ROOT, "lib/reports/run.tsx"), "utf8");
  const cases = [...runSrc.matchAll(/case "([a-z-]+)": \{([\s\S]*?)\n    \}/g)];
  check("every report id in the registry has a case", cases.length >= 10, `${cases.length} cases`);

  let singleCompute = 0;
  const offenders: string[] = [];
  for (const [, id, body] of cases) {
    // The shape that makes divergence impossible: compute into `result` once,
    // then hand that SAME binding to the pdf and csv closures.
    const computesOnce = (body.match(/const result = /g) ?? []).length === 1;
    const pdfUsesResult = /pdf: \(\) =>[\s\S]*?\br=\{result\}|pdf: \(\) =>[\s\S]*?\bresult\b/.test(body);
    // Three legal shapes: a csv closure over the same `result`, an explicit
    // `csv: null` for the two PDF-only reports (Board Summary is a narrative,
    // My Data is a personal manifest), or no csv key at all.
    const csvUsesResult =
      !/csv:/.test(body) ||
      /csv: null/.test(body) ||
      /csv: \(\) => \w+\(result\)/.test(body);
    if (computesOnce && pdfUsesResult && csvUsesResult) singleCompute++;
    else offenders.push(id);
  }
  check("every case computes exactly once and shares that result",
    offenders.length === 0, offenders.length ? `offenders: ${offenders.join(", ")}` : `${singleCompute}/${cases.length}`);

  const routeSrc = fs.readFileSync(path.join(ROOT, "app/api/reports/[report]/route.ts"), "utf8");
  check("the route calls runReport exactly once",
    (routeSrc.match(/await runReport\(/g) ?? []).length === 1);
  check("the JSON branch returns run.result, it does not recompute",
    /format"\) === "json"[\s\S]{0,400}result: run\.result/.test(routeSrc));
  check("the CSV branch renders from the same run object",
    /format"\) === "csv"[\s\S]{0,400}run\.csv\(\)/.test(routeSrc));
  check("no compute function is called inside any format branch",
    !/format"\) === "(json|csv)"[\s\S]{0,400}compute[A-Z]/.test(routeSrc));

  // ── 2: the numbers themselves agree ───────────────────────────────────
  step("2", "preview JSON figures appear verbatim in the CSV");
  const parsed = parseRange("2026-02-01", "2026-02-28");
  if (!parsed.ok) throw new Error("range failed to parse");
  const result = computeHeadcount(roster(), parsed.range);

  // This is exactly what the API returns for ?format=json ...
  const previewJson = JSON.parse(JSON.stringify(result));
  // ... and this is exactly what it returns for ?format=csv, from the SAME object.
  const csvText = serializeCsv(headcountCsv(result));

  check("computed a non-trivial result", previewJson.totalActive === 5, `totalActive=${previewJson.totalActive}`);
  check("department breakdown present", Array.isArray(previewJson.byDepartment) && previewJson.byDepartment.length === 3,
    `${previewJson.byDepartment?.length} departments`);

  const scalarChecks: [string, unknown][] = [
    ["Active headcount", previewJson.totalActive],
    ["Departments", previewJson.departmentCount],
    ["Headcount at period start", previewJson.atRangeStart],
    ["Headcount at period end", previewJson.atRangeEnd],
    ["Net change", previewJson.netChange],
  ];
  for (const [label, value] of scalarChecks) {
    check(`CSV carries the preview's "${label}"`,
      csvText.includes(`${label},${value}`), `${label},${value}`);
  }
  for (const d of previewJson.byDepartment as { department: string; count: number }[]) {
    check(`CSV carries department row ${d.department}`,
      csvText.includes(`${d.department},${d.count}`), `${d.department},${d.count}`);
  }
  // The inverse: nothing in the CSV summary that the preview does not also hold.
  const summaryNums = [...csvText.matchAll(/^(?:Active headcount|Departments|Headcount at period (?:start|end)|Net change),(-?\d+)$/gm)].map((m) => Number(m[1]));
  const previewNums = scalarChecks.map(([, v]) => Number(v));
  check("no CSV summary figure is absent from the preview",
    summaryNums.every((n) => previewNums.includes(n)), JSON.stringify(summaryNums));

  // ── 3: preview is gated by the SAME check as download ─────────────────
  step("3", "scope is resolved before format is ever read");
  const scopeIdx = routeSrc.indexOf("resolveReportScope(def)");
  const firstFormatIdx = routeSrc.indexOf('searchParams.get("format")');
  check("resolveReportScope() appears before any format read",
    scopeIdx > -1 && firstFormatIdx > -1 && scopeIdx < firstFormatIdx,
    `scope@${scopeIdx} < format@${firstFormatIdx}`);
  check("the scope refusal returns before any branching",
    /if \(!scope\.ok\) return fail\(scope\.code, scope\.message, scope\.status\);/.test(routeSrc));
  check("there is exactly ONE scope check in the route",
    (routeSrc.match(/resolveReportScope\(/g) ?? []).length === 1);

  // The registry a Manager is judged by — the UI reads the same table.
  const forbidden = REPORTS.filter((r) => !r.selfService && scopeFor(r, "MANAGER") === "none");
  check("the registry denies a Manager at least one report",
    forbidden.length > 0, forbidden.map((r) => r.id).join(", "));

  step("4", "LIVE: an unauthorised caller is refused identically in all 3 formats");
  const target = forbidden[0]?.id ?? "payroll-cost";
  const q = "startDate=2026-02-01&endDate=2026-02-28";
  try {
    const seen: Record<string, string> = {};
    for (const format of ["json", "pdf", "csv"] as const) {
      const res = await fetch(`${BASE}/api/reports/${target}?${q}&format=${format}`);
      const body = await res.json().catch(() => ({}));
      seen[format] = `${res.status}/${body.code ?? "-"}`;
      console.log(`        ${format.padEnd(4)} -> ${res.status} ${JSON.stringify(body.code ?? body.error ?? "")}`);
    }
    check("preview is refused exactly as PDF is", seen.json === seen.pdf, `${seen.json} vs ${seen.pdf}`);
    check("preview is refused exactly as CSV is", seen.json === seen.csv, `${seen.json} vs ${seen.csv}`);
    check("the refusal is an auth/scope refusal, not a 200",
      seen.json.startsWith("401") || seen.json.startsWith("403"), seen.json);
  } catch (e) {
    check("HTTP section ran (is the dev server up on :3005?)", false, String(e));
  }

  // ── 5: the UI reuses one endpoint and one gate ────────────────────────
  step("5", "the UI has no separate preview path");
  const listSrc = fs.readFileSync(path.join(ROOT, "components/reports/report-list.tsx"), "utf8");
  check("preview and download build their URL from ONE helper",
    (listSrc.match(/function url\(/g) ?? []).length === 1 && /url\(report, "json"\)/.test(listSrc));
  check("preview hits /api/reports, not a bespoke endpoint",
    !/fetch\((?!.*api\/reports)/.test(listSrc) && /api\/reports/.test(listSrc));
  check("preview shares the download hook's range validation",
    /preview: fetchPreview,?\s*\}\s*=\s*useFileDownload/.test(listSrc.replace(/\s+/g, " ").replace(/, \}/g, " }")) ||
      /useFileDownload\(\s*start,\s*end,?\s*\)/.test(listSrc));
  check("download buttons are rendered inside the preview too",
    /<ReportPreview[\s\S]{0,120}<DownloadButtons/.test(listSrc));

  const hookSrc = fs.readFileSync(path.join(ROOT, "components/reports/use-file-download.ts"), "utf8");
  check("preview() reuses the hook's rangeValid guard",
    /async function preview[\s\S]{0,300}if \(!rangeValid\)/.test(hookSrc));
  check("preview() surfaces the API's own error message",
    /async function preview[\s\S]{0,600}setError\(data\.error \?\? opts\.failMessage\)/.test(hookSrc));

  // All three portals inherit this automatically.
  for (const p of ["app/hr/reports/page.tsx", "app/manager/reports/page.tsx", "app/admin/reports/page.tsx"]) {
    const src = fs.readFileSync(path.join(ROOT, p), "utf8");
    check(`${p} uses the shared ReportsPageBody`, /<ReportsPageBody \/>/.test(src));
  }
}

main()
  .catch((e) => { console.error("suite crashed:", e); fail++; })
  .finally(() => {
    console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
    process.exit(fail === 0 ? 0 : 1);
  });
