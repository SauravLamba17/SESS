// Edge-safe impersonation cookie signing/verification.
//
// The cookie is an HMAC-signed payload (Web Crypto, works in both the Node
// runtime and the edge middleware). It is NOT forgeable without the server
// secret (CLERK_SECRET_KEY) and is bound to the real Super Admin's user id
// (`su`) — a copied cookie used under a different session fails verification.
//
// No "server-only" import and no Prisma here on purpose: middleware (edge)
// imports this. It never touches client bundles (only server code imports it).

import type { Role } from "@/lib/auth-types";

export const IMP_COOKIE = "sess_impersonation";

/**
 * THE MASTER SWITCH for the entire impersonation feature.
 *
 * Impersonation exists so a demo deployment can show all four portals from one
 * login. It has no place in a real production instance, where it would be a
 * standing "log in as anyone" capability guarded only by a role check.
 *
 * DEFAULT OFF, and deliberately strict: only the exact string "true" enables
 * it. Unset, empty, "TRUE", "1" and "yes" all mean off, so no accidental value
 * can switch it on.
 *
 * Read from process.env directly rather than cached, because this file is
 * imported by the edge middleware as well as Node server code — Next inlines
 * process.env at build time for edge, the same way this file already reads
 * CLERK_SECRET_KEY.
 */
export function demoModeEnabled(): boolean {
  return process.env.DEMO_MODE === "true";
}

export interface ImpersonationPayload {
  su: string; // the REAL Super Admin's Clerk user id (binding)
  cid: string; // impersonated User.clerkId (the effective identity)
  role: Role; // impersonated role
  eid: string; // impersonated Employee id
  code: string; // impersonated employeeCode (for the banner)
  name: string; // impersonated name (for the banner)
}

function secret(): string {
  return process.env.CLERK_SECRET_KEY ?? "";
}

function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(b64: string): string {
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmacHex(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const arr = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, "0");
  return hex;
}

/** Constant-time string comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function signImpersonation(p: ImpersonationPayload): Promise<string> {
  // Defence in depth. The server action refuses first, but if a future call
  // site ever forgets that check, no impersonation token can be minted at all
  // outside a demo deployment.
  if (!demoModeEnabled()) {
    throw new Error("Impersonation is disabled: DEMO_MODE is not enabled on this deployment.");
  }
  const body = b64urlEncode(JSON.stringify(p));
  const sig = await hmacHex(body);
  return `${body}.${sig}`;
}

/**
 * Verify a token and return its payload — ONLY if the signature is valid AND
 * the payload is bound to `realUserId`. Returns null otherwise. The caller is
 * still responsible for checking that the real user is actually a Super Admin.
 *
 * ─── WHY THE DEMO_MODE CHECK IS HERE AND NOT ONLY AT THE START ACTION ─────
 * Gating only the start action would leave impersonation *unstartable*, not
 * *inert*. The cookie is signed with CLERK_SECRET_KEY, which does not change
 * when DEMO_MODE does — so a token minted while demo mode was on (or lifted
 * from a demo deployment sharing the secret) would still verify afterwards,
 * and the holder would keep acting as someone else indefinitely.
 *
 * This function is the ONE place both consumers resolve a cookie into an
 * identity: lib/auth.ts's resolveIdentity() and the edge middleware. Refusing
 * here means that with DEMO_MODE off there is no code path in the application
 * that can turn any cookie, however well-formed, into an impersonated
 * identity. That is what makes the feature structurally inert rather than
 * merely hidden.
 */
export async function verifyImpersonation(
  token: string | undefined,
  realUserId: string,
): Promise<ImpersonationPayload | null> {
  if (!demoModeEnabled()) return null;
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmacHex(body);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const p = JSON.parse(b64urlDecode(body)) as ImpersonationPayload;
    // Binding: the cookie is only valid for the exact Super Admin it was issued to.
    if (p.su !== realUserId) return null;
    return p;
  } catch {
    return null;
  }
}
