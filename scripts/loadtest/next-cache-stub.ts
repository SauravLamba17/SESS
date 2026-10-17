// next/cache stand-in for the load-test harness.
//   default      — no Data Cache: every cached reader goes to the database every
//                  time (the worst case).
//   LT_CACHE=on  — a process-wide memo keyed like unstable_cache (key parts +
//                  arguments), TTL ignored. A hit returns a JSON round-tripped
//                  copy, as Next's Data Cache does, so a cached value that
//                  would not survive serialisation shows up here too.
const memo = new Map<string, string>();
export function unstable_cache<T extends (...args: never[]) => unknown>(fn: T, keyParts: string[] = []): T {
  if (process.env.LT_CACHE !== "on") return fn;
  return (async (...args: never[]) => {
    const k = JSON.stringify([keyParts, args]);
    const hit = memo.get(k);
    if (hit !== undefined) return JSON.parse(hit);
    const v = await fn(...args);
    memo.set(k, JSON.stringify(v));
    return v;
  }) as unknown as T;
}
export function revalidateTag(): void {}
export function revalidatePath(): void {}
