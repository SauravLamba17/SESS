import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { UserProfile } from "@clerk/nextjs";
import { Logo } from "@/components/brand/logo";
import { getRealIdentity } from "@/lib/auth";
import { ROLE_HOME } from "@/lib/auth-types";

export const dynamic = "force-dynamic";

/**
 * Account & security, hosted by Clerk's own <UserProfile>.
 *
 * This is where any user can enable a second factor on their own account if
 * they want one. Nothing in this app requires or enforces it — MFA enforcement
 * was removed. Deliberately Clerk's component and not a hand-rolled form:
 * TOTP secrets and backup codes must never pass through this application.
 *
 * Optional catch-all segment because UserProfile owns its own sub-routes.
 */
export default async function AccountPage() {
  const { realRole } = await getRealIdentity();
  const home = realRole ? ROLE_HOME[realRole] : "/";

  return (
    <main className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-6">
        <div className="flex w-full items-center justify-between gap-4">
          <Logo size={28} />
          <Link
            href={home}
            className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ArrowLeft size={13} />
            Back to portal
          </Link>
        </div>
        <UserProfile routing="hash" />
      </div>
    </main>
  );
}
