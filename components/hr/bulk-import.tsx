"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";

interface PreviewRow {
  lineNumber: number;
  employeeCode: string;
  name: string;
  department: string;
  designation: string | null;
  managerEmployeeCode: string | null;
  joiningDate: string;
  machineId: string | null;
}
interface InvalidRow {
  lineNumber: number;
  employeeCode: string;
  reasons: string[];
}
interface Preview {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  valid: PreviewRow[];
  invalid: InvalidRow[];
}

const TEMPLATE =
  "employeeCode,name,department,designation,managerEmployeeCode,joiningDate,machineId,email\n" +
  "EMP-1001,Asha Verma,Assembly,Line Operator,EMP-0002,2026-08-01,M-12,asha.verma@example.com\n";

/**
 * Two-stage import: preview (writes nothing) → confirm (all-or-nothing).
 * HR always sees exactly what will happen before anything is created.
 */
export function BulkImport() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function post(mode: "preview" | "commit") {
    setError(null);
    setDone(null);
    if (!csv.trim()) {
      setError("Choose a CSV file first.");
      return;
    }
    start(async () => {
      try {
        const res = await fetch("/api/hr/employee/bulk-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, csv }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Import failed.");
          // A 409 from commit still carries the full verdict — show it.
          if (data.valid || data.invalid) setPreview(data as Preview);
          return;
        }
        if (mode === "preview") {
          setPreview(data as Preview);
        } else {
          setDone(`Imported ${data.imported} employee(s) successfully.`);
          setPreview(null);
          setCsv("");
          setFileName(null);
          router.refresh();
        }
      } catch {
        setError("Network error");
      }
    });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setPreview(null);
    setDone(null);
    setError(null);
    setCsv(await f.text());
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="csv"
          className="inline-flex cursor-pointer items-center gap-2 rounded border border-dashed border-border bg-background px-3 py-2 text-sm text-text-muted hover:border-accent"
        >
          <Upload size={15} />
          {fileName ?? "Choose a CSV file…"}
        </label>
        <input id="csv" type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} />

        <button
          type="button"
          onClick={() => post("preview")}
          disabled={pending || !csv.trim()}
          className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs text-text hover:bg-surface-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {pending && <Loader2 size={13} className="animate-spin" />}
          Validate &amp; preview
        </button>

        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
          download="employee-import-template.csv"
          className="text-xs text-accent underline"
        >
          Download template
        </a>
      </div>

      <p className="text-[11px] text-text-muted">
        Columns: employeeCode, name, department, designation, managerEmployeeCode,
        joiningDate (YYYY-MM-DD), machineId, email (optional). Managers are
        referenced by their employee <em>code</em>, not an internal id. Login
        invitations are NOT sent at import — use &quot;Send invitation&quot; on the
        roster afterwards. Nothing is written until you confirm.
      </p>

      {error && (
        <div className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {done && (
        <div className="flex items-center gap-2 rounded border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
          <CheckCircle2 size={15} />
          <span>{done}</span>
        </div>
      )}

      {preview && (
        <div className="space-y-3 rounded border border-border bg-surface-raised/40 p-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-2">
              <StatusDot state={preview.invalidCount === 0 ? "good" : "warn"} />
              <span className="text-text">
                {preview.totalRows} row{preview.totalRows === 1 ? "" : "s"} parsed
              </span>
            </span>
            <span className="font-mono text-xs text-good">{preview.validCount} valid</span>
            {preview.invalidCount > 0 && (
              <span className="font-mono text-xs text-danger">
                {preview.invalidCount} invalid
              </span>
            )}
          </div>

          {preview.invalidCount > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-danger">
                These rows will NOT be imported — the whole file is rejected until
                they are fixed:
              </p>
              <ul className="space-y-1">
                {preview.invalid.map((r) => (
                  <li
                    key={r.lineNumber}
                    className="rounded border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-xs"
                  >
                    <span className="font-mono text-text">
                      line {r.lineNumber} · {r.employeeCode}
                    </span>
                    <ul className="mt-0.5 list-inside list-disc text-danger">
                      {r.reasons.map((why, i) => (
                        <li key={i}>{why}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.validCount > 0 && (
            <details className="rounded border border-border">
              <summary className="cursor-pointer px-2.5 py-1.5 text-xs text-text-muted">
                Preview {preview.validCount} valid row(s)
              </summary>
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] uppercase text-text-muted">
                      <th className="px-2 py-1.5">Code</th>
                      <th className="px-2 py-1.5">Name</th>
                      <th className="px-2 py-1.5">Dept</th>
                      <th className="px-2 py-1.5">Manager</th>
                      <th className="px-2 py-1.5">Joining</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.valid.map((r) => (
                      <tr key={r.lineNumber}>
                        <td className="px-2 py-1 font-mono text-text">{r.employeeCode}</td>
                        <td className="px-2 py-1 text-text">{r.name}</td>
                        <td className="px-2 py-1 text-text-muted">{r.department}</td>
                        <td className="px-2 py-1 font-mono text-text-muted">
                          {r.managerEmployeeCode ?? "—"}
                        </td>
                        <td className="px-2 py-1 font-mono text-text-muted">{r.joiningDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-[11px] text-text-muted">
              {preview.invalidCount > 0
                ? "Import is blocked while any row is invalid — all rows import together or none do."
                : `All ${preview.validCount} rows are valid and will be created in a single transaction.`}
            </span>
            <button
              type="button"
              onClick={() => post("commit")}
              disabled={pending || preview.invalidCount > 0 || preview.validCount === 0}
              className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              {pending && <Loader2 size={13} className="animate-spin" />}
              Confirm import
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
