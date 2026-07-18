import { auth } from "@clerk/nextjs/server";
import { PageHeader } from "@/components/portal/portal-shell";
import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { StatusDot, StatusLabel, type StatusState } from "@/components/ui/status-dot";
import { ClockInWidget } from "@/components/employee/clock-in-widget";
import { db } from "@/lib/db";
import { getEmployeeByClerkId } from "@/lib/data/scope";
import { currentPeriod } from "@/lib/period";

export const dynamic = "force-dynamic";

async function loadMetrics() {
  const { userId } = await auth();
  if (!userId) return null;
  try {
    const employee = await getEmployeeByClerkId(userId);
    if (!employee) return null;
    const { period, monthStart, monthEnd } = currentPeriod();
    const inMonth = { gte: monthStart, lt: monthEnd };
    const [prod, target, qual, appraisal] = await Promise.all([
      db.production.aggregate({
        where: { employeeId: employee.id, date: inMonth },
        _sum: { unitsProduced: true },
      }),
      db.monthlyTarget.findUnique({
        where: { employeeId_period: { employeeId: employee.id, period } },
      }),
      db.qualityReport.aggregate({
        where: { employeeId: employee.id, date: inMonth },
        _avg: { qualityScore: true },
        _count: { _all: true },
      }),
      // Most recent PUBLISHED appraisal score (Step 8).
      db.appraisalScore.findFirst({
        where: {
          employeeId: employee.id,
          excluded: false,
          finalScore: { not: null },
          cycle: { published: true },
        },
        include: { cycle: { select: { period: true } } },
        orderBy: { cycle: { createdAt: "desc" } },
      }),
    ]);
    return {
      actual: prod._sum.unitsProduced ?? 0,
      target: target?.targetUnits ?? null,
      qualityAvg: qual._count._all > 0 ? qual._avg.qualityScore ?? null : null,
      qualityCount: qual._count._all,
      appraisalScore: appraisal?.finalScore ?? null,
      appraisalPeriod: appraisal?.cycle.period ?? null,
    };
  } catch (err) {
    console.error("[employee/dashboard] metrics failed:", err);
    return null;
  }
}

export default async function EmployeeDashboard() {
  const m = await loadMetrics();

  // Production vs Target card
  const prodPct =
    m && m.target && m.target > 0 ? Math.round((m.actual / m.target) * 100) : null;
  const prodState: StatusState =
    prodPct === null ? "idle" : prodPct >= 100 ? "good" : prodPct >= 80 ? "warn" : "danger";

  // Quality Score card
  const qState: StatusState =
    m?.qualityAvg == null
      ? "idle"
      : m.qualityAvg >= 90
        ? "good"
        : m.qualityAvg >= 75
          ? "warn"
          : "danger";

  // Appraisal card (Step 8) — most recent published score
  const aScore = m?.appraisalScore ?? null;
  const aState: StatusState =
    aScore == null ? "idle" : aScore >= 80 ? "good" : aScore >= 60 ? "warn" : "danger";

  return (
    <>
      <PageHeader
        title="My Dashboard"
        description="Your attendance, production, quality and appraisal at a glance."
      />

      <div className="mb-4">
        <ClockInWidget />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today's Attendance"
          value="09:02"
          state="good"
          status="Checked in · on time"
          hint="WEB"
        />
        <StatCard
          label="Face Verification"
          value="Verified"
          state="good"
          status="Camera match 98.4%"
          mono={false}
        />
        <StatCard
          label="Idle Time (today)"
          value="41"
          unit="min"
          state="warn"
          status="Active 6h 12m"
        />
        <StatCard
          label="Production vs Target"
          value={prodPct === null ? "—" : `${prodPct}%`}
          state={prodState}
          status={
            m && m.target !== null
              ? `${m.actual} / ${m.target} units`
              : "Target not set"
          }
          mono={prodPct !== null}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatCard
          label="Quality Score"
          value={m?.qualityAvg == null ? "—" : m.qualityAvg.toFixed(1)}
          state={qState}
          status={
            m?.qualityAvg == null
              ? "No reviews yet"
              : `${m.qualityCount} review${m.qualityCount === 1 ? "" : "s"} this month`
          }
          mono={m?.qualityAvg != null}
        />
        <StatCard
          label="Appraisal"
          value={aScore == null ? "—" : aScore.toFixed(1)}
          state={aState}
          status={aScore == null ? "Not yet appraised" : (m?.appraisalPeriod ?? "Published")}
          mono={aScore != null}
        />
        <StatCard
          label="Latest Payslip"
          value="2026-06"
          state="idle"
          status="Available"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="This Week — Attendance" />
          <div className="divide-y divide-border">
            {[
              { d: "Mon 13", t: "09:01 – 18:04", s: "good" as const, l: "On time" },
              { d: "Tue 14", t: "09:12 – 18:00", s: "warn" as const, l: "Late 12m" },
              { d: "Wed 15", t: "08:58 – 18:10", s: "good" as const, l: "On time" },
              { d: "Thu 16", t: "09:03 – 17:58", s: "good" as const, l: "On time" },
              { d: "Fri 17", t: "09:00 – —", s: "idle" as const, l: "In progress" },
            ].map((r) => (
              <div
                key={r.d}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <span className="font-mono text-text-muted">{r.d}</span>
                <span className="font-mono text-text">{r.t}</span>
                <StatusLabel state={r.s} className="text-text-muted">
                  {r.l}
                </StatusLabel>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Consent & Compliance" />
          <div className="space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Face verification</span>
              <StatusLabel state="good">Consent on file</StatusLabel>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Idle-time tracking</span>
              <StatusLabel state="good">Consent on file</StatusLabel>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Data retention</span>
              <span className="font-mono text-xs text-text-muted">
                expires 2027-06-30
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2 rounded border border-border bg-surface-raised px-3 py-2">
              <StatusDot state="idle" />
              <span className="text-xs text-text-muted">
                You may withdraw consent at any time in My Documents.
              </span>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
