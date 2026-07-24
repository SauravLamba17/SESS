"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, UserPlus } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/auth-types";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const labelClass = "mb-1 block text-xs uppercase tracking-wide text-text-muted";

export function OnboardForm({
  managers,
}: {
  managers: { id: string; name: string; employeeCode: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    employeeCode: "",
    name: "",
    department: "",
    designation: "",
    managerId: "",
    joiningDate: "",
    machineId: "",
    email: "",
  });
  // OPT-IN: onboarding a record does not imply granting system access.
  const [sendInvitation, setSendInvitation] = useState(false);
  const [inviteRole, setInviteRole] = useState<Role>("EMPLOYEE");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function set<K extends keyof typeof f>(k: K, v: string) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!f.employeeCode.trim() || !f.name.trim() || !f.department.trim() || !f.joiningDate)
      return setMsg({ ok: false, text: "Code, name, department and joining date are required." });
    if (sendInvitation && !f.email.trim())
      return setMsg({ ok: false, text: "An email address is required to send a login invitation." });
    start(async () => {
      try {
        const res = await fetch("/api/hr/employee", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...f,
            managerId: f.managerId || null,
            sendInvitation,
            inviteRole,
          }),
        });
        const data = await res.json();
        if (!res.ok) return setMsg({ ok: false, text: data.error ?? "Failed" });
        setMsg({
          ok: true,
          text: !data.invitation
            ? "Employee onboarded."
            : data.invitation.sent
              ? "Employee onboarded — login invitation sent."
              : `Employee onboarded, but the invitation failed: ${data.invitation.error}. Use "Send invitation" on the roster to retry.`,
        });
        setF({ employeeCode: "", name: "", department: "", designation: "", managerId: "", joiningDate: "", machineId: "", email: "" });
        setSendInvitation(false);
        setInviteRole("EMPLOYEE");
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
          <label className={labelClass} htmlFor="ec">Employee Code</label>
          <input id="ec" value={f.employeeCode} onChange={(e) => set("employeeCode", e.target.value)} placeholder="EMP-0500" className={`${inputClass} font-mono`} />
        </div>
        <div>
          <label className={labelClass} htmlFor="nm">Name</label>
          <input id="nm" value={f.name} onChange={(e) => set("name", e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="dp">Department</label>
          <input id="dp" value={f.department} onChange={(e) => set("department", e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="dg">Designation</label>
          <input id="dg" value={f.designation} onChange={(e) => set("designation", e.target.value)} placeholder="Optional" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="mg">Manager</label>
          <select id="mg" value={f.managerId} onChange={(e) => set("managerId", e.target.value)} className={inputClass}>
            <option value="">— None —</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>{m.name} ({m.employeeCode})</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="jd">Joining Date</label>
          <input id="jd" type="date" value={f.joiningDate} onChange={(e) => set("joiningDate", e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="mc">Machine ID</label>
          <input id="mc" value={f.machineId} onChange={(e) => set("machineId", e.target.value)} placeholder="Optional" className={`${inputClass} font-mono`} />
        </div>
        <div>
          <label className={labelClass} htmlFor="em">Email</label>
          <input id="em" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="Optional — needed for login access" className={inputClass} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded border border-border px-3 py-2">
        <label className="inline-flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={sendInvitation}
            onChange={(e) => setSendInvitation(e.target.checked)}
          />
          Send login invitation now
        </label>
        {sendInvitation && (
          <label className="inline-flex items-center gap-2 text-sm text-text-muted">
            Role
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} className={`${inputClass} w-auto`}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </label>
        )}
        <span className="text-xs text-text-muted">
          Optional — the record is created either way. Skip it for employees who
          won&apos;t personally use SESS.
        </span>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${msg.ok ? "border-good/40 bg-good/10 text-good" : "border-danger/40 bg-danger/10 text-danger"}`} role="status">
          {msg.ok ? <CheckCircle2 size={16} /> : <StatusDot state="danger" />}
          <span>{msg.text}</span>
        </div>
      )}

      <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
        {pending ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
        Onboard employee
      </button>
    </form>
  );
}
