"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Plus } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function CycleCreateForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [period, setPeriod] = useState("");
  const [department, setDepartment] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!period.trim()) return setMsg({ ok: false, text: "Period is required." });
    start(async () => {
      try {
        const res = await fetch("/api/hr/appraisal/cycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ period: period.trim(), department: department || null }),
        });
        const data = await res.json();
        if (!res.ok) return setMsg({ ok: false, text: data.error ?? "Failed" });
        setMsg({ ok: true, text: "Cycle created." });
        setPeriod("");
        setDepartment("");
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
          <label htmlFor="period" className="mb-1 block text-xs uppercase tracking-wide text-text-muted">
            Period
          </label>
          <input
            id="period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="2026-Q3 or 2026-07"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-text-muted">
            Use <span className="font-mono">YYYY-MM</span> or{" "}
            <span className="font-mono">YYYY-Qn</span> so scores can be computed.
          </p>
        </div>
        <div>
          <label htmlFor="cdept" className="mb-1 block text-xs uppercase tracking-wide text-text-muted">
            Department
          </label>
          <input
            id="cdept"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="Blank = org-wide"
            className={inputClass}
          />
        </div>
      </div>

      {msg && (
        <div
          className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${
            msg.ok ? "border-good/40 bg-good/10 text-good" : "border-danger/40 bg-danger/10 text-danger"
          }`}
          role="status"
        >
          {msg.ok ? <CheckCircle2 size={16} /> : <StatusDot state="danger" />}
          <span>{msg.text}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        {pending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
        Create cycle
      </button>
    </form>
  );
}
