import { NextResponse } from "next/server";

/**
 * The single error-response shape every API route in this codebase returns.
 *
 * `{ error, code }` — `error` is the human sentence the UI shows, `code` is the
 * stable machine string the client branches on. Both are always present, and
 * the key ORDER is preserved from the hand-written copies this replaces, so a
 * response body is byte-identical to what each route produced before.
 *
 * Used by 56 API route files.
 *
 * `extra` merges additional fields into the body. Exactly ONE route needs it
 * today: app/api/agent/heartbeat, which adds `shouldPause: true` at four call
 * sites (plus `consentReason` at one) so the desktop agent knows to STOP rather
 * than treat the rejection as retryable. It is optional and spreading
 * `undefined` adds nothing, so the other 55 routes get exactly the two-key body
 * they always had — which is why one function serves both shapes, not two.
 *
 * NOT a universal wrapper: app/api/careers/apply hand-rolls its own 429 via
 * NextResponse.json because it must set a `Retry-After` HEADER, and `fail()`
 * takes no headers. That is the one deliberate exception.
 */
export function fail(
  code: string,
  error: string,
  status: number,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({ error, code, ...extra }, { status });
}
