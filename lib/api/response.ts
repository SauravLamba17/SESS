import { NextResponse } from "next/server";

/**
 * The single error-response shape every API route in this codebase returns.
 *
 * `{ error, code }` — `error` is the human sentence the UI shows, `code` is the
 * stable machine string the client branches on. Both are always present, and
 * the key ORDER is preserved from the 56 hand-written copies this replaces, so
 * a response body is byte-identical to what each route produced before.
 *
 * `extra` merges additional fields into the body — three routes need it
 * (careers/apply and agent/heartbeat return `retryAfter`, bulk-import returns
 * per-row `errors`). It is optional and spreading `undefined` adds nothing, so
 * the 53 routes that never pass it get exactly the two-key body they always
 * had. That is why one function can serve both former variants rather than two.
 *
 * lib/mfa-guard.ts uses this too, so the gate's 403 is built by the same
 * function as the handler's own errors and cannot drift into a different shape.
 */
export function fail(
  code: string,
  error: string,
  status: number,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({ error, code, ...extra }, { status });
}
