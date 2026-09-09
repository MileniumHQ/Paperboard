import { actionsRegistry } from "../actions";
import type { RpcContext } from "./context";

export async function handleActions(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    const { ws, reply, broadcastEvent } = ctx;
    switch (action) {
        case "actions:register":
        case "action:register": {
            const panelId = params?.panelId;
            const act = params?.action;
            const acts = params?.actions;
            const schema = params?.schema;
            if (!panelId) {
                reply(id, null, "Missing required parameter: panelId");
                return true;
            }
            if (Array.isArray(acts)) {
                actionsRegistry.registerMultiple(panelId, acts, ws);
            } else if (act) {
                actionsRegistry.register(panelId, act, ws, schema);
            }
            broadcastEvent("actions:registry-updated", { type: "action:registered", panelId, action: act, actions: acts });
            reply(id, { success: true });
            return true;
        }
        case "triggers:register":
        case "trigger:register": {
            const panelId = params?.panelId;
            const trigger = params?.trigger;
            const schema = params?.schema;
            if (!panelId || !trigger) {
                reply(id, null, "Missing required parameters: panelId and trigger");
                return true;
            }
            actionsRegistry.registerTrigger(panelId, trigger, ws, schema);
            broadcastEvent("actions:registry-updated", { type: "trigger:registered", panelId, trigger });
            reply(id, { success: true });
            return true;
        }
        case "actions:unregister":
        case "action:unregister": {
            const panelId = params?.panelId;
            const act = params?.action;
            if (!panelId) {
                reply(id, null, "Missing required parameter: panelId");
                return true;
            }
            actionsRegistry.unregister(panelId, act, ws);
            broadcastEvent("actions:registry-updated", { type: "action:unregistered", panelId, action: act });
            reply(id, { success: true });
            return true;
        }
        case "triggers:unregister":
        case "trigger:unregister": {
            const panelId = params?.panelId;
            const trigger = params?.trigger;
            if (!panelId) {
                reply(id, null, "Missing required parameter: panelId");
                return true;
            }
            actionsRegistry.unregisterTrigger(panelId, trigger, ws);
            broadcastEvent("actions:registry-updated", { type: "trigger:unregistered", panelId, trigger });
            reply(id, { success: true });
            return true;
        }
        case "actions:call":
        case "action:call": {
            const panelId = params?.panelId;
            const act = params?.action;
            const args = params?.args;
            if (!panelId || !act) {
                reply(id, null, "Missing required parameters: panelId and action");
                return true;
            }
            try {
                const timeoutMs = typeof params?.timeoutMs === "number" ? params.timeoutMs : 30_000;
                const result = await actionsRegistry.call(panelId, act, Array.isArray(args) ? args : [], ws, timeoutMs);
                reply(id, { result });
            } catch (err: any) {
                reply(id, null, err?.message || String(err));
            }
            return true;
        }
        case "actions:list":
        case "action:list": {
            const panelId = params?.panelId;
            reply(id, { actions: actionsRegistry.list(panelId) });
            return true;
        }
        case "triggers:list":
        case "trigger:list": {
            const panelId = params?.panelId;
            reply(id, { triggers: actionsRegistry.listTriggers(panelId) });
            return true;
        }
        case "actions:emit":
        case "action:emit":
        case "event:emit": {
            const panelId = params?.panelId;
            const evt = params?.event;
            const payload = params?.payload;
            if (!panelId || !evt) {
                reply(id, null, "Missing required parameters: panelId and event");
                return true;
            }
            broadcastEvent("actions:event", { panelId, event: evt, payload });
            broadcastEvent(`actions:${panelId}:${evt}`, payload);
            reply(id, { success: true });
            return true;
        }
        case "triggers:emit":
        case "trigger:emit": {
            const panelId = params?.panelId;
            const trigger = params?.trigger;
            const output = params?.output;
            if (!panelId || !trigger) {
                reply(id, null, "Missing required parameters: panelId and trigger");
                return true;
            }
            broadcastEvent("triggers:event", { panelId, trigger, output });
            broadcastEvent(`triggers:${panelId}:${trigger}`, output);
            reply(id, { success: true });
            return true;
        }
        default:
            return false;
    }
}
