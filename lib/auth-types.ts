// Client-safe auth types & maps.
// IMPORTANT: this module must NEVER import a server-only module
// (Clerk's server `auth()`, `next/headers`, `@/lib/db`, etc.).
// Client components (e.g. the sidebar) import from here.

export type Role = "EMPLOYEE" | "MANAGER" | "HR" | "SUPER_ADMIN";

export const ROLES: Role[] = ["EMPLOYEE", "MANAGER", "HR", "SUPER_ADMIN"];

/**
 * Narrow an untrusted value (a Clerk session claim, a webhook payload's
 * public_metadata) to a Role, or null.
 *
 * Lives here rather than in lib/auth.ts because all three callers need it and
 * only one of them may import a server-only module: lib/auth.ts (server),
 * middleware.ts (edge runtime) and the Clerk webhook route. Three private
 * copies is how one of them silently stops recognising a role the other two
 * accept.
 */
export function coerceRole(value: unknown): Role | null {
  return ROLES.includes(value as Role) ? (value as Role) : null;
}

/** Strict hierarchy: SUPER_ADMIN > HR > MANAGER > EMPLOYEE. */
export const ROLE_RANK: Record<Role, number> = {
  EMPLOYEE: 0,
  MANAGER: 1,
  HR: 2,
  SUPER_ADMIN: 3,
};

export const ROLE_LABEL: Record<Role, string> = {
  EMPLOYEE: "Employee",
  MANAGER: "Manager",
  HR: "HR",
  SUPER_ADMIN: "Super Admin",
};

/** Portal a role lands on after sign-in. */
export const ROLE_HOME: Record<Role, string> = {
  EMPLOYEE: "/employee",
  MANAGER: "/manager",
  HR: "/hr",
  SUPER_ADMIN: "/admin",
};

export type PortalKey = "employee" | "manager" | "hr" | "admin";

/**
 * Which portal shell (and therefore which sidebar) a given role should see.
 *
 * Phase 9 added shared routes — /community and /pulse — that every role can
 * reach. They are not owned by any one portal, so their layout uses this map
 * to render the viewer's OWN sidebar, keeping their navigation intact instead
 * of dumping them into a foreign portal's chrome.
 */
export const PORTAL_FOR_ROLE: Record<Role, PortalKey> = {
  EMPLOYEE: "employee",
  MANAGER: "manager",
  HR: "hr",
  SUPER_ADMIN: "admin",
};

export const PORTAL_PREFIX: Record<PortalKey, string> = {
  employee: "/employee",
  manager: "/manager",
  hr: "/hr",
  admin: "/admin",
};

/**
 * Which roles may enter each route-group prefix.
 * Enforced in middleware.ts (route scoping) AND used by the UI.
 */
export const ROUTE_ACCESS: Record<PortalKey, Role[]> = {
  employee: ["EMPLOYEE", "MANAGER", "HR", "SUPER_ADMIN"],
  manager: ["MANAGER", "HR", "SUPER_ADMIN"],
  hr: ["HR", "SUPER_ADMIN"],
  admin: ["SUPER_ADMIN"],
};

/**
 * Resolve a pathname to its owning portal, if any.
 *
 * Driven off PORTAL_PREFIX rather than repeating the four prefix literals —
 * they were previously written twice, so adding a portal meant remembering to
 * edit both. Prefix order is PORTAL_PREFIX's insertion order, and the match is
 * a plain startsWith, exactly as before.
 */
export function portalForPath(pathname: string): PortalKey | null {
  for (const [key, prefix] of Object.entries(PORTAL_PREFIX)) {
    if (pathname.startsWith(prefix)) return key as PortalKey;
  }
  return null;
}

/** Can this role access this pathname's portal? */
export function canAccessPath(role: Role, pathname: string): boolean {
  const portal = portalForPath(pathname);
  if (!portal) return true; // non-portal routes are not role-gated here
  return ROUTE_ACCESS[portal].includes(role);
}

// ── Navigation configuration ────────────────────────────────

export type NavItem = { label: string; href: string; icon: string };

export const PORTAL_META: Record<
  PortalKey,
  { title: string; role: Role; accent: string }
