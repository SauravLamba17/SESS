/**
 * Fix batch 2026-10-28 — DB-free proof for the low-severity QA fixes.
 *
 * Pure functions are called for real; UI-only changes are checked in the
 * source, so a revert of any fix fails here. No database, no server.
 *
 * Run:  node prisma/verify-fix-batch.ts
 */
import fs from "node:fs";
import path from "node:path";
import { validatePunch, readableReviewReason } from "../lib/attendance/validation.ts";
import { timeEfficiency, formatEfficiency } from "../lib/time-efficiency.ts";
import { computeHeadcount } from "../lib/reports/headcount.ts";
import { parseRange } from "../lib/reports/range.ts";
import { fieldLabels, REDACTED_FIELDS, PRESERVED_FIELDS } from "../lib/employees/retention.ts";
import { clockHHMM, formatDate, formatClock } from "../lib/time-display.ts";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n        ${detail}` : ""}`);
}
const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const src = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

// ── L1: correcting the clock-out leaves the clock-in's seconds alone ──
console.log("\n── L1 attendance correction keeps unchanged times");
const route = src("app/api/hr/attendance/correct/route.ts");
check("check-in only re-parsed when its HH:MM changed", route.includes("checkInRaw && checkInRaw !== clockHHMM(row.checkIn)"));
check("check-out only re-parsed when its HH:MM changed", route.includes("checkOutRaw && checkOutRaw !== clockHHMM(row.checkOut)"));
const live = new Date("2026-10-27T13:23:06.702Z"); // Two's real 27 Oct punch
check("the form's pre-filled value equals clockHHMM of the stored time (18:53)", clockHHMM(live) === "18:53", String(clockHHMM(live)));

// ── L2: an expired pulse survey is shown as Closed ──
console.log("\n── L2 pulse survey past its close date");
const pulse = src("app/hr/pulse-surveys/page.tsx");
check("Open means active AND not past the close date", pulse.includes("const open = s.active && !expired;") && pulse.includes('title={open ? "Open" : "Closed"}'));
check("no Close button on an expired survey", pulse.includes("{!expired && <SurveyToggleButton"));

// ── L3/L4: help text in plain English ──
console.log("\n── L3/L4 leftover technical help text");
const banned: [string, string[]][] = [
  ["app/hr/shifts/page.tsx", ["lateFlag", "hard-deleted", "orphaned"]],
  ["app/hr/employees/page.tsx", ["soft-delete"]],
  ["app/hr/idle-tracking/page.tsx", ["Consent-gated", "IDLE_TRACKING"]],
  ["app/hr/appraisal/page.tsx", ["snapshotted"]],
  ["app/admin/integrations/page.tsx", ["/api/webhooks/clerk", "CLERK_WEBHOOK_SECRET not set", "DATABASE_URL not configured"]],
  ["components/admin/appraisal-formula-form.tsx", ["`configured (${source})`"]],
  ["components/hr/agent-token-manager.tsx", ["IDLE_TRACKING"]],
  ["lib/reports/board-summary.ts", ["(FINALIZED only)\""]],
];
for (const [file, words] of banned)
  for (const w of words) check(`${file} no longer shows "${w}"`, !src(file).includes(w));
const labels = fieldLabels([...REDACTED_FIELDS, ...PRESERVED_FIELDS]);
check("retention page field names are plain words", !labels.some((l) => /[a-z][A-Z]/.test(l)), labels.join(", "));
check("formula page: company-wide label unless a department is chosen", src("components/admin/appraisal-formula-form.tsx").includes('source === "department" && department'));
check("retention page uses the labels", src("app/hr/employees/retention-review/page.tsx").includes("fieldLabels(REDACTED_FIELDS)"));

// ── L5: offboarded employees see a read-only banner ──
console.log("\n── L5 read-only banner");
for (const f of ["app/employee/layout.tsx", "app/community/layout.tsx", "app/pulse/layout.tsx"])
  check(`${f} renders <OffboardedBanner />`, src(f).includes("<OffboardedBanner />"));
check("banner only for inactive employees", src("components/employee/offboarded-banner.tsx").includes("active: false"));

// ── L6: last opening filled → requisition closes ──
console.log("\n── L6 job closes when all openings are filled");
const offer = src("app/api/hr/offer/status/route.ts");
check("hire counts HIRED applications against openings", offer.includes("hired >= req.openings"));
check("closes it inside the hire transaction, with an audit row", offer.includes('data: { status: "CLOSED", closedAt: new Date() }') && offer.includes("opening(s) filled"));

// ── L7: future joining date ──
console.log("\n── L7 future joiner");
check("onboarding says 'joins' for a future date", src("app/hr/onboarding/page.tsx").includes('e.joiningDate > new Date() ? "joins" : "joined"'));
const oct = parseRange("2026-10-01", "2026-10-31");
if (!oct.ok) throw new Error("range");
const emp = (id: string, joiningDate: Date) => ({ id, name: id, employeeCode: id, department: "QA", active: true, joiningDate, offboardedAt: null });
const hc = computeHeadcount([emp("a", new Date(2026, 9, 1)), emp("future", new Date(2026, 10, 2))], oct.range, new Date(2026, 9, 28));
check("headcount on 28 Oct excludes someone joining 2 Nov", hc.totalActive === 1, String(hc.totalActive));
check("Who's In Today and HR active count skip future joiners",
  src("lib/engagement/today.ts").includes(`e."joiningDate" <= now()`) && src("lib/cache/dashboard.ts").includes(`"joiningDate" <= now()`));
