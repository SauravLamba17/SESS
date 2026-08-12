/**
 * The app's own public base URL, for links that leave the application —
 * currently just the Clerk invitation accept link (lib/employees/invite.ts).
 *
 * Deliberately dependency-free (no "server-only", no next/*, no Clerk): it is
 * read by lib/employees/invite.ts, which plain-Node verify scripts import
 * directly. Reading process.env is safe in every runtime this project uses.
 *
 * ─── WHY VERCEL_PROJECT_PRODUCTION_URL AND NOT VERCEL_URL ────────────────
 * Both are Vercel system variables, and neither includes the scheme.
 *
 *   VERCEL_URL                    the URL of THIS deployment. Unique per
 *                                 deployment (my-site-a1b2c3.vercel.app), so a
 *                                 link built from it dies with the deployment
 *                                 and is unusable under Deployment Protection.
 *   VERCEL_PROJECT_PRODUCTION_URL the project's stable production domain —
 *                                 the shortest production custom domain, or
 *                                 the .vercel.app one if there is no custom
 *                                 domain. Set even on preview deployments.
 *
 * An invitation email is read hours or days later and must land on production
 * even if a preview deployment happened to send it, so the production domain
 * is the correct choice and VERCEL_URL is only a last-resort fallback for the
 * case where system environment variables were never enabled on the project.
 *
 * Because it follows the custom domain automatically, moving this app to a
 * real domain later needs no code change and no env var edit.
 */

/** Local dev default — matches the port in package.json's `dev` script. */
const LOCAL_FALLBACK = "http://localhost:3005";

/** Strip any trailing slash so callers can always append "/path". */
function normalise(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Prepend https:// unless a scheme is already present (Vercel omits it). */
function withScheme(host: string): string {
  return /^https?:\/\//i.test(host) ? host : `https://${host}`;
}

/**
 * Resolve the public base URL, WITHOUT a trailing slash.
 *
 * Order, first match wins:
 *   1. NEXT_PUBLIC_APP_URL          explicit override; set this if the domain
 *                                   you want differs from Vercel's pick (a
 *                                   second custom domain, a staging host, or
 *                                   any non-Vercel deployment).
 *   2. VERCEL_PROJECT_PRODUCTION_URL  the normal production answer.
 *   3. VERCEL_URL                   only if system env vars are half-enabled.
 *   4. http://localhost:3005        local development.
 */
export function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return normalise(withScheme(explicit));

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return normalise(withScheme(production));

  const deployment = process.env.VERCEL_URL?.trim();
  if (deployment) return normalise(withScheme(deployment));

  return LOCAL_FALLBACK;
}

/** Absolute URL for an in-app path. `path` must start with "/". */
export function appUrl(path: string): string {
  return `${appBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