> = {
  employee: { title: "Employee", role: "EMPLOYEE", accent: "info" },
  manager: { title: "Manager", role: "MANAGER", accent: "good" },
  hr: { title: "HR", role: "HR", accent: "accent" },
  admin: { title: "Super Admin", role: "SUPER_ADMIN", accent: "danger" },
};

export const NAV: Record<PortalKey, NavItem[]> = {
  employee: [
    { label: "My Dashboard", href: "/employee", icon: "LayoutDashboard" },
    { label: "My Attendance", href: "/employee/attendance", icon: "CalendarClock" },
    { label: "My Production", href: "/employee/production", icon: "Factory" },
    { label: "My Quality", href: "/employee/quality", icon: "BadgeCheck" },
    { label: "My Appraisal", href: "/employee/appraisal", icon: "Gauge" },
    { label: "Payslips & Financials", href: "/employee/payslips", icon: "Wallet" },
    { label: "Expense Claims", href: "/employee/expenses", icon: "ReceiptText" },
    { label: "My Documents", href: "/employee/documents", icon: "FileText" },
    // Self-service data export. The Employee portal's ONLY reports-adjacent
    // entry — employees still have no access to any organisation report.
    { label: "My Data", href: "/employee/my-data", icon: "DatabaseBackup" },
    { label: "My Profile", href: "/employee/profile", icon: "UserCircle" },
    { label: "Community", href: "/community", icon: "Megaphone" },
    { label: "Pulse Surveys", href: "/pulse", icon: "Activity" },
  ],
  manager: [
    { label: "Team Dashboard", href: "/manager", icon: "LayoutDashboard" },
    { label: "Team Attendance", href: "/manager/attendance", icon: "CalendarClock" },
    { label: "Production & Targets", href: "/manager/production", icon: "Target" },
    { label: "Team Quality", href: "/manager/quality", icon: "BadgeCheck" },
    { label: "Team Appraisal", href: "/manager/appraisal", icon: "Gauge" },
    { label: "Team Payroll", href: "/manager/payroll", icon: "Wallet" },
    { label: "Team Expenses", href: "/manager/expenses", icon: "ReceiptText" },
    { label: "Candidates", href: "/manager/candidates", icon: "UserSearch" },
    { label: "Reports", href: "/manager/reports", icon: "BarChart3" },
    { label: "Team Activity", href: "/manager/idle-tracking", icon: "MonitorSmartphone" },
    { label: "Warning Letters", href: "/manager/warnings", icon: "AlertTriangle" },
    { label: "Client Mail", href: "/manager/client-mail", icon: "Mail" },
    { label: "Community", href: "/community", icon: "Megaphone" },
    { label: "Pulse Surveys", href: "/pulse", icon: "Activity" },
  ],
  hr: [
    { label: "HR Dashboard", href: "/hr", icon: "LayoutDashboard" },
    { label: "Employee Master", href: "/hr/employees", icon: "Users" },
    { label: "Job Requisitions", href: "/hr/requisitions", icon: "Briefcase" },
    { label: "Candidates", href: "/hr/candidates", icon: "UserSearch" },
    { label: "Onboarding", href: "/hr/onboarding", icon: "ClipboardCheck" },
    { label: "Shifts", href: "/hr/shifts", icon: "Clock" },
    { label: "Attendance Oversight", href: "/hr/attendance", icon: "CalendarClock" },
    { label: "Salary Structure", href: "/hr/salary-structure", icon: "IndianRupee" },
    { label: "Payroll & Financials", href: "/hr/payroll", icon: "Wallet" },
    { label: "Appraisal Cycles", href: "/hr/appraisal", icon: "Gauge" },
    { label: "Warning Letters", href: "/hr/warnings", icon: "AlertTriangle" },
    { label: "Reports", href: "/hr/reports", icon: "BarChart3" },
    { label: "Compliance & Consent", href: "/hr/compliance", icon: "ShieldCheck" },
    { label: "Idle Tracking", href: "/hr/idle-tracking", icon: "MonitorSmartphone" },
    { label: "Holidays", href: "/hr/holidays", icon: "CalendarHeart" },
    { label: "Pulse Surveys", href: "/hr/pulse-surveys", icon: "Activity" },
    { label: "Community", href: "/community", icon: "Megaphone" },
  ],
  admin: [
    { label: "System Dashboard", href: "/admin", icon: "LayoutDashboard" },
    // NOTE: Super Admin's links INTO the HR portal are not listed here — see
    // CROSS_PORTAL_NAV at the bottom of this file for why they are a separate,
    // permission-filtered group rather than 16 duplicated entries.
    { label: "Roles & Permissions", href: "/admin/roles", icon: "KeyRound" },
    { label: "Organization", href: "/admin/organization", icon: "Network" },
    { label: "Payroll Finalization", href: "/admin/payroll", icon: "Lock" },
    { label: "Offer Approvals", href: "/admin/offers", icon: "FileSignature" },
    { label: "Appraisal Formula", href: "/admin/appraisal-formula", icon: "SlidersHorizontal" },
    { label: "Reports", href: "/admin/reports", icon: "BarChart3" },
    { label: "Module Toggles", href: "/admin/modules", icon: "ToggleRight" },
    { label: "Integrations", href: "/admin/integrations", icon: "Plug" },
    { label: "Audit Log", href: "/admin/audit-log", icon: "ScrollText" },
    { label: "Community", href: "/community", icon: "Megaphone" },
    { label: "Pulse Surveys", href: "/pulse", icon: "Activity" },
  ],
};

