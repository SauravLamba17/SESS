"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, Check, Loader2 } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";
import { markNotificationsRead } from "@/app/employee/notifications-actions";

export interface NotificationItem {
  id: string;
  type: string;
  message: string;
  read: boolean;
  createdAt: string; // ISO — Dates don't cross the RSC boundary
}

/**
 * Where each notification type should take the recipient.
 *
 * The component itself is portal-agnostic — it renders whatever items it is
 * given — so surfacing it on the HR portal needed only this map entry plus a
 * render call, not a second notification component.
 */
const LINK_FOR: Record<string, string> = {
  PAYSLIP_READY: "/employee/payslips",
  NEW_APPLICATION: "/hr/candidates",
};

export function NotificationPanel({ items }: { items: NotificationItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const unread = items.filter((n) => !n.read);

  function markAllRead() {
    setError(null);
    start(async () => {
      const res = await markNotificationsRead(unread.map((n) => n.id));
      if (!res.ok) {
        setError(res.error ?? "Could not update notifications.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Panel>
      <PanelHeader
        title={`Notifications${unread.length > 0 ? ` · ${unread.length} new` : ""}`}
        action={
          unread.length > 0 ? (
            <button
              type="button"
              onClick={markAllRead}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              {pending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Check size={12} />
              )}
              Mark all read
            </button>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-text-muted">
          <Bell size={14} /> Nothing new.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((n) => {
            const href = LINK_FOR[n.type];
            const body = (
              <div className="flex items-start gap-2.5">
                <StatusDot state={n.read ? "idle" : "good"} className="mt-1.5" />
                <div className="min-w-0">
                  <p className={n.read ? "text-sm text-text-muted" : "text-sm text-text"}>
                    {n.message}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-text-muted">
                    {new Date(n.createdAt).toLocaleDateString([], {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                    {href && " · view"}
                  </p>
                </div>
              </div>
            );
            return (
              <li key={n.id} className="px-4 py-3">
                {href ? (
                  <Link href={href} className="block hover:opacity-80">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="border-t border-border px-4 py-2 text-xs text-danger">{error}</p>}
    </Panel>
  );
}
