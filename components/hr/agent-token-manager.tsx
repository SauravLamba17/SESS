"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy, KeyRound, Loader2, RefreshCw, ShieldOff } from "lucide-react";

/**
 * Issue / revoke / regenerate an agent token for one employee.
 *
 * ONE component, used from BOTH surfaces — the Idle Tracking page and the
 * Compliance & Consent page — and it calls the ONE existing route
 * (/api/hr/agent-token). No duplicated issue logic anywhere.
 *
 * The raw token is returned exactly once, by the issuing request, and is never
 * stored anywhere HR can read back. So the reveal box is deliberately loud:
 * losing it means regenerating, which breaks the agent already installed on
 * that machine.
 */
export function AgentTokenManager({
  employeeId,
  name,
  hasActiveToken,
  consentActive,
  lastSeenAt,
  consentHint,
}: {
  employeeId: string;
  name: string;
  hasActiveToken: boolean;
  consentActive: boolean;
  /** ISO string — shown so HR can spot an agent that has gone silent. */
  lastSeenAt?: string | null;
  /** Why consent is unavailable, when it is. */
  consentHint?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);

  function post(action: "issue" | "revoke") {
    setError(null);
    setToken(null);
    setCopied(false);
    start(async () => {
      try {
        const res = await fetch("/api/hr/agent-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, employeeId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed");
          setConfirmRegen(false);
          return;
        }
        if (action === "issue" && data.token) setToken(data.token);
        setConfirmRegen(false);
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  }

  const btn =
    "inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs focus:outline-none focus-visible:ring-2 disabled:opacity-50";

  return (
    <div className="space-y-2">
      {/* ── No consent: say why, and don't offer a button that would 409 ── */}
      {!consentActive && (
        <div className="flex items-start gap-1.5 text-[11px] text-warn">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{consentHint ?? "Record IDLE_TRACKING consent above before issuing a token."}</span>
        </div>
      )}

      {/* ── Consent present, no token yet ── */}
      {consentActive && !hasActiveToken && (
        <button
          type="button"
          onClick={() => post("issue")}
          disabled={pending}
          className={`${btn} border-accent/40 text-accent hover:bg-accent/10 focus-visible:ring-accent`}
        >
          {pending ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
          Generate Agent Token
        </button>
      )}

      {/* ── Consent present, token already active ── */}
      {consentActive && hasActiveToken && !confirmRegen && (
        <div className="space-y-1.5">
          <p className="font-mono text-[11px] text-text-muted">
            Token active
            {lastSeenAt
              ? ` · last seen ${new Date(lastSeenAt).toLocaleString()}`
              : " · never reported"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmRegen(true)}
              disabled={pending}
              className={`${btn} border-border text-text-muted hover:border-accent hover:text-accent focus-visible:ring-accent`}
            >
              <RefreshCw size={12} /> Revoke &amp; Regenerate
            </button>
            <button
              type="button"
              onClick={() => post("revoke")}
              disabled={pending}
              className={`${btn} border-border text-text-muted hover:border-danger hover:text-danger focus-visible:ring-danger`}
            >
              <ShieldOff size={12} /> Revoke
            </button>
          </div>
        </div>
      )}

      {/* Regenerating silently breaks the agent already installed on that
          machine, so it asks first. */}
      {confirmRegen && (
        <div className="rounded border border-warn/40 bg-warn/10 p-2.5">
          <p className="text-[11px] text-warn">
            This replaces {name}&apos;s existing token. The agent already
            installed on their machine will stop reporting until the new token is
            entered into it.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => post("issue")}
              disabled={pending}
              className={`${btn} border-warn/50 bg-warn/10 text-warn hover:bg-warn/20 focus-visible:ring-warn`}
            >
              {pending && <Loader2 size={12} className="animate-spin" />}
              Yes, regenerate
            </button>
            <button
              type="button"
              onClick={() => setConfirmRegen(false)}
              disabled={pending}
              className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── THE REVEAL. Shown once, impossible to miss. ── */}
      {token && (
        <div className="rounded border-2 border-accent bg-accent/10 p-3">
          <div className="flex items-start gap-1.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-accent" />
            <p className="text-xs font-semibold text-accent">
              Copy this now — it will not be shown again
            </p>
          </div>
          <p className="mt-1 text-[10px] text-text-muted">
            Agent token for {name}. Paste it into the SESS Idle Agent on their
            machine. Treat it like a password.
          </p>
          <code className="mt-2 block break-all rounded bg-background px-2 py-2 font-mono text-[11px] text-text">
            {token}
          </code>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(token);
              setCopied(true);
            }}
            className="mt-2 inline-flex items-center gap-1 rounded border border-accent/50 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Copy size={11} /> {copied ? "Copied to clipboard" : "Copy token"}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
