import { AsyncLocalStorage } from "node:async_hooks";
import type { BlocksProjectHandle, ServiceContext } from "@mileniumhq/paperapi";
import type { StoredServer } from "../servers";
import type { GameServerState } from "./types";
export interface ServerScope {
    server: StoredServer;
    legacy: boolean;
    processIds: readonly string[];
    ctx: ServiceContext<GameServerState>;
    /** the server's Blocks project */
    blocks?: BlocksProjectHandle;
    saveSettings(settings: Record<string, unknown>): Promise<void>;
    /** a game event the server's blocks fire for: `output` is what the game saw */
    trigger(id: string, output: unknown): void;
    locals: Map<symbol, unknown>;
    activeOperations: number;
    removing: boolean;
    unsubscribe: Array<() => void>;
}
const storage = new AsyncLocalStorage<ServerScope>();
const scopes = new WeakMap<object, ServerScope>();
/** Says which server a context belongs to; a game's events find their server through it. */
export function bindScope(ctx: object, scope: ServerScope): void {
    scopes.set(ctx, scope);
}
/** A game event (a join, a chat line, the server starting) for the server the context belongs to. */
export function emitTrigger(ctx: object, id: string, output: unknown): void {
    const scope = scopes.get(ctx);
    if (!scope) throw new Error(`The event ${id} came from a context that belongs to no server`);
    scope.trigger(id, output);
}
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
