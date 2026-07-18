"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
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
        setMsg({ ok: true, text: "Consent recorded." });
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

      {msg && (
        <div className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${msg.ok ? "border-good/40 bg-good/10 text-good" : "border-danger/40 bg-danger/10 text-danger"}`} role="status">
          {msg.ok ? <CheckCircle2 size={16} /> : <StatusDot state="danger" />}
          <span>{msg.text}</span>
        </div>
      )}

      <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
        {pending ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
        Record consent
      </button>
    </form>
  );
}
