import type { JSX } from "solid-js";

/**
 * Calls a Solid event handler prop the way Solid itself would: a function
 * gets the event, a bound `[handler, data]` pair gets the data first. It
 * returns what the handler returned, so a caller can wait on a promise.
 */
export function callEventHandler<T, E extends Event>(
    handler: JSX.EventHandlerUnion<T, E> | undefined,
    event: E & { currentTarget: T; target: Element },
): unknown {
    if (typeof handler === "function") {
        return (handler as (e: E) => unknown)(event);
    }
    if (Array.isArray(handler)) {
        return (handler[0] as (data: unknown, e: E) => unknown)(handler[1], event);
    }
    return undefined;
}
