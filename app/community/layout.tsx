import { PortalShell } from "@/components/portal/portal-shell";
import { getCurrentRole } from "@/lib/auth";
import { PORTAL_FOR_ROLE } from "@/lib/auth-types";

/**
 * Shared route, reachable by every role. The shell renders the VIEWER'S own
 * portal sidebar so nobody loses their navigation by visiting the community
 * wall. Auth itself is enforced in middleware.ts (see isSharedAuthedRoute).
 */
export default async function CommunityLayout({ children }: { children: React.ReactNode }) {
  const role = await getCurrentRole();
  const portal = role ? PORTAL_FOR_ROLE[role] : "employee";
  return (
    <PortalShell portal={portal} role={role}>
      {children}
    </PortalShell>
  );
}
