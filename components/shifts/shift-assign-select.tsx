"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";

/** Reusable shift picker. `endpoint` is /api/hr/employee/shift (HR) or
 * /api/manager/shift (manager). Server enforces the actual authorization. */
export function ShiftAssignSelect({
  employeeId,
  currentShiftId,
  shifts,
  endpoint,
}: {
  employeeId: string;
  currentShiftId: string | null;
  shifts: { id: string; name: string }[];
  endpoint: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(currentShiftId ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onChange(shiftId: string) {
    setValue(shiftId);
    setMsg(null);
    if (!shiftId) return;
    start(async () => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, shiftId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setMsg({ ok: false, text: data.error ?? "Failed" });
          setValue(currentShiftId ?? "");
          return;
        }
        setMsg({ ok: true, text: "Saved" });
        router.refresh();
      } catch {
        setMsg({ ok: false, text: "Network error" });
        setValue(currentShiftId ?? "");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        aria-label="Assign shift"
        className="rounded border border-border bg-background px-2 py-1 text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        <option value="" disabled>
          — Shift —
        </option>
        {shifts.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {pending && <Loader2 size={13} className="animate-spin text-text-muted" />}
      {msg && (
        <span className={`inline-flex items-center gap-1 text-xs ${msg.ok ? "text-good" : "text-danger"}`}>
          {msg.ok && <Check size={12} />}
          {msg.text}
        </span>
      )}
    </div>
  );
}
