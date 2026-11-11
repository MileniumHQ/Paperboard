// The Blocks registry (Actions API v2, PaperAPI's blocksApi): panels
// register types, commands, values and events here, each one entry named
// "kind.id" (or "project/kind.id"), and the Blocks panel lists and calls
// them. It is the Actions registry's machinery as a separate registry, so
// v1 actions and v2 blocks never see each other's names.
import { MAX_PROJECT_IMAGE, blocksRegistry } from "../actions";
import { ErrorCode } from "../protocol";
import type { RpcContext } from "./context";
import { resourcePanelId } from "../principal";
import { assertPanelId, assertStr, assertOptStr, InvalidParamsError, rpcErrorCode } from "./params";
import { assertCallTimeout } from "./actions";

// what a registry entry is named: a kind, a dot and the definition's id,
// optionally inside a project ("server1/command.kick-player")
const ENTRY_PATTERN = /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/)?(type|command|value|event)\.[a-z0-9][a-z0-9-]{0,63}$/;

function assertEntry(value: unknown, name: string): string {
    const entry = assertStr(value, name, 256);
    if (!ENTRY_PATTERN.test(entry)) {
        throw new InvalidParamsError(`Parameter "${name}" must name a block entry ("kind.id" or "project/kind.id"), got "${entry}"`);
    }
    return entry;
}

function ownPanelId(params: any, action: string, ctx: RpcContext): string {
    return resourcePanelId(ctx.callerPanelId(), assertPanelId(params?.panelId), action)!;
}

const conflict = (what: string, panelId: string) =>
    `Registry namespace is owned by another socket: ${what} for panel "${panelId}" conflicts`;

export async function handleBlocks(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    const { ws, reply, broadcastEvent } = ctx;
    switch (action) {
        case "blocks:register": {
            const panelId = ownPanelId(params, action, ctx);
            const entry = assertEntry(params?.entry, "entry");
            if (!params?.schema || typeof params.schema !== "object") {
                throw new InvalidParamsError('blocks:register requires a "schema" object');
            }
            const result = blocksRegistry.register(panelId, entry, ws, params.schema);
            if (!result.ok) {
                reply(id, null, conflict(`block "${entry}"`, panelId), ErrorCode.CONFLICT);
                return true;
            }
            broadcastEvent("blocks:registry-updated", { type: "block:registered", panelId, entry });
            reply(id, { success: true });
            return true;
        }
        case "blocks:unregister": {
            const panelId = ownPanelId(params, action, ctx);
            const entry = assertEntry(params?.entry, "entry");
            const result = blocksRegistry.unregister(panelId, entry, ws);
            if (!result.ok) {
                reply(id, null, conflict(`block "${entry}"`, panelId), ErrorCode.CONFLICT);
                return true;
            }
            broadcastEvent("blocks:registry-updated", { type: "block:unregistered", panelId, entry });
            reply(id, { success: true });
            return true;
        }
        case "blocks:project-define": {
            const panelId = ownPanelId(params, action, ctx);
            const projectId = assertStr(params?.project, "project", 64);
            const name = assertStr(params?.name, "name", 128);
            const icon = assertOptStr(params?.icon, "icon", 128);
            const image = assertOptStr(params?.image, "image", MAX_PROJECT_IMAGE);
            const result = blocksRegistry.defineProject(panelId, { id: projectId, name, icon, image }, ws);
            if (!result.ok) {
                reply(id, null, conflict(`project "${projectId}"`, panelId), ErrorCode.CONFLICT);
                return true;
            }
            broadcastEvent("blocks:registry-updated", { type: "project:defined", panelId, project: projectId });
            reply(id, { success: true });
            return true;
        }
        case "blocks:project-remove": {
            const panelId = ownPanelId(params, action, ctx);
            const projectId = assertStr(params?.project, "project", 64);
            const result = blocksRegistry.removeProject(panelId, projectId, ws);
            if (!result.ok) {
                reply(id, null, conflict(`project "${projectId}"`, panelId), ErrorCode.CONFLICT);
                return true;
            }
            broadcastEvent("blocks:registry-updated", { type: "project:removed", panelId, project: projectId });
            reply(id, { success: true });
            return true;
        }
        case "blocks:projects": {
            reply(id, { projects: blocksRegistry.listProjects(assertOptStr(params?.panelId, "panelId", 128)) });
            return true;
        }
        case "blocks:list": {
            const entries = blocksRegistry.list(assertOptStr(params?.panelId, "panelId", 128));
            reply(id, {
                entries: entries.map((e) => ({ panelId: e.panelId, entry: e.action, ...(e.project !== undefined ? { project: e.project } : {}), schema: e.schema })),
            });
            return true;
        }
        case "blocks:call": {
            const panelId = assertPanelId(params?.panelId);
            const entry = assertEntry(params?.entry, "entry");
            const timeoutMs = assertCallTimeout(params?.timeoutMs, "timeoutMs", 30_000);
            try {
                const result = await blocksRegistry.call(panelId, entry, [params?.request ?? null], ws, timeoutMs, ctx.callerPanelId());
                reply(id, { result });
            } catch (err: any) {
                reply(id, null, err?.message || String(err), rpcErrorCode(err));
            }
            return true;
        }
        case "blocks:emit": {
            // an event firing, or a value saying it changed: delivered to
            // whoever subscribed to "blocks:<panel>:<entry>"
            const panelId = ownPanelId(params, action, ctx);
            const entry = assertEntry(params?.entry, "entry");
            const kind = entry.slice(entry.indexOf("/") + 1).split(".")[0];
            if (kind !== "event" && kind !== "value") {
                throw new InvalidParamsError(`Only events fire and only values change; "${entry}" is neither`);
            }
            broadcastEvent(`blocks:${panelId}:${entry}`, params?.payload ?? null);
            reply(id, { success: true });
            return true;
        }
        default:
            return false;
    }
}
