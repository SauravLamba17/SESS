"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const labelClass = "mb-1 block text-xs uppercase tracking-wide text-text-muted";

function todayStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

export function ClientMailForm({
  reports,
}: {
  reports: { id: string; name: string; employeeCode: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [employeeId, setEmployeeId] = useState("");
  const [subject, setSubject] = useState("");
  const [date, setDate] = useState(todayStr());
  const [summary, setSummary] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!employeeId) return setMsg({ ok: false, text: "Select an employee." });
    if (!subject.trim()) return setMsg({ ok: false, text: "Subject is required." });
    start(async () => {
      try {
        const res = await fetch("/api/manager/client-mail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, subject, date, summary }),
        });
        const data = await res.json();
        if (!res.ok) return setMsg({ ok: false, text: data.error ?? "Failed" });
        setMsg({ ok: true, text: "Client mail tagged." });
        setSubject("");
        setSummary("");
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
          <label className={labelClass} htmlFor="me">Employee</label>
          <select id="me" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputClass}>
            <option value="">— Select direct report —</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({r.employeeCode})</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="md">Date</label>
          <input id="md" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="ms">Subject</label>
        <input id="ms" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="msum">Summary / notes</label>
        <textarea id="msum" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Manager-entered summary (AI summarization comes in a later phase)" className={inputClass} />
      </div>

      {msg && (
        <div className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${msg.ok ? "border-good/40 bg-good/10 text-good" : "border-danger/40 bg-danger/10 text-danger"}`} role="status">
          {msg.ok ? <CheckCircle2 size={16} /> : <StatusDot state="danger" />}
          <span>{msg.text}</span>
        </div>
      )}

      <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
        {pending ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
        Tag client mail
      </button>
    </form>
  );
}
