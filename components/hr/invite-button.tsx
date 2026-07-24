"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MailPlus } from "lucide-react";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/auth-types";

/**
 * "Send invitation" / "Resend" on the Employee Master roster — the path for
 * employees onboarded without login access (bulk imports especially).
 * If the employee has no stored email, HR supplies one inline.
 */
export function InviteButton({
  employeeId,
  email,
  resend,
}: {
  employeeId: string;
  email: string | null;
  resend: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [role, setRole] = useState<Role>("EMPLOYEE");
  const [err, setErr] = useState<string | null>(null);

  function send() {
    setErr(null);
    start(async () => {
      try {
        const res = await fetch("/api/hr/employee/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, email: email ?? newEmail.trim(), role }),
        });
        const data = await res.json();
        if (!res.ok) return setErr(data.error ?? "Failed to send the invitation");
        setOpen(false);
        router.refresh();
      } catch {
        setErr("Network error");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <MailPlus size={12} />
        {resend ? "Resend invitation" : "Send invitation"}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!email && (
        <input
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="email@company.com"
          className="w-44 rounded border border-border bg-background px-2 py-1 text-xs text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      )}
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
        aria-label="Role for the invited account"
        className="rounded border border-border bg-background px-2 py-1 text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={send}
        disabled={pending || (!email && !newEmail.trim())}
        className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {pending ? <Loader2 size={12} className="animate-spin" /> : <MailPlus size={12} />}
        Send
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setErr(null); }}
        className="text-xs text-text-muted hover:text-text"
      >
        Cancel
      </button>
      {err && <span className="w-full text-xs text-danger">{err}</span>}
    </div>
  );
}
