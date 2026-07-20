import Link from "next/link";
import { Logo } from "@/components/brand/logo";

/**
 * Public careers layout — deliberately NOT the portal shell.
 *
 * No sidebar, no role badge, no impersonation banner, no user button: nothing
 * that would query Clerk or leak the existence of the internal app. A visitor
 * here is a stranger, and this layout assumes exactly that.
 */
export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <Link href="/careers" className="flex items-center gap-3">
            <Logo size={26} />
          </Link>
          <span className="text-xs uppercase tracking-[0.18em] text-text-muted">
            Careers
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">{children}</main>

      <footer className="mx-auto max-w-4xl px-6 pb-10 pt-4">
        <p className="border-t border-border pt-4 text-xs text-text-muted">
          Simplen is an equal-opportunity employer. Applications are reviewed by
          our people — every resume is read by a person, not scored by software.
        </p>
      </footer>
    </div>
  );
}