/**
 * Cross-portal shortcuts — links from one portal's sidebar into ANOTHER portal
 * the viewer is already permitted to enter.
 *
 * ─── WHY THIS EXISTS, AND WHY IT IS NOT JUST MORE NAV ENTRIES ────────────
 * ROUTE_ACCESS.hr is ["HR", "SUPER_ADMIN"], so a Super Admin may enter all 16
 * /hr routes — but NAV.admin listed none of them, leaving Employee Master
 * reachable only by typing a URL. That matters most when NO HR account exists
 * yet: onboarding the first employee is a Super Admin's bootstrapping path.
 *
 * The fix is deliberately NOT "copy HR's 16 items into NAV.admin". app/hr/
 * layout.tsx renders <PortalShell portal="hr">, so the moment a Super Admin
 * lands on any /hr route they already get HR's complete 17-item sidebar.
 * Duplicating those links would double a 12-item sidebar to ~28, and every
 * copy would lead to a page that immediately shows the real HR nav anyway.
 * Two entry points cost two rows and reach all sixteen.
 *
 * ─── VISIBILITY IS DERIVED, NOT HAND-WRITTEN ─────────────────────────────
 * crossPortalNavFor() filters through canAccessPath() — the SAME function
 * middleware.ts uses to allow or bounce the request. So a link can never be
 * shown to someone the middleware would then redirect: a real HR user viewing
 * the HR portal gets [] for the "/admin" entry because
 * canAccessPath("HR", "/admin") is false. Adding a role to ROUTE_ACCESS
 * automatically updates both the gate and the navigation, which is the
 * existing one-source-of-truth pattern in this file rather than a new
 * role-equality check invented for the sidebar.
 */
export const CROSS_PORTAL_NAV: Record<PortalKey, NavItem[]> = {
  employee: [],
  manager: [],
  // An HR user sees nothing here (canAccessPath filters /admin out); a Super
  // Admin working inside the HR portal gets their way home, so following the
  // link below is not a one-way trip.
  hr: [{ label: "Super Admin Portal", href: "/admin", icon: "ArrowRightLeft" }],
  admin: [
    // Named and iconed exactly as HR's own nav names it, so it is recognisably
    // the same page. Listed FIRST and linked directly rather than via /hr,
    // because this is the bootstrapping path and must not cost two clicks.
    { label: "Employee Master", href: "/hr/employees", icon: "Users" },
    // The other fifteen HR pages: one hop into the HR portal, whose own
    // sidebar then takes over.
    { label: "HR Portal", href: "/hr", icon: "ArrowRightLeft" },
  ],
};

/**
 * Cross-portal links for this portal, minus any the viewer may not enter.
 * `role` is nullable because PortalShell's role prop is.
 */
export function crossPortalNavFor(portal: PortalKey, role: Role | null | undefined): NavItem[] {
  if (!role) return [];
  return CROSS_PORTAL_NAV[portal].filter((item) => canAccessPath(role, item.href));
}
