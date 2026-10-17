// Harness: the four dashboards now call the app's own loaders (lib/dashboard/*),
// assembled exactly as each page does; the previous copies live on, verbatim
// from git HEAD, in scripts/loadtest/before/pages.ts (LT_DASH=before).
import { readFileSync, writeFileSync } from "node:fs";
const f = "scripts/loadtest/harness.ts";
let s = readFileSync(f, "utf8");
const i = s.indexOf("// ── (b) the four dashboards' query batches");
const j = s.indexOf("const ROLES = [");
if (i < 0 || j < 0) throw new Error("markers");
s = s.slice(0, i) + `// ── (b) the four dashboards, assembled as each page does ──────────────────
// LT_DASH=before runs the pre-change loaders (verbatim from git HEAD, in
// ./before/pages.ts) so before/after are measured by the same harness.
const OLD = process.env.LT_DASH === "before";
const fail = (r: unknown) => { if (r && typeof r === "object" && "error" in r && (r as { error: unknown }).error) throw new Error(String((r as { error: unknown }).error)); return r; };
async function hrFigures() {
  const now = new Date();
  const { period } = currentPeriod(now);
  const [totals, departments] = await Promise.all([getHrDashboardTotals(period, ymd(now)), getDepartments()]);
  return { period, departmentCount: departments.length, ...totals };
}
async function adminDashboard() {
  const [, d] = OLD ? await Promise.all([before.loadTodayBefore(), before.adminBefore()]) : await Promise.all([loadToday(), loadAdminDashboard()]);
  fail(d);
}
async function hrDashboard(clerkId: string) {
  if (OLD) fail((await Promise.all([before.hrNotificationsBefore(clerkId), before.loadTodayBefore(), before.hrFiguresBefore()]))[2]);
  else await Promise.all([loadRecentNotifications(clerkId, 10), loadToday(), hrFigures()]);
}
async function managerDashboard(clerkId: string) {
  const [d] = OLD ? await Promise.all([before.managerBefore(clerkId), before.loadTodayBefore()]) : await Promise.all([loadManagerDashboard(clerkId), loadToday()]);
  if (!fail(d) || !(d as { manager: unknown }).manager) throw new Error("no manager");
}
async function employeeDashboard(clerkId: string) {
  const [d] = OLD ? await Promise.all([before.employeeBefore(clerkId), before.loadTodayBefore()]) : await Promise.all([loadEmployeeDashboard(clerkId), loadToday()]);
  if (!fail(d) || !(d as { m: unknown }).m) throw new Error("no employee");
}
` + s.slice(j);
const imp = `import { shiftCrossesMidnight } from "@/lib/attendance/validation";`;
if (!s.includes(imp)) throw new Error("import marker");
s = s.replace(imp, `${imp}
import { loadAdminDashboard } from "@/lib/dashboard/admin";
import { loadManagerDashboard } from "@/lib/dashboard/manager";
import { loadEmployeeDashboard } from "@/lib/dashboard/employee";
import { loadRecentNotifications } from "@/lib/dashboard/notifications";
import * as before from "./before/pages.ts";`);
writeFileSync(f, s);
console.log("ok");
