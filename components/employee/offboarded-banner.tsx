import { db } from "@/lib/db";
import { getEffectiveUserId } from "@/lib/auth";
import { OFFBOARDED_READ_ONLY } from "@/lib/data/scope";
import { Panel } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";

/**
 * Tells an offboarded employee up front that SESS is read-only for them.
 * Every write path already refuses them (OFFBOARDED_READ_ONLY); without this
 * they only found out after filling in a form. One indexed lookup; renders
 * nothing for everyone who is still active, or on any error.
 */
export async function OffboardedBanner() {
  const clerkId = await getEffectiveUserId();
  if (!clerkId) return null;
  const closed = await db.employee
    .findFirst({ where: { active: false, user: { is: { clerkId } } }, select: { id: true } })
    .catch(() => null);
  if (!closed) return null;
  return (
    <Panel className="mb-5 flex items-center gap-3 px-4 py-3">
      <StatusDot state="warn" />
      <span className="text-sm text-text">{OFFBOARDED_READ_ONLY}</span>
    </Panel>
  );
}
