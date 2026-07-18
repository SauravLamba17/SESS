"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, FilePlus } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const labelClass = "mb-1 block text-xs uppercase tracking-wide text-text-muted";

export function WarningIssueForm({
  reports,
}: {
  reports: { id: string; name: string; employeeCode: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [employeeId, setEmployeeId] = useState("");
  const [reason, setReason] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!employeeId) return setMsg({ ok: false, text: "Select an employee." });
    if (!reason.trim()) return setMsg({ ok: false, text: "Reason is required." });
    start(async () => {
      try {
        const res = await fetch("/api/manager/warning", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, reason, fileUrl: fileUrl || null }),
        });
        const data = await res.json();
        if (!res.ok) return setMsg({ ok: false, text: data.error ?? "Failed" });
        setMsg({ ok: true, text: "Draft created — HR will review and release." });
        setReason("");
        setFileUrl("");
        setEmployeeId("");
        router.refresh();
      } catch {
        setMsg({ ok: false, text: "Network error" });
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className={labelClass} htmlFor="we">Employee</label>
        <select id="we" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputClass}>
          <option value="">— Select direct report —</option>
          {reports.map((r) => (
            <option key={r.id} value={r.id}>{r.name} ({r.employeeCode})</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor="wr">Reason</label>
        <textarea id="wr" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the warning" className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="wf">Attachment URL</label>
        <input id="wf" value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="Optional link" className={inputClass} />
      </div>

      {msg && (
        <div className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${msg.ok ? "border-good/40 bg-good/10 text-good" : "border-danger/40 bg-danger/10 text-danger"}`} role="status">
          {msg.ok ? <CheckCircle2 size={16} /> : <StatusDot state="danger" />}
          <span>{msg.text}</span>
        </div>
      )}

      <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
        {pending ? <Loader2 size={16} className="animate-spin" /> : <FilePlus size={16} />}
        Create draft
      </button>
    </form>
  );
}
