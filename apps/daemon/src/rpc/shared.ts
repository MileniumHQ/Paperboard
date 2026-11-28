// Shared documents (the daemon's network/shared.ts): whose they are is the
// caller's credential's to say. A panel's names its own panel and nothing
// else; the host names a panel's, or none for the shell's own, which no
// panel's credential reaches. No call names a space.
import type { RpcContext } from "./context";
import { rpcModule } from "./dispatch";
import { forbidden } from "./errors";
import { logger } from "../core/logger";
import { ownerOf, type SharedOwner } from "../network/shared";

function ownerFor(requested: string | undefined, ctx: RpcContext): SharedOwner {
    const caller = ctx.callerPanelId();
    if (caller === null) return ownerOf(requested ?? null);
    if (requested !== caller) {
        logger.warn(`[shared] panel "${caller}" asked for ${requested === undefined ? "Paperboard's shared settings" : `"${requested}"'s shared documents`}`);
        throw forbidden(
            requested === undefined
                ? `Paperboard's shared settings are the host's: this credential is scoped to "${caller}"`
                : `Shared documents are the panel's own: this credential is scoped to "${caller}", not "${requested}"`,
        );
    }
    return ownerOf(caller);
}

export const sharedRpc = rpcModule({
    "shared:get": ({ panelId, id }, ctx) => ({ document: ctx.shared.get(ownerFor(panelId, ctx), id) }),
    "shared:list": ({ panelId, prefix, ids }, ctx) => ({ documents: ctx.shared.list(ownerFor(panelId, ctx), { prefix, ids }) }),
    "shared:set": ({ panelId, id, value, basedOn }, ctx) => ctx.shared.set(ownerFor(panelId, ctx), id, value, basedOn),
    "shared:delete": ({ panelId, id, basedOn }, ctx) => ctx.shared.delete(ownerFor(panelId, ctx), id, basedOn),
    "shared:versions": ({ panelId, id }, ctx) => ({ versions: ctx.shared.versions(ownerFor(panelId, ctx), id) }),
    "shared:restore": async ({ panelId, id, version }, ctx) => ({ document: await ctx.shared.restore(ownerFor(panelId, ctx), id, version) }),
}, "Shared document operation failed");
