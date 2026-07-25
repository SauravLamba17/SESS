import { UserButton } from "@clerk/nextjs";
import { Sidebar } from "@/components/portal/sidebar";
import { GlobalSearch } from "@/components/portal/global-search";
import { StatusDot } from "@/components/ui/status-dot";
import { getImpersonation } from "@/lib/auth";
import { stopImpersonation } from "@/app/admin/impersonate/actions";
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
export async function PortalShell({
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
  const imp = await getImpersonation();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {imp && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-danger/40 bg-danger/15 px-4 py-2 text-sm lg:gap-3 lg:px-6">
          <span className="inline-flex items-center gap-2 text-danger">
            <StatusDot state="danger" />
            Viewing as {ROLE_LABEL[imp.role]} — {imp.code}/{imp.name}
          </span>
          <form action={stopImpersonation}>
            <button
              type="submit"
              className="rounded border border-danger/50 px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
            >
              Return to Super Admin
            </button>
          </form>
        </div>
      )}

      {/* Below lg the shell stacks (nav strip on top, content beneath) and the
          page scrolls as one document; from lg it is the original two-column
          layout with an independently scrolling main pane. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <Sidebar portal={portal} />

        <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <StatusDot state="good" />
            {/* The portal name is already on the nav strip on mobile. */}
            <span className="hidden truncate text-sm font-medium text-text sm:inline">
              {meta.title} Portal
            </span>
          </div>
          <div className="flex items-center gap-3 lg:gap-4">
            {/* Role-scoped server-side by /api/search — reachable from all
                four portals because this shell is shared by all four. */}
            <GlobalSearch />
            {/* Role chip is a nicety, not information the user lacks — dropped
                on the narrowest screens to keep the topbar from wrapping. */}
            <span className="hidden rounded border border-border bg-surface-raised px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-text-muted sm:inline">
              {roleLabel}
            </span>
            <UserButton
              appearance={{ elements: { avatarBox: "h-7 w-7" } }}
            />
          </div>
        </header>

          <main className="flex-1 px-4 py-5 lg:overflow-y-auto lg:px-6 lg:py-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

// Re-exported for the many server pages that import PageHeader from here.
// The client-safe definition lives in ./page-header (portal-shell itself pulls
// server-only code via the impersonation banner, so client components must
// import PageHeader from ./page-header directly).
export { PageHeader } from "./page-header";
