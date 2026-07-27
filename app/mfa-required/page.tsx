import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert, ExternalLink, RefreshCw } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { Logo } from "@/components/brand/logo";
import { mfaStatus } from "@/lib/mfa";
import { ROLE_HOME, ROLE_LABEL } from "@/lib/auth-types";

export const dynamic = "force-dynamic";

/**
 * The MFA setup gate for HR and Super Admin.
 *
 * Re-checks live on every load, so the moment the user enables a second factor
 * in Clerk's own account UI and returns here, they are sent on to their portal
 * — no sign-out required. This is also why the page is force-dynamic.
 */
export default async function MfaRequiredPage() {
  const status = await mfaStatus();

  // Already satisfied (or not required at all) → nothing to do here.
  if (status.satisfied) {
    redirect(status.realRole ? ROLE_HOME[status.realRole] : "/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex justify-center">
          <Logo size={32} />
        </div>

        <Panel className="p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <ShieldAlert size={22} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <h1 className="text-lg font-bold text-text">
                Two-factor authentication is required
              </h1>
              <p className="mt-1 text-sm text-text-muted">
                Your role
                {status.realRole ? (
                  <>
                    {" "}
                    (<span className="text-text">{ROLE_LABEL[status.realRole]}</span>)
                  </>
                ) : null}{" "}
                can view and change payroll, salary structures and personal
                employee records. Accounts with that reach must be protected by a
                second factor before they can be used.
              </p>
            </div>
          </div>

          <div className="mt-5 rounded border border-border bg-surface-raised/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Setting it up — about a minute
            </p>
            <ol className="mt-3 space-y-3 text-sm text-text-muted">
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[11px] text-text">
                  1
                </span>
                <span>
                  <Link
                    href="/account"
                    className="text-accent underline underline-offset-2 hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Go to your account security settings
                  </Link>{" "}
                  — or use the button below.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[11px] text-text">
                  2
                </span>
                <span>
                  In the <span className="text-text">Security</span> section,
                  find the two-factor authentication option.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[11px] text-text">
                  3
                </span>
                <span>
                  Choose an{" "}
                  <span className="text-text">authenticator app</span>{" "}
                  (recommended — works offline) or{" "}
                  <span className="text-text">SMS</span>.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[11px] text-text">
                  4
                </span>
                <span>
                  Follow the prompts to finish setup, and save your backup codes
                  somewhere safe.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[11px] text-text">
                  5
                </span>
                <span>
                  Come back here — or just try your portal again.{" "}
                  <span className="text-good">
                    Access is restored automatically; there&apos;s no need to
                    sign out and back in.
                  </span>
                </span>
              </li>
            </ol>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {/* Clerk's own hosted account page — this app never handles the
                factor setup itself, so no secret passes through SESS. */}
            <Link
              href="/account"
              className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ExternalLink size={15} />
              Open security settings
            </Link>
            <Link
              href="/mfa-required"
              className="inline-flex items-center gap-2 rounded border border-border px-4 py-2 text-sm text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <RefreshCw size={15} />
              I&apos;ve enabled it — re-check
            </Link>
          </div>

          {/* `warn`, not `danger` — nothing has gone wrong, this is a setup
              step the user has not done yet. */}
          <div className="mt-5 flex items-center gap-2 border-t border-border pt-4">
            <StatusDot state={status.factors.totp ? "good" : "warn"} />
            <span className="text-xs text-text-muted">
              Authenticator app:{" "}
              <span className="font-mono text-text">
                {status.factors.totp ? "enabled" : "not set up"}
              </span>
              {" · "}
              Backup codes:{" "}
              <span className="font-mono text-text">
                {status.factors.backupCode ? "enabled" : "not set up"}
              </span>
            </span>
          </div>

          <p className="mt-4 text-xs text-text-muted">
            Managers and employees are not affected by this requirement — it
            applies only to roles with access to payroll and organisation-wide
            personal data.
          </p>
        </Panel>
      </div>
    </div>
  );
}
