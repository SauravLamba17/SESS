import Link from "next/link";
import { redirect } from "next/navigation";
import { getEffectiveUserId } from "@/lib/auth";
import { SignInButton } from "@clerk/nextjs";
import { getCurrentRole } from "@/lib/auth";
import { ROLE_HOME, ROLE_LABEL } from "@/lib/auth-types";
import { Logo } from "@/components/brand/logo";
import { StatusDot } from "@/components/ui/status-dot";

export default async function LandingPage() {
  const userId = await getEffectiveUserId();

  // Signed in with a role → send to the matching portal.
  if (userId) {
    const role = await getCurrentRole();
    if (role) redirect(ROLE_HOME[role]);
  }

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <Logo />
        {userId ? (
          <Link
            href="/employee"
            className="rounded border border-border bg-surface-raised px-3 py-1.5 text-sm text-text hover:border-accent"
          >
            Open portal
          </Link>
        ) : (
          <SignInButton mode="modal">
            <button className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-background hover:opacity-90">
              Sign in
            </button>
          </SignInButton>
        )}
      </header>

      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-6 py-16">
        <div className="mb-4 inline-flex items-center gap-2 self-start rounded border border-border bg-surface px-3 py-1 text-xs text-text-muted">
          <StatusDot state="good" />
          Precision workforce measurement
        </div>

        <h1 className="max-w-3xl text-4xl font-bold leading-tight text-text sm:text-5xl">
          Attendance, production, quality and payroll —{" "}
          <span className="text-accent">measured, not guessed.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-text-muted">
          SESS pairs camera-verified attendance, system idle-time tracking and
          per-machine performance averages with a quality-linked production
          appraisal formula. One app, four role-scoped portals.
        </p>

        {userId && (
          <p className="mt-4 text-sm text-text-muted">
            You&apos;re signed in but no role is set on your account yet. Ask an
            administrator to assign a role in Clerk.
          </p>
        )}

        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["EMPLOYEE", "MANAGER", "HR", "SUPER_ADMIN"] as const).map((r) => (
            <div key={r} className="rounded border border-border bg-surface p-4">
              <div className="mb-2 flex items-center gap-2">
                <StatusDot state="idle" />
                <span className="font-mono text-[11px] uppercase tracking-wide text-text-muted">
                  {r}
                </span>
              </div>
              <p className="text-sm text-text">{ROLE_LABEL[r]} portal</p>
              <p className="mt-1 font-mono text-xs text-text-muted">
                {ROLE_HOME[r]}
              </p>
            </div>
          ))}
        </div>
      </div>

      <footer className="border-t border-border px-6 py-4 text-xs text-text-muted">
        SESS · Simplen Employee Self-Service
      </footer>
    </main>
  );
}
