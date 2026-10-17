// Stand-in for lib/db.ts inside the load-test harness ONLY. Every property
// access is forwarded to the Prisma client bound to the current task through
// AsyncLocalStorage — so app lib code that imports `db` talks to "its own"
// one-connection client, exactly like a single warm Vercel instance.
import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@prisma/client";

export const instanceStore = new AsyncLocalStorage<PrismaClient>();

export const db = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    const c = instanceStore.getStore();
    if (!c) throw new Error("db used outside a bound load-test instance");
    const v = (c as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
});
