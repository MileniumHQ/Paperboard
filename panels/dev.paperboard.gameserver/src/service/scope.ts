import { AsyncLocalStorage } from "node:async_hooks";
import type { Server } from "./server";
const storage = new AsyncLocalStorage<Server>();
const locals = new WeakMap<Server, Map<symbol, unknown>>();
export const currentServer = () => storage.getStore();
export const inServer = <T>(server: Server, work: () => T): T => storage.run(server, work);
/** Mutable module state belongs to the current server, including timers and callbacks. */
export function serverLocal<T>(initial: () => T): () => T {
    const key = Symbol();
    // Unscoped pure/unit callers retain their own isolated module instance.
    const standalone = initial();
    return () => {
        const server = currentServer();
        if (!server) return standalone;
        let own = locals.get(server);
        if (!own) locals.set(server, (own = new Map()));
        if (!own.has(key)) own.set(key, initial());
        return own.get(key) as T;
    };
}
