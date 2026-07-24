import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusLabel } from "@/components/ui/status-dot";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Phase 11: READ-ONLY integration status. This page never renders a secret
 * and never edits one — actual values live only in .env, by design. What is
 * shown is presence (configured / not configured), the publishable key's last
 * 4 characters (it is public-by-design anyway, but the habit of truncation is
 * the point), and the database HOST — never a connection string.
 */
function last4(value: string | undefined): string | null {
  return value && value.length >= 4 ? value.slice(-4) : null;
}

function dbHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    // postgres URLs parse fine with the URL class.
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

async function dbReachable(): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export default async function IntegrationsPage() {
  const reachable = await dbReachable();

  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const rows = [
    {
      name: "Clerk — authentication",
      configured: Boolean(pk && process.env.CLERK_SECRET_KEY),
      detail: pk
        ? `Publishable key ···${last4(pk)} · secret key ${process.env.CLERK_SECRET_KEY ? "set" : "MISSING"}`
        : "Keys not configured",
    },
    {
      name: "Clerk — webhook (invitation → account link)",
      configured: Boolean(process.env.CLERK_WEBHOOK_SECRET),
      detail: process.env.CLERK_WEBHOOK_SECRET
        ? "Signing secret set · endpoint /api/webhooks/clerk"
        : "CLERK_WEBHOOK_SECRET not set — accepted invitations will not auto-link",
    },
    {
      name: "Supabase / PostgreSQL",
      configured: reachable,
      detail: (() => {
        const host = dbHost(process.env.DATABASE_URL);
        return host
          ? `Host ${host} · ${reachable ? "reachable" : "NOT reachable"}`
          : "DATABASE_URL not configured";
      })(),
    },
  ];

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connection status only. Secrets live in .env and are never shown or editable here."
      />

      <Panel>
        <PanelHeader title="Configured Integrations" />
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <div key={r.name} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
              <div>
                <p className="text-sm text-text">{r.name}</p>
                <p className="mt-0.5 font-mono text-xs text-text-muted">{r.detail}</p>
              </div>
              <StatusLabel state={r.configured ? "good" : "warn"}>
                {r.configured ? "Connected" : "Not configured"}
              </StatusLabel>
            </div>
          ))}
        </div>
        <p className="border-t border-border px-4 py-3 text-xs text-text-muted">
          To change any of these, edit the deployment&apos;s .env and restart —
          deliberately not editable from the browser, so a compromised admin
          session cannot exfiltrate or rotate credentials.
        </p>
      </Panel>
    </>
  );
}
