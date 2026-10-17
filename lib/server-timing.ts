import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * TEMPORARY (2026-10-17) — Server-Timing diagnostics for the slow /manager
 * warm load. Remove together with app/api/debug/manager-timing and the
 * middleware block marked TEMPORARY once the cause is fixed.
 *
 * timed() is a pass-through unless a collectTimings() run is active, so the
 * instrumented code paths behave exactly as before for every normal request.
 * Only step names and durations are ever recorded — never data.
 */
type Mark = { name: string; ms: number };
const store = new AsyncLocalStorage<Mark[]>();

export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const marks = store.getStore();
  if (!marks) return fn();
  const t = performance.now();
  try {
    return await fn();
  } finally {
    marks.push({ name, ms: performance.now() - t });
  }
}

/** Runs fn with timing on and returns a Server-Timing header value. */
export async function collectTimings(fn: () => Promise<unknown>): Promise<string> {
  const marks: Mark[] = [];
  const t = performance.now();
  await store.run(marks, fn);
  marks.push({ name: "total", ms: performance.now() - t });
  return marks.map((m) => `${m.name};dur=${m.ms.toFixed(1)}`).join(", ");
}
