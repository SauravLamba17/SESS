"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { StatusDot, type StatusState } from "@/components/ui/status-dot";

interface DayData {
  date: string; // YYYY-MM-DD
  checkIn: string | null;
  checkOut: string | null;
  lateFlag: boolean;
  flaggedForReview: boolean;
}

interface MonthResponse {
  ok: boolean;
  year: number;
  month: number;
  joiningDate: string;
  days: DayData[];
  error?: string;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AttendanceCalendar({
  initialYear,
  initialMonth,
}: {
  initialYear: number;
  initialMonth: number; // 1-12
}) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [data, setData] = useState<MonthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/attendance/month?year=${year}&month=${month}`)
      .then(async (res) => {
        const json = (await res.json()) as MonthResponse;
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setError(json.error ?? "Could not load attendance.");
          setData(null);
        } else {
          setData(json);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load attendance.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  function shift(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  // Monday-first offset for the 1st of the month.
  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;

  const byDate = new Map<string, DayData>();
  data?.days.forEach((d) => byDate.set(d.date, d));

  const joining = data ? new Date(data.joiningDate) : null;
  const joiningDay = joining
    ? new Date(joining.getFullYear(), joining.getMonth(), joining.getDate())
    : null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const monthLastDay = new Date(year, month - 1, daysInMonth);
  const wholeMonthBeforeJoining =
    joiningDay !== null && monthLastDay < joiningDay;

  function cellState(day: number): { state: StatusState; note: string } {
    const cellDate = new Date(year, month - 1, day);
    const dow = cellDate.getDay();
    const weekend = dow === 0 || dow === 6;

    if (joiningDay && cellDate < joiningDay)
      return { state: "idle", note: "" };
    if (weekend) return { state: "idle", note: "" };
    if (cellDate > today) return { state: "idle", note: "" };

    const rec = byDate.get(ymd(year, month, day));
    if (rec?.checkIn) {
      if (rec.lateFlag || rec.flaggedForReview)
        return { state: "warn", note: "" };
      return { state: "good", note: "" };
    }
    // Working day, in the past, no punch.
    if (cellDate < today) return { state: "danger", note: "no punch" };
    return { state: "idle", note: "" }; // today, not yet punched
  }

  return (
    <div>
      {/* Header + month nav */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">
          {MONTHS[month - 1]}{" "}
          <span className="font-mono text-text-muted">{year}</span>
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Previous month"
            className="rounded border border-border p-1.5 text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Next month"
            className="rounded border border-border p-1.5 text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="pb-1 text-[10px] uppercase tracking-wide text-text-muted"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Body */}
      {loading ? (
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 35 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square animate-pulse rounded border border-border bg-surface-raised/50"
            />
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-3 text-sm text-danger">
          <StatusDot state="danger" />
          <span>{error}</span>
        </div>
      ) : wholeMonthBeforeJoining ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded border border-border bg-surface-raised/40 px-4 py-10 text-center">
          <StatusDot state="idle" />
          <p className="text-sm text-text">No records</p>
          <p className="text-xs text-text-muted">
            This month is before your joining date
            {joiningDay && (
              <>
                {" "}
                (
                <span className="font-mono">
                  {ymd(
                    joiningDay.getFullYear(),
                    joiningDay.getMonth() + 1,
                    joiningDay.getDate(),
                  )}
                </span>
                )
              </>
            )}
            .
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: firstDow }).map((_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const { state, note } = cellState(day);
            const rec = byDate.get(ymd(year, month, day));
            return (
              <div
                key={day}
                className="flex aspect-square min-w-0 flex-col rounded border border-border bg-surface p-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-text-muted">
                    {day}
                  </span>
                  <StatusDot state={state} />
                </div>
                <div className="mt-auto min-w-0 truncate font-mono text-[9px] leading-tight text-text-muted">
                  {rec?.checkIn ? (
                    <>
                      <div className="truncate">{fmtTime(rec.checkIn)}</div>
                      <div className="truncate">{fmtTime(rec.checkOut)}</div>
                    </>
                  ) : (
                    note && <span className="text-danger">{note}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          <StatusDot state="good" /> On time
        </span>
        <span className="inline-flex items-center gap-1.5">
          <StatusDot state="warn" /> Late / flagged
        </span>
        <span className="inline-flex items-center gap-1.5">
          <StatusDot state="danger" /> No punch
        </span>
        <span className="inline-flex items-center gap-1.5">
          <StatusDot state="idle" /> Weekend / no data
        </span>
      </div>
    </div>
  );
}
