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
  Cpu,
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
  Cpu,
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
};

export function Sidebar({ portal }: { portal: PortalKey }) {
  const pathname = usePathname();
  const items = NAV[portal];
  const meta = PORTAL_META[portal];

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-14 items-center border-b border-border px-4">
        <Logo size={26} />
      </div>

      <div className="px-4 pb-2 pt-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
          {meta.title} Portal
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-1">
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
                "flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-surface-raised text-text"
                  : "text-text-muted hover:bg-surface-raised/60 hover:text-text",
              )}
            >
              <span
                className={cn(
                  "h-4 w-[2px] rounded-full",
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
