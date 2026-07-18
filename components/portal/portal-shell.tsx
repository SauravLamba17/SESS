import { UserButton } from "@clerk/nextjs";
import { Sidebar } from "@/components/portal/sidebar";
import { StatusDot } from "@/components/ui/status-dot";
import {
  PORTAL_META,
  ROLE_LABEL,
  type PortalKey,
  type Role,
} from "@/lib/auth-types";

/**
 * Shared shell for all four portals: logo + role-scoped sidebar + topbar.
 * The single layout that visually unifies the product.
 */
export function PortalShell({
  portal,
  role,
  children,
}: {
  portal: PortalKey;
  role?: Role | null;
  children: React.ReactNode;
}) {
  const meta = PORTAL_META[portal];
  const roleLabel = role ? ROLE_LABEL[role] : ROLE_LABEL[meta.role];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar portal={portal} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
          <div className="flex items-center gap-2.5">
            <StatusDot state="good" />
            <span className="text-sm font-medium text-text">
              {meta.title} Portal
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="rounded border border-border bg-surface-raised px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-text-muted">
              {roleLabel}
            </span>
            <UserButton
              appearance={{ elements: { avatarBox: "h-7 w-7" } }}
            />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </div>
  );
}

/** Standard page header used inside portal content. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold text-text">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-text-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