check("shout-out list skips future joiners", src("app/community/page.tsx").includes("joiningDate: { lte: new Date() }"));

// ── L8: accept form closes after the hire ──
console.log("\n── L8 offer accept form");
check("form state cleared on a recorded response", src("components/hr/offer-panel.tsx").includes("setResponding(null);\n        setAttestedName(\"\");") || src("components/hr/offer-panel.tsx").includes("setResponding(null);\r\n        setAttestedName(\"\");"));

// ── L9: names, not account ids ──
console.log("\n── L9 raw account ids");
check("My Quality shows the reviewer's name", src("app/employee/quality/page.tsx").includes("data.reviewers.get(r.reviewedBy)"));
check("Roles page shows a name, id only on hover", src("app/admin/roles/page.tsx").includes("title={u.clerkId}"));
check("Audit log shows actor names and IST time", src("app/admin/audit-log/page.tsx").includes("actorNames?.get(r.actorUserId)") && src("app/admin/audit-log/page.tsx").includes("Time (IST)"));

// ── L10: appraisal labels ──
console.log("\n── L10 appraisal labels");
const appr = src("app/employee/appraisal/page.tsx");
check("weights read '20% of your score', not '(w20)'", appr.includes("% of your score)") && !appr.includes("(w{d?.weight"));
check("warning count shown as 'N on record', never 'N × 0.00'", appr.includes("on record)`") && !appr.includes("deducted)`"));
check("no '(0 × 0.00)' penalty when there are no warnings", appr.includes('"(none)"') && appr.includes('"no deduction"'));

// ── L11: clock-in validation wording ──
console.log("\n── L11 validation messages");
const saved = { ...process.env };
process.env.ALLOWED_IPS = "";
delete process.env.OFFICE_LAT;
const both = validatePunch({ ip: "1.2.3.4", lat: null, long: null, at: new Date() }, "BOTH");
check("no setting names in messages", !both.failures.join(" ").match(/ALLOWED_IPS|OFFICE_LAT|GEOFENCE_RADIUS|allowlist|geofence/i), both.failures.join(" | "));
process.env.ALLOWED_IPS = "10.0.0.1";
const outside = validatePunch({ ip: "1.2.3.4", lat: null, long: null, at: new Date() }, "IP_LOCK");
check("outside-network message is plain", outside.failures[0] === "Punched from a network outside the office (1.2.3.4)", outside.failures[0]);
Object.assign(process.env, saved);
const shown = readableReviewReason("IP validation enabled but ALLOWED_IPS is not configured; Geofence validation enabled but OFFICE_LAT/OFFICE_LONG/GEOFENCE_RADIUS_METERS are not fully configured; IP validation enabled but ALLOWED_IPS is not configured; Geofence validation enabled but OFFICE_LAT/OFFICE_LONG/GEOFENCE_RADIUS_METERS are not fully configured");
check("old stored reason (One's 18 Oct row) displays plainly, each once", shown === "Office network check is on, but no office network has been set up yet; Office location check is on, but the office location hasn't been set up yet", shown);
check("old allowlist reason keeps its IP", readableReviewReason("IP 1.2.3.4 is not in the allowlist") === "Punched from a network outside the office (1.2.3.4)");
check("both attendance pages use the readable form", src("app/hr/attendance/page.tsx").includes("readableReviewReason(r.reviewReason)") && src("app/manager/attendance/page.tsx").includes("readableReviewReason(a.reviewReason)"));
check("repeated reasons are stored once", src("app/api/attendance/punch/route.ts").includes("new Set([existing.reviewReason, reviewReason]"));

// ── L12: other low items ──
console.log("\n── L12 other low items");
const t0 = new Date("2026-10-18T01:00:00Z");
check("14-second punch pair → no units/hr ('—')", formatEfficiency(timeEfficiency(42, t0, new Date(t0.getTime() + 14_000))) === "—");
check("8-hour shift → real units/hr", timeEfficiency(80, t0, new Date(t0.getTime() + 8 * 3_600_000)) === 10);
check("manager late list names the punch's own employee", src("app/manager/attendance/page.tsx").includes('{!a.employee.active && " (left)"}'));
check("warning release needs a confirm click", src("components/hr/release-button.tsx").includes("Confirm release"));
check("careers terms tab title has no duplicate 'SESS'", src("app/careers/terms/page.tsx").includes('title: "Careers Terms & Conditions"'));

// ── L13: dates and times never depend on the machine's locale ──
// An unpinned toLocale*String printed "18 Oct 2026" on the server and
// "Oct 18, 2026" in the browser: a hydration error in the notification panel.
console.log("\n── L13 pinned date/time/number formatting");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(rel);
  }
  return out;
}
const unpinned = ["app", "components", "lib"]
  .flatMap((d) => walk(d))
  .filter((f) => /toLocale(Date|Time)?String\(\s*(\[\]|undefined)?\s*[,)]/.test(src(f).replace(/^\s*(\*|\/\/).*$/gm, "")));
check("no toLocale*String without an explicit locale in app/components/lib", unpinned.length === 0, unpinned.join(", "));
const oct18 = new Date("2026-10-17T18:30:00Z");
check("formatDate → 18 Oct 2026 (IST) for an 18 Oct row", formatDate(oct18) === "18 Oct 2026", formatDate(oct18));
const twoIn = new Date("2026-10-18T14:28:26Z");
check("formatClock → 07:58 PM for Two's 18 Oct punch", formatClock(twoIn) === "07:58 PM", formatClock(twoIn));

console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
if (fail > 0) process.exitCode = 1;
