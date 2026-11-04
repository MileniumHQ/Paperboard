import type { JSX } from "solid-js";

/**
 * Calls a Solid event handler prop the way Solid itself would: a function
 * gets the event, a bound `[handler, data]` pair gets the data first.
 */
export function callEventHandler<T, E extends Event>(
    handler: JSX.EventHandlerUnion<T, E> | undefined,
    event: E & { currentTarget: T; target: Element },
): void {
    if (typeof handler === "function") {
        handler(event);
    } else if (Array.isArray(handler)) {
        handler[0](handler[1], event);
    }
}
