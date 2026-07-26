"use client";

import { useEffect, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from "chart.js";
import { Bar, Line, Doughnut } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
);

/**
 * Charts read their colours from the THEME TOKENS at render time, not from
 * hardcoded hexes, so they re-colour with the rest of the app.
 *
 * Chart.js paints to a canvas, so it cannot inherit CSS variables the way DOM
 * nodes do — the values have to be resolved to concrete strings and the chart
 * re-rendered when the theme changes. useThemeColors does exactly that,
 * watching <html data-theme> with a MutationObserver.
 *
 * PALETTE DISCIPLINE: accent (amber) is the default series colour everywhere.
 * good/danger/info appear only where the distinction is genuinely semantic —
 * the role-distribution ring, where each slice means a different thing — and
 * never as decoration to make a chart look colourful.
 */
function readVar(name: string, alpha = 1): string {
  if (typeof window === "undefined") return "rgb(128 128 128)";
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // Tokens are stored as raw "R G B" channels — see app/globals.css.
  return raw ? `rgb(${raw} / ${alpha})` : "rgb(128 128 128)";
}

interface ThemeColors {
  accent: string;
  accentSoft: string;
  accentFaint: string;
  text: string;
  textMuted: string;
  border: string;
  good: string;
  danger: string;
  info: string;
  surface: string;
}

function snapshot(): ThemeColors {
  return {
    accent: readVar("--color-accent"),
    accentSoft: readVar("--color-accent", 0.55),
    accentFaint: readVar("--color-accent", 0.15),
    text: readVar("--color-text"),
    textMuted: readVar("--color-text-muted"),
    border: readVar("--color-border"),
    good: readVar("--color-good"),
    danger: readVar("--color-danger"),
    info: readVar("--color-info"),
    surface: readVar("--color-surface"),
  };
}

function useThemeColors(): ThemeColors | null {
  // null until mounted: the server has no computed styles, and guessing would
  // paint one theme's colours then swap.
  const [colors, setColors] = useState<ThemeColors | null>(null);

  useEffect(() => {
    setColors(snapshot());
    const observer = new MutationObserver(() => setColors(snapshot()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return colors;
}

/** Shared axis/grid/tooltip styling, themed. */
function baseOptions(c: ThemeColors): ChartOptions<"bar" | "line"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: c.surface,
        titleColor: c.text,
        bodyColor: c.textMuted,
        borderColor: c.border,
        borderWidth: 1,
        padding: 8,
        displayColors: false,
      },
    },
    scales: {
      x: {
        ticks: { color: c.textMuted, font: { size: 10 } },
        grid: { display: false },
        border: { color: c.border },
      },
      y: {
        beginAtZero: true,
        ticks: { color: c.textMuted, font: { size: 10 }, precision: 0 },
        grid: { color: c.border },
        border: { display: false },
      },
    },
  };
}

/** Height wrapper — canvases need a bounded parent to size against. */
function ChartFrame({ children }: { children: React.ReactNode }) {
  return <div className="h-56 w-full">{children}</div>;
}

function Loading() {
  return (
    <div className="flex h-56 items-center justify-center text-xs text-text-muted">
      Loading chart…
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="flex h-56 items-center justify-center px-4 text-center text-xs text-text-muted">
      {message}
    </div>
  );
}

// ── Headcount trend (6 months) ─────────────────────────────────────

export function HeadcountTrendChart({
  points,
}: {
  points: { month: string; headcount: number }[];
}) {
  const c = useThemeColors();
  if (!c) return <Loading />;
  if (points.every((p) => p.headcount === 0))
    return <Empty message="No headcount recorded in the last six months." />;

  return (
    <ChartFrame>
      <Line
        data={{
          labels: points.map((p) => p.month),
          datasets: [
            {
              data: points.map((p) => p.headcount),
              borderColor: c.accent,
              backgroundColor: c.accentFaint,
              pointBackgroundColor: c.accent,
              pointBorderColor: c.accent,
              pointRadius: 3,
              borderWidth: 2,
              tension: 0.3,
              fill: true,
            },
          ],
        }}
        options={baseOptions(c) as ChartOptions<"line">}
      />
    </ChartFrame>
  );
}

// ── Headcount by department ────────────────────────────────────────

export function DepartmentHeadcountChart({
  rows,
}: {
  rows: { department: string; count: number }[];
}) {
  const c = useThemeColors();
  if (!c) return <Loading />;
  if (rows.length === 0) return <Empty message="No active employees." />;

  return (
    <ChartFrame>
      <Bar
        data={{
          labels: rows.map((r) => r.department),
          datasets: [
            {
              data: rows.map((r) => r.count),
              backgroundColor: c.accentSoft,
              hoverBackgroundColor: c.accent,
              borderColor: c.accent,
              borderWidth: 1,
              borderRadius: 2,
            },
          ],
        }}
        options={baseOptions(c) as ChartOptions<"bar">}
      />
    </ChartFrame>
  );
}

// ── Recruitment funnel ─────────────────────────────────────────────

export function RecruitmentFunnelChart({
  stages,
}: {
  stages: { stage: string; reached: number }[];
}) {
  const c = useThemeColors();
  if (!c) return <Loading />;
  if (stages.every((s) => s.reached === 0))
    return <Empty message="No applications in the last six months." />;

  const opts = baseOptions(c) as ChartOptions<"bar">;
  return (
    <ChartFrame>
      <Bar
        data={{
          labels: stages.map((s) => s.stage),
          datasets: [
            {
              data: stages.map((s) => s.reached),
              backgroundColor: c.accentSoft,
              hoverBackgroundColor: c.accent,
              borderColor: c.accent,
              borderWidth: 1,
              borderRadius: 2,
            },
          ],
        }}
        // Horizontal: a funnel reads top-to-bottom, and stage names fit.
        options={{ ...opts, indexAxis: "y" as const }}
      />
    </ChartFrame>
  );
}

// ── Role distribution ──────────────────────────────────────────────

export function RoleDistributionChart({
  rows,
}: {
  rows: { role: string; count: number }[];
}) {
  const c = useThemeColors();
  if (!c) return <Loading />;
  const total = rows.reduce((n, r) => n + r.count, 0);
  if (total === 0) return <Empty message="No linked accounts yet." />;

  // The ONE chart with a multi-colour palette, because each slice is a
  // genuinely different thing (a privilege level), not a series index.
  const byRole: Record<string, string> = {
    EMPLOYEE: c.info,
    MANAGER: c.good,
    HR: c.accent,
    SUPER_ADMIN: c.danger,
  };

  return (
    <ChartFrame>
      <Doughnut
        data={{
          labels: rows.map((r) => r.role),
          datasets: [
            {
              data: rows.map((r) => r.count),
              backgroundColor: rows.map((r) => byRole[r.role] ?? c.textMuted),
              borderColor: c.surface,
              borderWidth: 2,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          cutout: "62%",
          plugins: {
            legend: {
              position: "right",
              labels: { color: c.textMuted, font: { size: 10 }, boxWidth: 10, padding: 10 },
            },
            tooltip: {
              backgroundColor: c.surface,
              titleColor: c.text,
              bodyColor: c.textMuted,
              borderColor: c.border,
              borderWidth: 1,
              padding: 8,
            },
          },
        }}
      />
    </ChartFrame>
  );
}
