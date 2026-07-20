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
  const body = b64urlEncode(JSON.stringify(p));
  const sig = await hmacHex(body);
  return `${body}.${sig}`;
}

/**
 * Verify a token and return its payload — ONLY if the signature is valid AND
 * the payload is bound to `realUserId`. Returns null otherwise. The caller is
 * still responsible for checking that the real user is actually a Super Admin.
 */
export async function verifyImpersonation(
  token: string | undefined,
  realUserId: string,
): Promise<ImpersonationPayload | null> {
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
