"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarClock,
  Factory,
  BadgeCheck,
  Gauge,
  Wallet,
  FileText,
  Target,
  AlertTriangle,
  Users,
  ShieldCheck,
  KeyRound,
  SlidersHorizontal,
  ToggleRight,
  ScrollText,
  UserCircle,
  Mail,
  Clock,
  ReceiptText,
  IndianRupee,
  Lock,
  Briefcase,
  UserSearch,
  ClipboardCheck,
  FileSignature,
  Megaphone,
  Activity,
  CalendarHeart,
  MonitorSmartphone,
  Network,
  Plug,
  BarChart3,
  DatabaseBackup,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV, PORTAL_META, type PortalKey } from "@/lib/auth-types";
import { Logo } from "@/components/brand/logo";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  CalendarClock,
  Factory,
  BadgeCheck,
  Gauge,
  Wallet,
  FileText,
  Target,
  AlertTriangle,
  Users,
  ShieldCheck,
  KeyRound,
  SlidersHorizontal,
  ToggleRight,
  ScrollText,
  UserCircle,
  Mail,
  Clock,
  ReceiptText,
  IndianRupee,
  Lock,
  Briefcase,
  UserSearch,
  ClipboardCheck,
  FileSignature,
  Megaphone,
  Activity,
  CalendarHeart,
  MonitorSmartphone,
  Network,
  Plug,
  BarChart3,
  DatabaseBackup,
};

export function Sidebar({ portal }: { portal: PortalKey }) {
  const pathname = usePathname();
  const items = NAV[portal];
  const meta = PORTAL_META[portal];

  return (
    /**
     * MOBILE: below lg the sidebar stops being a 240px column — at 375px it was
     * consuming 64% of the viewport and squeezing every page, tables worst of
     * all. It becomes a full-width strip whose nav scrolls horizontally, so all
     * navigation is still reachable and the content gets the whole screen.
     * CSS only: identical markup, identical links, no JS drawer.
     */
    <aside className="flex w-full shrink-0 flex-col border-b border-border bg-surface lg:h-full lg:w-60 lg:border-b-0 lg:border-r">
      <div className="flex h-14 items-center border-b border-border px-4">
        <Logo size={26} />
      </div>

      <div className="hidden px-4 pb-2 pt-4 lg:block">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
          {meta.title} Portal
        </span>
      </div>

      <nav className="flex gap-1 overflow-x-auto px-2 py-2 lg:flex-1 lg:flex-col lg:gap-0 lg:space-y-0.5 lg:overflow-x-visible lg:py-1">
        {items.map((item) => {
          const Icon = ICONS[item.icon] ?? LayoutDashboard;
          // Exact match for the portal root; prefix match for sub-routes.
          const active =
            item.href === `/${portal}`
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                // shrink-0 + whitespace-nowrap keep each item intact inside the
                // horizontally scrolling mobile strip.
                "flex shrink-0 items-center gap-2 whitespace-nowrap rounded px-3 py-2 text-sm transition-colors lg:gap-3",
                active
                  ? "bg-surface-raised text-text"
                  : "text-text-muted hover:bg-surface-raised/60 hover:text-text",
              )}
            >
              <span
                className={cn(
                  "hidden h-4 w-[2px] rounded-full lg:block",
                  active ? "bg-accent" : "bg-transparent",
                )}
              />
              <Icon size={16} strokeWidth={1.75} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-4 py-3">
        <p className="text-[10px] text-text-muted">
          SESS · Simplen Employee Self-Service
        </p>
      </div>
    </aside>
  );
}
