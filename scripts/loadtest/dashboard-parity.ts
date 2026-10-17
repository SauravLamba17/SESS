// Dashboard parity + query count — TEST DATABASE ONLY, read-only. Through lt-run.mjs:
//   node --import ./scripts/loadtest/register.mjs scripts/loadtest/dashboard-parity.ts
// Env: LT_NOW=<ISO instant> pins the clock (both old and new code read new Date());
//      LT_CACHE=on also measures the cache-warm statement count (2nd load per user).
//
// For every Super Admin, HR and Manager account and a sample of employees, it runs
// the OLD loaders (scripts/loadtest/before/, verbatim from git HEAD) and the NEW
// ones (lib/dashboard/*) against the same data, deep-compares what each returns,
// and counts the SQL statements and round trips each dashboard load issued.
process.env.TZ = "Asia/Kolkata";
export {};

if (process.env.LT_NOW) {
  const FIXED = new Date(process.env.LT_NOW).getTime();
  const Real = Date;
  class Fixed extends Real {
    constructor(...a: unknown[]) { if (a.length === 0) super(FIXED); else super(...(a as [number])); }
    static now() { return FIXED; }
  }
  globalThis.Date = Fixed as DateConstructor;
}

const { client, queryEvents, pct } = await import("./ltdb.ts");
const { instanceStore } = await import("./db-proxy.ts");
const before = await import("./before/pages.ts");
const { loadAdminDashboard } = await import("@/lib/dashboard/admin");
const { loadManagerDashboard } = await import("@/lib/dashboard/manager");
const { loadEmployeeDashboard } = await import("@/lib/dashboard/employee");
const { loadRecentNotifications } = await import("@/lib/dashboard/notifications");
const { loadToday } = await import("@/lib/engagement/today");
const { getHrDashboardTotals } = await import("@/lib/cache/dashboard");
const { getDepartments } = await import("@/lib/cache/departments");
const { currentPeriod } = await import("@/lib/period");
const { ymd } = await import("@/lib/reports/range");

type C = ReturnType<typeof client>;
const boot = client({ connectionLimit: 1 });
const users = await boot.user.findMany({ include: { employee: true }, orderBy: { clerkId: "asc" } });
await boot.$disconnect();
const active = (r: string) => users.filter((u) => u.role === r && u.employee?.active);
const people = [
  ...users.filter((u) => u.role === "SUPER_ADMIN").map((u) => ({ role: "SUPER_ADMIN", clerkId: u.clerkId })),
  ...active("HR").map((u) => ({ role: "HR", clerkId: u.clerkId })),
  ...active("MANAGER").map((u) => ({ role: "MANAGER", clerkId: u.clerkId })),
  ...active("EMPLOYEE").slice(0, 10).map((u) => ({ role: "EMPLOYEE", clerkId: u.clerkId })),
];

// The HR page's own load(): the two cached lib reads it awaits (app/hr/page.tsx).
async function hrFiguresAfter() {
  const now = new Date();
  const { period } = currentPeriod(now);
  const [totals, departments] = await Promise.all([getHrDashboardTotals(period, ymd(now)), getDepartments()]);
  return { error: null, period, departmentCount: departments.length, ...totals };
}
// One full dashboard load, as each page assembles it (all in one Promise.all).
const OLD: Record<string, (id: string) => Promise<unknown>> = {
  SUPER_ADMIN: () => Promise.all([before.loadTodayBefore(), before.adminBefore()]),
  HR: (id) => Promise.all([before.hrNotificationsBefore(id), before.loadTodayBefore(), before.hrFiguresBefore()]),
  MANAGER: (id) => Promise.all([before.managerBefore(id), before.loadTodayBefore()]),
  EMPLOYEE: (id) => Promise.all([before.employeeBefore(id), before.loadTodayBefore()]),
};
const NEW: Record<string, (id: string) => Promise<unknown>> = {
  SUPER_ADMIN: () => Promise.all([loadToday(), loadAdminDashboard()]),
  HR: (id) => Promise.all([loadRecentNotifications(id, 10), loadToday(), hrFiguresAfter()]),
  MANAGER: (id) => Promise.all([loadManagerDashboard(id), loadToday()]),
  EMPLOYEE: (id) => Promise.all([loadEmployeeDashboard(id), loadToday()]),
};

/** Runs one load on client c; returns its result and its statement / round-trip counts. */
async function measured(c: C, fn: () => Promise<unknown>) {
  const ev = queryEvents.get(c)!, i0 = ev.length;
  const v = await instanceStore.run(c, fn);
  await new Promise((r) => setTimeout(r, 20));
  const mine = ev.slice(i0);
  return { v, q: mine.filter((e) => !e.wrap).length, rt: mine.reduce((a, e) => a + (e.wrap ? 1 : 2), 0) };
}

