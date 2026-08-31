import { createHash, randomBytes } from "node:crypto";

/**
 * RED TIER — never cache, see SESS_Caching_Strategy.docx Section 3.
 *
 * Section 8: "Never put passwords, tokens, API keys or Clerk secrets in an
 * application cache." A plaintext agent token exists only inside the single
 * response that issues it; what is persisted is its SHA-256 hash, and neither
 * form is ever placed in the Data Cache, a CDN, Redis or any other layer.
 */

/**
 * Agent-token helpers.
 *
 * Lives in lib/ rather than the route because a Next.js route module may only
 * export its HTTP handlers — anything else is a build error.
 */

/**
 * A 256-bit secret. Prefixed so a leaked string is recognisable in a log or a
 * support ticket for what it is, and can be revoked on sight.
 */
export function newAgentToken(): string {
  return `sess_agent_${randomBytes(32).toString("hex")}`;
}

/**
 * Short non-reversible fingerprint. Safe to write to the audit log and show in
 * HR's list — it identifies WHICH token without exposing the token itself.
 */
export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 8);
}
