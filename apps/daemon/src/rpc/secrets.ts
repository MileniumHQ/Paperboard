import { logger } from "../logger";
import type { RpcContext } from "./context";
import { rpcModule } from "./dispatch";
import { resourcePanelId } from "../principal";

// Every secrets call names its panel explicitly, and the socket's token
// claim is the identity: a panel-scoped caller naming any other panel is
// refused outright. Master/host callers carry no claim and keep the
// explicit-parameter behavior.
const vaultOf = (panelId: string, action: string, ctx: RpcContext) => resourcePanelId(ctx.callerPanelId(), panelId, action)!;

export const secretsRpc = rpcModule({
    "secrets:set": ({ panelId, name, value }, ctx, action) => {
        ctx.engine.setSecret(name, value, vaultOf(panelId, action, ctx));
        return { success: true };
    },
    "secrets:get": ({ panelId, name }, ctx, action) => ctx.engine.getSecret(name, vaultOf(panelId, action, ctx)),
    "secrets:delete": ({ panelId, name }, ctx, action) => ({ deleted: ctx.engine.deleteSecret(name, vaultOf(panelId, action, ctx)) }),
    // cross-panel listing is engine-internal; on the wire every list call
    // is scoped to the named panel — no widening flag travels over the wire
    "secrets:list": ({ panelId }, ctx, action) => ({ keys: ctx.engine.listSecrets(vaultOf(panelId, action, ctx)) }),
    "secrets:purge": ({ panelId }, ctx, action) => {
        // purge is destructive and cross-panel-capable: visible
        logger.warn(`[secrets] purge requested for "${panelId}"`);
        return { purged: ctx.engine.purgeSecrets(vaultOf(panelId, action, ctx)) };
    },
}, "Secrets operation failed");
