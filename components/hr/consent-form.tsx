"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Copy, Loader2, ShieldCheck } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const labelClass = "mb-1 block text-xs uppercase tracking-wide text-text-muted";

function todayStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

export function ConsentForm({
  employees,
}: {
  employees: { id: string; name: string; employeeCode: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [employeeId, setEmployeeId] = useState("");
  const [consentType, setConsentType] = useState("FACE_VERIFICATION");
  const [givenOn, setGivenOn] = useState(todayStr());
  const [retentionExpiry, setRetentionExpiry] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Idle tracking is useless without an agent token, so the common case —
  // record consent AND issue the token — is one action, ticked by default.
  const [alsoIssueToken, setAlsoIssueToken] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isIdle = consentType === "IDLE_TRACKING";
  const selectedName =
    employees.find((e) => e.id === employeeId)?.name ?? "this employee";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setToken(null);
    setCopied(false);
    if (!employeeId) return setMsg({ ok: false, text: "Select an employee." });
    start(async () => {
      try {
        const res = await fetch("/api/hr/consent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, consentType, givenOn, retentionExpiry: retentionExpiry || null }),
        });
        const data = await res.json();
        if (!res.ok) return setMsg({ ok: false, text: data.error ?? "Failed" });

        // Chain straight into the EXISTING token route — no duplicated issue
        // logic, and no second page to visit. Consent is already committed by
        // this point, so a token failure never loses the consent record.
        if (isIdle && alsoIssueToken) {
          const tRes = await fetch("/api/hr/agent-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "issue", employeeId }),
          });
          const tData = await tRes.json();
          if (!tRes.ok) {
            setMsg({
              ok: false,
              text: `Consent recorded, but the token could not be issued: ${tData.error ?? "unknown error"}. Use the Agent Token column below to retry.`,
            });
            router.refresh();
            return;
          }
          setToken(tData.token);
          setMsg({ ok: true, text: "Consent recorded and agent token generated." });
        } else {
          setMsg({ ok: true, text: "Consent recorded." });
        }
        setRetentionExpiry("");
        router.refresh();
      } catch {
        setMsg({ ok: false, text: "Network error" });
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="ce">Employee</label>
          <select id="ce" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputClass}>
            <option value="">— Select —</option>
            {employees.map((m) => (
              <option key={m.id} value={m.id}>{m.name} ({m.employeeCode})</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="ct">Consent type</label>
          <select id="ct" value={consentType} onChange={(e) => setConsentType(e.target.value)} className={inputClass}>
            <option value="FACE_VERIFICATION">Face verification</option>
            <option value="IDLE_TRACKING">Idle tracking</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="cg">Given on</label>
          <input id="cg" type="date" value={givenOn} onChange={(e) => setGivenOn(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cr">Retention expiry</label>
          <input id="cr" type="date" value={retentionExpiry} onChange={(e) => setRetentionExpiry(e.target.value)} className={inputClass} />
        </div>
      </div>

      {/* Only meaningful for idle tracking — face verification has no agent. */}
      {isIdle && (
        <label
          htmlFor="alsoToken"
          className="flex cursor-pointer items-start gap-2.5 rounded border border-border bg-surface-raised/40 p-3"
        >
          <input
            id="alsoToken"
            type="checkbox"
            checked={alsoIssueToken}
            onChange={(e) => setAlsoIssueToken(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-background accent-[#2BB673]"
          />
          <span className="text-xs text-text">
            Also generate the desktop agent token
            <span className="mt-0.5 block text-text-muted">
              Idle tracking does nothing until {selectedName}&apos;s machine has a
              token. Ticking this issues it in the same step and shows it below —
              you won&apos;t need to go anywhere else.
            </span>
          </span>
        </label>
      )}

      {msg && (
        <div className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${msg.ok ? "border-good/40 bg-good/10 text-good" : "border-danger/40 bg-danger/10 text-danger"}`} role="status">
          {msg.ok ? <CheckCircle2 size={16} /> : <StatusDot state="danger" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* THE REVEAL — same wording and prominence as the per-row control. */}
      {token && (
        <div className="rounded border-2 border-accent bg-accent/10 p-3">
          <div className="flex items-start gap-1.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-accent" />
            <p className="text-xs font-semibold text-accent">
              Copy this now — it will not be shown again
            </p>
          </div>
          <p className="mt-1 text-[10px] text-text-muted">
            Agent token for {selectedName}. Paste it into the SESS Idle Agent on
            their machine. Treat it like a password.
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

      <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
        {pending ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
        {isIdle && alsoIssueToken ? "Record Consent & Generate Token" : "Record consent"}
      </button>
    </form>
  );
}
