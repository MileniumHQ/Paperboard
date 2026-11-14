// Calls the daemon makes into this transport's handlers (an `action_call`
// frame), and the scope a handler runs in while it answers one.
import type { AsyncLocalStorage as CallStorage } from "async_hooks";

import { debugErr } from "../debug";
import type { TransportRegistry } from "./registry";
import { nodeBuiltin } from "./socket";

// The action call a service is answering, for the requests it makes while
// doing so. Some requests stop the service that makes them (a backup pauses
// its own panel's service), and the daemon, which cannot get the action's
// answer from a service it stopped, needs to know which call to answer for it.
// Only Node runs a service; other contexts have nothing to carry.
interface ActionCallScope {
    run<T>(callId: string, fn: () => T): T;
    current(): string | undefined;
}
let actionCallScope: ActionCallScope | undefined;

export async function loadActionCallScope(): Promise<void> {
    if (actionCallScope) return;
    const { AsyncLocalStorage } = await nodeBuiltin("async_hooks");
    const storage: CallStorage<string> = new AsyncLocalStorage();
    actionCallScope = { run: (callId, fn) => storage.run(callId, fn), current: () => storage.getStore() };
}

/** The call being answered where this runs, if any. */
export function currentActionCall(): string | undefined {
    return actionCallScope?.current();
}

export interface ActionCallFrame {
    callId: string;
    panelId: string;
    action: string;
    args: unknown;
}

/**
 * Runs the handler an action_call names and sends its reply with `send`.
 * Dispatch is namespaced: only the unique `panelId:action` owner answers, and
 * a bare or unknown name is refused rather than resolved last-writer-wins.
 */
export function answerActionCall(registry: TransportRegistry, call: ActionCallFrame, send: (reply: Record<string, unknown>) => void): void {
    const { callId, panelId, action, args } = call;
    const handler = registry.getHandler(`${panelId}:${action}`);
    if (!handler) {
        send({ type: "action_reply", callId, error: `Handler for action '${action}' not found` });
        return;
    }
    // the reply is sent once the handler settles, which can be after
    // the connection closed (a daemon restart mid-call): an undeliverable
    // reply is reported here, never thrown out of the handler's chain
    const reply = (outcome: { result: unknown } | { error: string }) => {
        try {
            send({ type: "action_reply", callId, ...outcome });
            return;
        } catch (err) {
            if ("error" in outcome) {
                debugErr(`reply to ${panelId}:${action} (call ${callId}) was not delivered`, err);
                return;
            }
            // a result that cannot be sent (unserializable, or the
            // connection is gone) is answered as the call's error
            reply({ error: `The action's result could not be sent: ${(err as Error)?.message || String(err)}` });
        }
    };
    Promise.resolve()
        .then(() => {
            const run = () => handler(...(Array.isArray(args) ? args : []));
            return actionCallScope ? actionCallScope.run(callId, run) : run();
        })
        .then(
            (result) => reply({ result: result === undefined ? null : result }),
            (err: any) => reply({ error: err?.message || String(err) }),
        );
}
