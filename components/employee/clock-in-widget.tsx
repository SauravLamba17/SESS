"use client";

import { useState } from "react";
import { Fingerprint, Loader2, MapPin } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { StatusDot, type StatusState } from "@/components/ui/status-dot";

type Phase = "idle" | "locating" | "punching";

interface PunchResult {
  ok: boolean;
  punchType?: "IN" | "OUT";
  status?: "success" | "late" | "flagged" | "already_complete";
  reason?: string | null;
  message?: string;
  error?: string;
  checkIn?: string | null;
  checkOut?: string | null;
}

const STATUS_UI: Record<string, { state: StatusState; label: string }> = {
  success: { state: "good", label: "Recorded" },
  late: { state: "warn", label: "Recorded — late" },
  flagged: { state: "danger", label: "Flagged for review" },
  already_complete: { state: "idle", label: "Already complete today" },
};

function getPosition(): Promise<{ lat: number | null; long: number | null }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ lat: null, long: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({ lat: pos.coords.latitude, long: pos.coords.longitude }),
      // Denied or unavailable → send nulls; server records the punch and
      // flags it if geofencing is required. Never blocks the punch.
      () => resolve({ lat: null, long: null }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  });
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ClockInWidget() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<PunchResult | null>(null);

  const busy = phase !== "idle";

  async function punch() {
    setResult(null);
    setPhase("locating");
    const { lat, long } = await getPosition();

    setPhase("punching");
    try {
      const res = await fetch("/api/attendance/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, long }),
      });
      const data = (await res.json()) as PunchResult;
      setResult(data);
    } catch {
      setResult({ ok: false, error: "Network error — please try again." });
    } finally {
      setPhase("idle");
    }
  }

  const ui = result?.status ? STATUS_UI[result.status] : null;
  const hasGeo = result?.reason?.toLowerCase().includes("geoloc");

  return (
    <Panel className="p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot
              state={ui?.state ?? (result?.ok === false ? "danger" : "idle")}
            />
            <span className="text-sm font-medium text-text">
              Web Attendance
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Camera-verified web punch. Location is used to confirm you&apos;re
            on-site.
          </p>
        </div>

        <button
          type="button"
          onClick={punch}
          disabled={busy}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded bg-accent px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
        >
          {phase === "locating" ? (
            <>
              <MapPin size={16} className="animate-pulse" />
              Getting location…
            </>
          ) : phase === "punching" ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Recording…
            </>
          ) : (
            <>
              <Fingerprint size={16} />
              Punch attendance
            </>
          )}
        </button>
      </div>

      {/* Result / error surface — no silent failures. */}
      {result && (
        <div
          className="mt-4 rounded border border-border bg-surface-raised px-3 py-2.5 text-sm"
          role="status"
          aria-live="polite"
        >
          {result.ok && ui ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <StatusDot state={ui.state} />
                <span className="text-text">
                  {result.punchType === "OUT" ? "Check-out" : "Check-in"} ·{" "}
                  {ui.label}
                </span>
              </div>
              <div className="flex items-center gap-4 font-mono text-xs text-text-muted">
                <span>in {fmtTime(result.checkIn)}</span>
                <span>out {fmtTime(result.checkOut)}</span>
              </div>
              {result.reason && (
                <p className="mt-1 text-xs text-danger">
                  Reason: {result.reason}
                  {hasGeo && " — enable location access and try again."}
                </p>
              )}
              {result.message && !result.reason && (
                <p className="text-xs text-text-muted">{result.message}</p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-danger">
              <StatusDot state="danger" />
              <span>{result.error ?? "Punch failed. Please try again."}</span>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
