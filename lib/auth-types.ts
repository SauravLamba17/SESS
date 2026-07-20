// Client-safe auth types & maps.
// IMPORTANT: this module must NEVER import a server-only module
// (Clerk's server `auth()`, `next/headers`, `@/lib/db`, etc.).
// Client components (e.g. the sidebar) import from here.

export type Role = "EMPLOYEE" | "MANAGER" | "HR" | "SUPER_ADMIN";

export const ROLES: Role[] = ["EMPLOYEE", "MANAGER", "HR", "SUPER_ADMIN"];

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

/** Resolve a pathname to its owning portal, if any. */
export function portalForPath(pathname: string): PortalKey | null {
  if (pathname.startsWith("/employee")) return "employee";
  if (pathname.startsWith("/manager")) return "manager";
  if (pathname.startsWith("/hr")) return "hr";
  if (pathname.startsWith("/admin")) return "admin";
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
    { label: "My Documents", href: "/employee/documents", icon: "FileText" },
    { label: "My Profile", href: "/employee/profile", icon: "UserCircle" },
  ],
  manager: [
    { label: "Team Dashboard", href: "/manager", icon: "LayoutDashboard" },
    { label: "Team Attendance", href: "/manager/attendance", icon: "CalendarClock" },
    { label: "Production & Targets", href: "/manager/production", icon: "Target" },
    { label: "Team Quality", href: "/manager/quality", icon: "BadgeCheck" },
    { label: "Team Appraisal", href: "/manager/appraisal", icon: "Gauge" },
    { label: "Team Payroll", href: "/manager/payroll", icon: "Wallet" },
    { label: "Warning Letters", href: "/manager/warnings", icon: "AlertTriangle" },
    { label: "Client Mail", href: "/manager/client-mail", icon: "Mail" },
  ],
  hr: [
    { label: "HR Dashboard", href: "/hr", icon: "LayoutDashboard" },
    { label: "Employee Master", href: "/hr/employees", icon: "Users" },
    { label: "Shifts", href: "/hr/shifts", icon: "Clock" },
    { label: "Attendance Oversight", href: "/hr/attendance", icon: "CalendarClock" },
    { label: "Payroll & Financials", href: "/hr/payroll", icon: "Wallet" },
    { label: "Appraisal Cycles", href: "/hr/appraisal", icon: "Gauge" },
    { label: "Warning Letters", href: "/hr/warnings", icon: "AlertTriangle" },
    { label: "Compliance & Consent", href: "/hr/compliance", icon: "ShieldCheck" },
  ],
  admin: [
    { label: "System Dashboard", href: "/admin", icon: "LayoutDashboard" },
    { label: "Roles & Permissions", href: "/admin/roles", icon: "KeyRound" },
    { label: "Appraisal Formula", href: "/admin/appraisal-formula", icon: "SlidersHorizontal" },
    { label: "Module Toggles", href: "/admin/modules", icon: "ToggleRight" },
    { label: "Machines & Assets", href: "/admin/machines", icon: "Cpu" },
    { label: "Audit Log", href: "/admin/audit", icon: "ScrollText" },
  ],
};
