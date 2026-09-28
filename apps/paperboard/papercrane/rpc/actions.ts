import { actionsRegistry } from "../actions";
import { ErrorCode } from "../protocol";
import type { RpcContext } from "./context";
import { assertPanelId, assertStr, assertOptStr, assertNum, InvalidParamsError, rpcErrorCode } from "./params";

// outstanding calls cap from the registry surface (mirrors the client's
// PaperAPI MAX_PENDING_CALLS = 1000)
const ACTIONS_CALL_TIMEOUT_MAX_MS = 60_000;

// a longer timeout than this is refused at the rpc boundary, not clamped
// silently: typed INVALID_PARAMS below, the wire answers the caller.
export function assertCallTimeout(value: unknown, name: string, fallback?: number): number {
    const n = assertNum(value, name, fallback);
    if (n > ACTIONS_CALL_TIMEOUT_MAX_MS) {
        throw new InvalidParamsError(
            `Parameter "${name}" exceeds ${ACTIONS_CALL_TIMEOUT_MAX_MS} ms cap`,
        );
    }
    return n;
}

// Malformed calls throw InvalidParamsError and the WS dispatcher answers
// INVALID_PARAMS — no per-case catch needed. Registry conflicts keep
// their CONFLICT shape below; registry call failures answer untyped,
// exactly like before.
export async function handleActions(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    const { ws, reply, broadcastEvent } = ctx;
    switch (action) {
        case "actions:register":
        case "action:register": {
            const panelId = assertPanelId(params?.panelId);
            const act = assertOptStr(params?.action, "action", 256);
            const acts = params?.actions;
            const schema = params?.schema;
            if (Array.isArray(acts)) {
                const result = actionsRegistry.registerMultiple(panelId, acts, ws);
                if (!result.ok) {
                    reply(
                        id,
                        null,
                        `Registry namespace is owned by another socket: action registration for panel "${panelId}" conflicts`,
                        ErrorCode.CONFLICT,
                    );
                    return true;
                }
            } else if (act) {
                const result = actionsRegistry.register(panelId, act, ws, schema);
                if (!result.ok) {
                    reply(
                        id,
                        null,
                        `Registry namespace is owned by another socket: action "${act}" for panel "${panelId}" conflicts`,
                        ErrorCode.CONFLICT,
                    );
                    return true;
                }
            } else {
                // a registration naming nothing must not answer success:
                // success means registered, and nothing was
                throw new InvalidParamsError(
                    'actions:register requires "action" or "actions"',
                );
            }
            broadcastEvent("actions:registry-updated", { type: "action:registered", panelId, action: act, actions: acts });
            reply(id, { success: true });
            return true;
        }
        case "actions:unregister":
        case "action:unregister": {
            const panelId = assertPanelId(params?.panelId);
            const act = assertOptStr(params?.action, "action", 256);
            const result = actionsRegistry.unregister(panelId, act, ws);
            if (!result.ok) {
                reply(
                    id,
                    null,
                    `Registry namespace is owned by another socket: cannot unregister action "${act}" for panel "${panelId}"`,
                    ErrorCode.CONFLICT,
                );
                return true;
            }
            broadcastEvent("actions:registry-updated", { type: "action:unregistered", panelId, action: act });
            reply(id, { success: true });
            return true;
        }
        case "actions:call":
        case "action:call": {
            const panelId = assertPanelId(params?.panelId);
            const act = assertStr(params?.action, "action", 256);
            const args = params?.args;
            const timeoutMs = assertCallTimeout(params?.timeoutMs, "timeoutMs", 30_000);
            try {
                const result = await actionsRegistry.call(panelId, act, Array.isArray(args) ? args : [], ws, timeoutMs);
                reply(id, { result });
            } catch (err: any) {
                reply(id, null, err?.message || String(err), rpcErrorCode(err));
            }
            return true;
        }
        case "actions:list":
        case "action:list": {
            reply(id, { actions: actionsRegistry.list(assertOptStr(params?.panelId, "panelId", 128)) });
            return true;
        }
        case "actions:emit":
        case "action:emit":
        case "event:emit": {
            const panelId = assertPanelId(params?.panelId);
            const evt = assertStr(params?.event, "event", 256);
            broadcastEvent(`actions:${panelId}:${evt}`, params?.payload);
            reply(id, { success: true });
            return true;
        }
        case "triggers:emit":
        case "trigger:emit": {
            const panelId = assertPanelId(params?.panelId);
            const trigger = assertStr(params?.trigger, "trigger", 256);
            broadcastEvent(`triggers:${panelId}:${trigger}`, params?.output);
            reply(id, { success: true });
            return true;
        }
        default:
            return false;
    }
}
