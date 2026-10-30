import { AsyncLocalStorage } from "node:async_hooks";
import type { ActionProjectHandle, ServiceContext } from "@mileniumhq/paperapi";
import type { StoredServer } from "../servers";
import type { GameServerState } from "./types";
export interface ServerScope {
    server: StoredServer;
    legacy: boolean;
    ctx: ServiceContext<GameServerState>;
    project?: ActionProjectHandle;
    saveSettings(settings: Record<string, unknown>): Promise<void>;
    bindAction(def: any): any;
    locals: Map<symbol, unknown>;
    activeOperations: number;
    removing: boolean;
    unsubscribe: Array<() => void>;
}
const storage = new AsyncLocalStorage<ServerScope>();
export const currentServer = () => storage.getStore();
export const inServer = <T>(scope: ServerScope, work: () => T): T => storage.run(scope, work);
/** Mutable module state belongs to the current server, including timers and callbacks. */
export function serverLocal<T>(initial: () => T): () => T {
    const key = Symbol();
    // Unscoped pure/unit callers retain their own isolated module instance.
    const standalone = initial();
    return () => {
        const scope = currentServer();
        if (!scope) return standalone;
        if (!scope.locals.has(key)) scope.locals.set(key, initial());
        return scope.locals.get(key) as T;
    };
}
