"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/auth-types";

/**
 * Per-user role control on /admin/roles. Handles the "role changed in SESS
 * but Clerk sync failed" state explicitly, with a retry that re-posts the
 * same role (the API treats same-role as a re-sync request).
 *
 * Picking a new role only PROPOSES it: an inline Confirm/Cancel step must be
 * passed before anything is sent, because a single mis-click here changes what
 * a real person can access (and syncs it to Clerk). Cancel snaps the select
 * back. The retry button skips the step — it re-sends the CURRENT role, so
 * access does not change.
 */
export function RoleSelect({ userId, currentRole }: { userId: string; currentRole: Role }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [role, setRole] = useState<Role>(currentRole);
  const [proposed, setProposed] = useState<Role | null>(null);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "saved" }
    | { kind: "sync-failed"; error: string }
    | { kind: "error"; error: string }
  >({ kind: "idle" });

  function save(next: Role) {
    setState({ kind: "idle" });
    start(async () => {
      try {
        const res = await fetch("/api/admin/user-role", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, role: next }),
        });
        const data = await res.json();
        if (!res.ok) {
          setState({ kind: "error", error: data.error ?? "Failed" });
          return;
        }
        setRole(next);
        if (data.clerkSynced === false) {
          setState({
            kind: "sync-failed",
            error: data.clerkError ?? "Clerk could not be updated",
          });
        } else {
          setState({ kind: "saved" });
        }
        router.refresh();
      } catch {
        setState({ kind: "error", error: "Network error" });
      }
    });
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <select
          value={proposed ?? role}
          onChange={(e) => {
            const next = e.target.value as Role;
            setState({ kind: "idle" });
            setProposed(next === role ? null : next);
          }}
          disabled={pending}
          aria-label="Role"
          className="rounded border border-border bg-background px-2 py-1 text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
        {pending && <Loader2 size={13} className="animate-spin text-text-muted" />}
        {state.kind === "saved" && !pending && (
          <span className="inline-flex items-center gap-1 text-xs text-good">
            <CheckCircle2 size={12} /> Saved &amp; synced
          </span>
        )}
      </div>
      {proposed && (
        <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Confirm role change">
          <span className="text-text-muted">
            Change role from <strong className="text-text">{ROLE_LABEL[role]}</strong> to{" "}
            <strong className="text-text">{ROLE_LABEL[proposed]}</strong>? This changes what they can access.
          </span>
          <button
            type="button"
            onClick={() => {
              const next = proposed;
              setProposed(null);
              save(next);
            }}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded border border-danger/40 px-2 py-0.5 text-danger hover:bg-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setProposed(null)}
            disabled={pending}
            className="rounded border border-border px-2 py-0.5 text-text-muted hover:text-text"
          >
            Cancel
          </button>
        </div>
      )}
      {state.kind === "sync-failed" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-danger">
          <AlertTriangle size={12} />
          <span>Role changed in SESS but Clerk sync failed: {state.error}</span>
          <button
            type="button"
            onClick={() => save(role)}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded border border-danger/40 px-1.5 py-0.5 text-danger hover:bg-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            <RefreshCw size={11} /> Retry sync
          </button>
        </div>
      )}
      {state.kind === "error" && <p className="text-xs text-danger">{state.error}</p>}
    </div>
  );
}
