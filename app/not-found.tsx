import Link from "next/link";
import { Compass, LayoutDashboard } from "lucide-react";
import { Logo } from "@/components/brand/logo";

/**
 * 404. Deliberately says nothing about whether the path exists but is
 * forbidden versus simply does not exist — probing for valid routes should
 * learn nothing from the difference.
 *
 * The "dashboard" link points at "/", which already routes each role to its
 * own portal home, so this page needs no role lookup and stays static.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo size={30} />
        </div>
        <div className="rounded border border-border bg-surface p-6 text-center shadow-panel sm:p-8">
          <div className="mb-3 flex justify-center">
            <Compass size={26} className="text-text-muted" />
          </div>
          <p className="font-mono text-3xl font-semibold tracking-tight text-text">404</p>
          <h1 className="mt-2 text-base font-bold text-text">Page not found</h1>
          <p className="mt-1.5 text-sm text-text-muted">
            That page doesn&apos;t exist, or the link that brought you here is out
            of date.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <LayoutDashboard size={15} />
            Return to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
