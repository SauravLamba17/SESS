"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint, Loader2, MapPin, LogOut, MessageSquare } from "lucide-react";
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
  code?: string;
  checkIn?: string | null;
  checkOut?: string | null;
  lateMinutes?: number | null;
}

const STATUS_UI: Record<string, { state: StatusState; label: string }> = {
  success: { state: "good", label: "Recorded" },
  late: { state: "warn", label: "Recorded — late" },
  flagged: { state: "danger", label: "Flagged for review" },
  already_complete: { state: "idle", label: "Already complete today" },
};

function getPosition(): Promise<{
  lat: number | null;
  long: number | null;
  /**
   * Radius of the reading's confidence circle in metres, straight from
   * GeolocationCoordinates.accuracy. The browser already computes it on every
   * call — it was simply being discarded. Travels with lat/long so a reviewer
   * knows how precise the coordinate is; it is never used to judge a punch.
   */
  accuracy: number | null;
}> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ lat: null, long: null, accuracy: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          long: pos.coords.longitude,
          // Spec-optional in practice: guard so a browser omitting it yields
          // null rather than NaN/undefined reaching the server.
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        }),
      // Denied or unavailable → send nulls; server records the punch and
      // flags it if geofencing is required. Never blocks the punch.
      () => resolve({ lat: null, long: null, accuracy: null }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  });
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ClockInWidget({
  initialCheckIn = null,
  initialCheckOut = null,
}: {
  initialCheckIn?: string | null;
  initialCheckOut?: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<PunchResult | null>(null);
  // Today's punch state — seeded from the server, updated after each punch.
  const [checkIn, setCheckIn] = useState<string | null>(initialCheckIn);
  const [checkOut, setCheckOut] = useState<string | null>(initialCheckOut);
  // Mandatory clock-in comment modal
  const [modalOpen, setModalOpen] = useState(false);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  const busy = phase !== "idle";
  const done = !!checkIn && !!checkOut;
  const clockedIn = !!checkIn && !checkOut;

  async function punch(noteText?: string) {
    setResult(null);
    setPhase("locating");
    const { lat, long, accuracy } = await getPosition();

    setPhase("punching");
    try {
      const res = await fetch("/api/attendance/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, long, accuracy, note: noteText ?? "" }),
      });
      const data = (await res.json()) as PunchResult;
      setResult(data);
      if (data.ok) {
        setCheckIn(data.checkIn ?? checkIn);
        setCheckOut(data.checkOut ?? null);
        setModalOpen(false);
        setNote("");
        router.refresh(); // keep dashboard cards in sync
      }
    } catch {
      setResult({ ok: false, error: "Network error — please try again." });
    } finally {
      setPhase("idle");
    }
  }

  function submitNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) {
      setNoteError("A comment is required to clock in.");
      return;
    }
    setNoteError(null);
    punch(note.trim());
  }

  const ui = result?.status ? STATUS_UI[result.status] : null;
  const hasGeo = result?.reason?.toLowerCase().includes("geoloc");

  return (
    <>
      <Panel className="p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusDot
                state={
                  done ? "idle" : clockedIn ? "good" : ui?.state ?? (result?.ok === false ? "danger" : "idle")
                }
              />
              <span className="text-sm font-medium text-text">Web Attendance</span>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {done
                ? `Completed today · in ${fmtTime(checkIn)} · out ${fmtTime(checkOut)}`
                : clockedIn
                  ? `Clocked in at ${fmtTime(checkIn)} — clock out when you finish.`
                  : "Location-tagged web punch. A comment is required to clock in."}
            </p>
          </div>

          {done ? (
            <span className="shrink-0 rounded border border-border px-4 py-2.5 text-sm text-text-muted">
              Completed for today
            </span>
          ) : clockedIn ? (
            <button
              type="button"
              onClick={() => punch()}
              disabled={busy}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded border border-accent bg-transparent px-4 py-2.5 text-sm font-medium text-accent transition-opacity hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
            >
              {phase === "locating" ? (
                <><MapPin size={16} className="animate-pulse" /> Getting location…</>
              ) : phase === "punching" ? (
                <><Loader2 size={16} className="animate-spin" /> Recording…</>
              ) : (
                <><LogOut size={16} /> Web Clock Out</>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { setNote(""); setNoteError(null); setModalOpen(true); }}
              disabled={busy}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded bg-accent px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
            >
              <Fingerprint size={16} /> Web Clock In
            </button>
          )}
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
                    {result.punchType === "OUT" ? "Check-out" : "Check-in"} · {ui.label}
                    {result.status === "late" && result.lateMinutes != null
                      ? ` (${result.lateMinutes} min)`
                      : ""}
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

      {/* Mandatory comment modal (clock-in only) */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clockin-title"
        >
          <form
            onSubmit={submitNote}
            className="w-full max-w-md rounded border border-border bg-surface p-5 shadow-panel"
          >
            <div className="mb-2 flex items-center gap-2">
              <MessageSquare size={16} className="text-accent" />
              <h2 id="clockin-title" className="text-sm font-semibold text-text">
                Comment required to clock in
              </h2>
            </div>
            <p className="mb-3 text-xs text-text-muted">
              Your manager requires a comment with every web clock-in. Add a short note about
              what you&apos;re starting on.
            </p>
            <textarea
              autoFocus
              rows={4}
              value={note}
              onChange={(e) => { setNote(e.target.value); if (noteError) setNoteError(null); }}
              placeholder="e.g. Starting on the assembly line batch #482"
              aria-invalid={!!noteError}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            {noteError && <p className="mt-1 text-xs text-danger">{noteError}</p>}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={busy}
                className="rounded border border-border px-3 py-2 text-sm text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !note.trim()}
                className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
              >
                {phase === "locating" ? (
                  <><MapPin size={15} className="animate-pulse" /> Getting location…</>
                ) : phase === "punching" ? (
                  <><Loader2 size={15} className="animate-spin" /> Clocking in…</>
                ) : (
                  <><Fingerprint size={15} /> Confirm clock in</>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