// Canonical JSON: Maps as sorted entries, Dates as ISO, and the few lists whose
// order the database never promised (groupBy output, ties on a sort key)
// sorted by a stable key. Ordered lists (presence, notifications) are left as is.
const byKey = (k: (x: never) => string) => (a: unknown, b: unknown) => (k(a as never) < k(b as never) ? -1 : 1);
function canon(v: unknown): string {
  return JSON.stringify(v, function (key, val) {
    const raw = (this as Record<string, unknown>)[key];
    if (raw instanceof Date) return raw.toISOString();
    if (val instanceof Map) return Object.fromEntries([...val.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
    if (Array.isArray(val)) {
      if (key === "roleRows") return [...val].sort(byKey((x: { role: string }) => x.role));
      if (key === "submittedPayroll") return [...val].sort(byKey((x: { month: string }) => x.month));
      if (key === "lateToday") return [...val].sort(byKey((x: { lateMinutes: number; id: string }) => `${String(9999 - (x.lateMinutes ?? 0)).padStart(4, "0")}${x.id}`));
      if (key === "onLeaveToday" || key === "byDepartment") return [...val].sort(byKey((x: object) => JSON.stringify(x)));
    }
    return val;
  });
}
/**
 * The System Dashboard's two LIMIT-10 lists (late today, on leave today) sort on
 * a key that can tie, and neither the old Prisma query nor the new SQL breaks
 * ties — so when tied rows straddle the 10-row cut, either may return a
 * different subset of them. Equal means: the same sort-key sequence, the same
 * length, and identical rows for every id both returned. The lists are then
 * removed so the rest of the payload is compared byte for byte.
 */
function limitedListsAgree(o: unknown, n: unknown) {
  const od = (o as unknown[])[1] as Record<string, { id: string }[]>, nd = (n as unknown[])[1] as Record<string, { id: string }[]>;
  const out: Record<string, unknown> = { ok: true };
  for (const [key, sortKey] of [["lateToday", "lateMinutes"], ["onLeaveToday", "startDate"]] as const) {
    const a = od[key] ?? [], b = nd[key] ?? [];
    const keys = (xs: Record<string, unknown>[]) => canon(xs.map((x) => x[sortKey]));
    const nById = new Map(b.map((x) => [x.id, x]));
    const common = a.filter((x) => nById.has(x.id));
    const rowsEqual = common.every((x) => canon(x) === canon(nById.get(x.id)));
    const ok = a.length === b.length && keys(a as never) === keys(b as never) && rowsEqual;
    out[key] = { rows: a.length, commonIds: common.length, sortKeysEqual: keys(a as never) === keys(b as never), commonRowsEqual: rowsEqual };
    if (!ok) out.ok = false;
    delete od[key]; delete nd[key];
  }
  ties.push(out);
  return out as { ok: boolean };
}
const ties: unknown[] = [];

function firstDiff(a: string, b: string) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return { at: i, old: a.slice(Math.max(0, i - 80), i + 80), new: b.slice(Math.max(0, i - 80), i + 80) };
}

const cache = process.env.LT_CACHE === "on";
const counts: Record<string, Record<string, { q: number[]; rt: number[] }>> = {};
const add = (role: string, k: string, m: { q: number; rt: number }) => {
  const r = (counts[role] ??= {}), x = (r[k] ??= { q: [], rt: [] });
  x.q.push(m.q); x.rt.push(m.rt);
};
const pool = Array.from({ length: 8 }, () => client({ connectionLimit: 1, poolTimeout: 60, countQueries: true }));
let next = 0, same = 0;
const mismatches: unknown[] = [];
await Promise.all(pool.map(async (c) => {
  while (next < people.length) {
    const p = people[next++];
    const o = await measured(c, () => OLD[p.role](p.clerkId));
    const n = await measured(c, () => NEW[p.role](p.clerkId));
    add(p.role, "before", o); add(p.role, "after", n);
    const tie = p.role === "SUPER_ADMIN" ? limitedListsAgree(o.v, n.v) : null;
    if (tie && !tie.ok) mismatches.push({ role: p.role, clerkId: p.clerkId, limitedLists: tie });
    else if (canon(o.v) === canon(n.v)) same++;
    else mismatches.push({ role: p.role, clerkId: p.clerkId, ...firstDiff(canon(o.v), canon(n.v)) });
    if (cache) {
      // Second load of each: whatever the cache tier now holds is a hit.
      const o2 = await measured(c, () => OLD[p.role](p.clerkId));
      const n2 = await measured(c, () => NEW[p.role](p.clerkId));
      add(p.role, "beforeWarm", o2); add(p.role, "afterWarm", n2);
      // The cold result's LIMIT-10 lists were already checked and removed above.
      if (tie) for (const k of ["lateToday", "onLeaveToday"]) delete ((n2.v as unknown[])[1] as Record<string, unknown>)[k];
      if (canon(n2.v) !== canon(n.v)) mismatches.push({ role: p.role, clerkId: p.clerkId, note: "warm (cached) result differs from cold", ...firstDiff(canon(n.v), canon(n2.v)) });
    }
  }
}));
await Promise.all(pool.map((c) => c.$disconnect()));

const sum = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { p50: pct(s, 50), max: s.at(-1) }; };
console.log(JSON.stringify({
  clock: process.env.LT_NOW ?? "real",
  cache: cache ? "measured cold and warm" : "off (every load is a cache miss)",
  loadsCompared: people.length,
  identical: same,
  mismatches,
  limitedLists: ties,
  statementsPerDashboard: Object.fromEntries(Object.entries(counts).map(([role, r]) => [role, Object.fromEntries(Object.entries(r).map(([k, x]) => [k, { statements: sum(x.q), roundTrips: sum(x.rt) }]))])),
}, null, 1));
