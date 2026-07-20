"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock, ShieldAlert, Loader2, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/portal/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";

type MainKey = "punctuality" | "production" | "quality" | "feedback" | "warningPenaltyPoints";
type Key =
  | MainKey
  | "punctualityFrequencyWeight"
  | "punctualitySeverityWeight"
  | "punctualitySeverityCapMinutes";

const COMPONENTS: { key: MainKey; label: string; hint: string; penalty?: boolean }[] = [
  { key: "punctuality", label: "Punctuality", hint: "On-time attendance & low late-flags" },
  { key: "production", label: "Production", hint: "Units produced vs target" },
  { key: "quality", label: "Quality", hint: "Quality score, defect-adjusted" },
  { key: "feedback", label: "Manager Feedback", hint: "Numeric manager input (0-100)" },
  { key: "warningPenaltyPoints", label: "Warning Penalty", hint: "Points deducted per released warning letter", penalty: true },
];

const ZERO: Record<Key, number> = {
  punctuality: 0, production: 0, quality: 0, feedback: 0, warningPenaltyPoints: 0,
  // Suggested defaults (the split must sum to 100; 0/0 is never valid).
  punctualityFrequencyWeight: 70,
  punctualitySeverityWeight: 30,
  punctualitySeverityCapMinutes: 60,
};

