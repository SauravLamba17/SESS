/**
 * Bootstrap for running real application modules under plain `node`.
 *
 * The repo's existing self-checks (lib/payroll/compute.selfcheck.ts) run
 * straight under node, which strips TypeScript types natively. lib/cache/* and
 * lib/invalidation/* need three things node does not give them on its own —
 * the "@/..." path alias and extensionless package subpaths (both handled in
 * ./alias-hooks.mjs), and globalThis.AsyncLocalStorage, which Next's server
 * bootstrap normally installs and which its async-storage modules throw
 * without.
 *
 * Usage:
 *   node --import ./scripts/alias-loader.mjs ./scripts/caching.selfcheck.ts
 */
import { register } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

register("./alias-hooks.mjs", import.meta.url);
