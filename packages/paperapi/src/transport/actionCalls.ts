// Calls the daemon makes into this transport's handlers (an `action_call`
// frame).
import { debugErr } from "../debug";
import { errorMessage } from "../errors";
import type { TransportRegistry } from "./registry";

export interface ActionCallFrame {
    callId: string;
    panelId?: string;
    action: string;
    args?: unknown;
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
        .then(() => handler(...(Array.isArray(args) ? args : [])))
        .then(
            (result) => reply({ result: result === undefined ? null : result }),
            (err) => reply({ error: errorMessage(err) }),
        );
}
