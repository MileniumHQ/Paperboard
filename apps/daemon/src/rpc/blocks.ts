// The Blocks registry (PaperAPI's blocksApi): panels register types,
// commands, values and events here, each one entry named "kind.id"
// (or "project/kind.id"), and the Blocks panel lists and calls them.
import { blocksRegistry } from "../server/actions";
import { ErrorCode } from "../core/protocol";
import type { RpcContext } from "./context";
import { rpcModule } from "./dispatch";
import { Refusal } from "./errors";
import { InvalidParamsError } from "@mileniumhq/paperapi/protocol";
import { rpcErrorCode } from "./errors";
import { resourcePanelId } from "../security/principal";
import { errorMessage } from "@mileniumhq/paperapi/errors";

export function ownNamespace(panelId: string, ctx: RpcContext): string {
    return resourcePanelId(ctx.callerPanelId(), panelId)!;
}

/** A registry refusal: the namespace belongs to another socket. */
export function ownedElsewhere(result: { ok: boolean; block?: string }, what: string): void {
    if (!result.ok) throw new Refusal(result.block === undefined ? what : `${what}: block "${result.block}"`, ErrorCode.CONFLICT);
}

// a registry call's own failure is answered as it is, typed by its code
export async function answeredAs<T>(call: () => Promise<T>): Promise<{ result: T }> {
    try {
        return { result: await call() };
    } catch (err) {
        throw new Refusal(errorMessage(err) || String(err), rpcErrorCode(err));
    }
}

const conflict = (what: string, panelId: string) =>
    `Registry namespace is owned by another socket: ${what} for panel "${panelId}" conflicts`;

export const blocksRpc = rpcModule({
    // one registration pass of a panel's blocks
    "blocks:register-set": ({ panelId, entries }, ctx) => {
        const owner = ownNamespace(panelId, ctx);
        if (entries.length === 0) throw new InvalidParamsError("blocks:register-set needs at least one entry");
        ownedElsewhere(blocksRegistry.register(owner, entries, ctx.ws), conflict(`a set of ${entries.length} blocks`, owner));
        ctx.broadcastEvent("blocks:registry-updated", { type: "blocks:registered", panelId: owner, entries: entries.map((e) => e.entry) });
        return { success: true };
    },
    // one block at a time, as panels built before blocks:register-set ask;
    // goes at the next protocol version
    "blocks:register": ({ panelId, entry, schema }, ctx) => {
        const owner = ownNamespace(panelId, ctx);
        ownedElsewhere(blocksRegistry.register(owner, [{ entry, schema }], ctx.ws), conflict("a block", owner));
        ctx.broadcastEvent("blocks:registry-updated", { type: "block:registered", panelId: owner, entry });
        return { success: true };
    },
    "blocks:unregister": ({ panelId, entry }, ctx) => {
        const owner = ownNamespace(panelId, ctx);
        ownedElsewhere(blocksRegistry.unregister(owner, entry, ctx.ws), conflict(`block "${entry}"`, owner));
        ctx.broadcastEvent("blocks:registry-updated", { type: "block:unregistered", panelId: owner, entry });
        return { success: true };
    },
    "blocks:project-define": ({ panelId, project, name, icon, image }, ctx) => {
        const owner = ownNamespace(panelId, ctx);
        ownedElsewhere(blocksRegistry.defineProject(owner, { id: project, name, icon, image }, ctx.ws), conflict(`project "${project}"`, owner));
        ctx.broadcastEvent("blocks:registry-updated", { type: "project:defined", panelId: owner, project });
        return { success: true };
    },
    "blocks:project-remove": ({ panelId, project }, ctx) => {
        const owner = ownNamespace(panelId, ctx);
        ownedElsewhere(blocksRegistry.removeProject(owner, project, ctx.ws), conflict(`project "${project}"`, owner));
        ctx.broadcastEvent("blocks:registry-updated", { type: "project:removed", panelId: owner, project });
        return { success: true };
    },
    "blocks:projects": ({ panelId }) => ({ projects: blocksRegistry.listProjects(panelId) }),
    // an internal block is its panel's own, called by name: never listed,
    // so no toolbox, flow or agent is offered it
    "blocks:list": ({ panelId }) => ({
        entries: blocksRegistry
            .list(panelId)
            .filter((e) => e.schema?.internal !== true)
            .map((e) => ({ panelId: e.panelId, entry: e.action, ...(e.project !== undefined ? { project: e.project } : {}), schema: e.schema })),
    }),
    "blocks:call": ({ panelId, entry, request, timeoutMs }, ctx) =>
        answeredAs(() => blocksRegistry.call(panelId, entry, [request ?? null], ctx.ws, timeoutMs === undefined ? 30_000 : timeoutMs, ctx.callerPanelId())),
    // an event firing, or a value saying it changed: delivered to whoever
    // subscribed to "blocks:<panel>:<entry>"
    "blocks:emit": ({ panelId, entry, payload }, ctx) => {
        const owner = ownNamespace(panelId, ctx);
        const kind = entry.slice(entry.indexOf("/") + 1).split(".")[0];
        if (kind !== "event" && kind !== "value") {
            throw new InvalidParamsError(`Only events fire and only values change; "${entry}" is neither`);
        }
        ctx.broadcastEvent(`blocks:${owner}:${entry}`, payload ?? null);
        return { success: true };
    },
});