export default function AppraisalFormulaPage() {
  const [department, setDepartment] = useState(""); // "" = Global Default
  const [weights, setWeights] = useState<Record<Key, number>>(ZERO);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [source, setSource] = useState<string>("none");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (dept: string) => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/admin/appraisal-formula?department=${encodeURIComponent(dept)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "Failed to load" });
        setWeights(ZERO);
        setConfigured(false);
        return;
      }
      setWeights({ ...ZERO, ...(data.weights ?? {}) });
      setConfigured(!!data.configured);
      setSource(data.source ?? "none");
    } catch {
      setMsg({ ok: false, text: "Network error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(department);
  }, [department, load]);

  const positiveSum =
    weights.punctuality + weights.production + weights.quality + weights.feedback;
  const balanced = positiveSum === 100;

  // Phase 8 punctuality split validation (mirrors the server checks).
  const punctSplit =
    weights.punctualityFrequencyWeight + weights.punctualitySeverityWeight;
  const splitOk = punctSplit === 100;
  const capOk = weights.punctualitySeverityCapMinutes > 0;
  const saveEnabled = balanced && splitOk && capOk;

  function setW(k: Key, v: number) {
    setWeights((prev) => ({ ...prev, [k]: v }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/appraisal-formula", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department: department || null, weights }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "Save failed" });
        return;
      }
      setMsg({ ok: true, text: "Formula saved." });
      setConfigured(true);
      setSource(department ? "department" : "global");
    } catch {
      setMsg({ ok: false, text: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Appraisal Formula"
        description="Define the quality-linked appraisal formula and its component weights."
      />

      <div className="mb-5 flex items-start gap-3 rounded border border-accent/40 bg-accent/10 px-4 py-3">
        <ShieldAlert size={18} className="mt-0.5 shrink-0 text-accent" />
        <div className="text-sm">
          <p className="font-medium text-text">Super Admin owns the appraisal formula.</p>
          <p className="mt-0.5 text-text-muted">
            These weights are the single source of truth. HR snapshots them at cycle
            creation but <span className="text-text">cannot edit them</span>. This endpoint
            is role-gated to Super Admin server-side.
          </p>
        </div>
      </div>

      {/* Department selector */}
      <Panel className="mb-4 flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <label htmlFor="dept" className="text-xs uppercase tracking-wide text-text-muted">
            Department
          </label>
          <input
            id="dept"
            type="text"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="Global Default (leave blank)"
            className="rounded border border-border bg-background px-3 py-1.5 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <span className="flex items-center gap-2 text-xs">
          <StatusDot state={configured ? "good" : "warn"} />
          <span className="font-mono text-text-muted">
            {loading
              ? "loading…"
              : configured
                ? `configured (${source})`
                : "no formula configured yet"}
          </span>
        </span>
      </Panel>

      {/* Phase 8: punctuality frequency vs severity split */}
      <Panel className="mb-4">
        <PanelHeader
          title="Punctuality — Frequency vs Severity"
          action={
            <span className="flex items-center gap-2 text-xs">
              <StatusDot state={splitOk ? "good" : "warn"} />
              <span className="font-mono text-text-muted">split = {punctSplit}%</span>
            </span>
          }
        />
        <div className="grid grid-cols-1 gap-5 p-4 md:grid-cols-3">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="pfreq" className="text-sm text-text">Frequency weight</label>
              <span className="font-mono text-sm text-text">{weights.punctualityFrequencyWeight}%</span>
            </div>
            <input
              id="pfreq"
              type="number"
              min={0}
              max={100}
              value={weights.punctualityFrequencyWeight}
              onChange={(e) => {
                const v = Number(e.target.value);
                setWeights((prev) => ({
                  ...prev,
                  punctualityFrequencyWeight: v,
                  // Convenience: keep severity as the complement so the split
                  // stays at 100 (Super Admin can still override severity below).
                  punctualitySeverityWeight: Number.isFinite(v) ? Math.max(0, 100 - v) : prev.punctualitySeverityWeight,
                }));
              }}
              disabled={loading}
              className="w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <p className="mt-1 text-xs text-text-muted">
              How much of punctuality comes from HOW OFTEN someone is late.{" "}
              <span className="text-text-muted">
                Suggested: 70. Industry HR-analytics practice generally weights how OFTEN
                someone is late more heavily than how late any single instance was — occasional
                lateness should have limited impact, while a consistent pattern is the stronger
                signal. 70/30 is a reasonable starting split; adjust for your context.
              </span>
            </p>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="psev" className="text-sm text-text">Severity weight</label>
              <span className="font-mono text-sm text-text">{weights.punctualitySeverityWeight}%</span>
            </div>
            <input
              id="psev"
              type="number"
              min={0}
              max={100}
              value={weights.punctualitySeverityWeight}
              onChange={(e) => setW("punctualitySeverityWeight", Number(e.target.value))}
              disabled={loading}
              className="w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <p className="mt-1 text-xs text-text-muted">
              How much comes from HOW LATE they are, on the days they ARE late. Must sum to 100
              with frequency weight. Suggested: 30.
            </p>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="pcap" className="text-sm text-text">Severity cap (min)</label>
              <span className="font-mono text-sm text-text">{weights.punctualitySeverityCapMinutes}m</span>
            </div>
            <input
              id="pcap"
              type="number"
              min={1}
              value={weights.punctualitySeverityCapMinutes}
              onChange={(e) => setW("punctualitySeverityCapMinutes", Number(e.target.value))}
              disabled={loading}
              className="w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <p className="mt-1 text-xs text-text-muted">
              Minutes-late at which the severity sub-score bottoms out at 0 (counted only on days
              someone was actually late). Suggested: 60. A common reference point: many attendance
              policies treat lateness beyond about an hour as materially more serious than a short
              delay. This is a suggested default, not a fixed standard — set it to what your
              organization considers a serious incident.
            </p>
          </div>
        </div>
        {!splitOk && (
          <p className="px-4 pb-3 text-xs text-danger">
            Frequency + severity must sum to exactly 100 (now {punctSplit}).
          </p>
        )}
        {!capOk && (
          <p className="px-4 pb-3 text-xs text-danger">Severity cap must be a positive number of minutes.</p>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Component Weights"
            action={
              <span className="flex items-center gap-2 text-xs">
                <StatusDot state={balanced ? "good" : "warn"} />
                <span className="font-mono text-text-muted">positive = {positiveSum}%</span>
              </span>
            }
          />
          <div className="space-y-5 p-4">
            {COMPONENTS.map((c) => (
              <div key={c.key}>
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusDot state={c.penalty ? "danger" : "good"} />
                    <span className="text-sm text-text">{c.label}</span>
                    {c.penalty && (
                      <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-danger">
                        per letter
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-sm tabular-nums text-text">
                    {c.penalty ? "−" : ""}
                    {weights[c.key]}
                    {c.penalty ? " pts" : "%"}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={c.penalty ? 50 : 100}
                  value={weights[c.key]}
                  onChange={(e) =>
                    setWeights((prev) => ({ ...prev, [c.key]: Number(e.target.value) }))
                  }
                  disabled={loading}
                  className="w-full accent-accent"
                  aria-label={`${c.label} weight`}
                />
                <p className="mt-1 text-xs text-text-muted">{c.hint}</p>
              </div>
            ))}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Formula Preview" />
            <div className="p-4">
              <pre className="whitespace-pre-wrap break-words rounded border border-border bg-background p-3 font-mono text-xs leading-relaxed text-text-muted">
{`final =
  (punctuality × ${weights.punctuality}
   + production  × ${weights.production}
   + quality     × ${weights.quality}
   + feedback    × ${weights.feedback}) / 100
  − releasedWarnings × ${weights.warningPenaltyPoints}`}
              </pre>
              <div className="mt-3 flex items-center gap-2 text-xs">
                <StatusDot state={balanced ? "good" : "warn"} />
                <span className="text-text-muted">
                  {balanced
                    ? "Positive weights sum to 100%."
                    : `Sum to 100% to save (now ${positiveSum}%).`}
                </span>
              </div>
            </div>
          </Panel>

          {msg && (
            <div
              className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${
                msg.ok
                  ? "border-good/40 bg-good/10 text-good"
                  : "border-danger/40 bg-danger/10 text-danger"
              }`}
              role="status"
            >
              {msg.ok ? <CheckCircle2 size={16} /> : <StatusDot state="danger" />}
              <span>{msg.text}</span>
            </div>
          )}

          <button
            type="button"
            onClick={save}
            disabled={!saveEnabled || saving || loading}
            className="flex w-full items-center justify-center gap-2 rounded bg-accent px-3 py-2.5 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
            Save formula
          </button>
        </div>
      </div>
    </>
  );
}
