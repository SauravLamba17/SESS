// node --import ./scripts/loadtest/register.mjs scripts/loadtest/harness.ts
import { register } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
register("./hooks.mjs", import.meta.url);
