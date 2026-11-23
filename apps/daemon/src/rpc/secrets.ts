import { logger } from "../core/logger";
import type { RpcContext } from "./context";
import { rpcModule } from "./dispatch";
import { resourcePanelId } from "../security/principal";

const vaultOf = (panelId: string, ctx: RpcContext) => resourcePanelId(ctx.callerPanelId(), panelId)!;

export const secretsRpc = rpcModule({
    "secrets:set": ({ panelId, name, value }, ctx) => {
        ctx.engine.setSecret(name, value, vaultOf(panelId, ctx));
        return { success: true };
    },
    "secrets:get": ({ panelId, name }, ctx) => ctx.engine.getSecret(name, vaultOf(panelId, ctx)),
    "secrets:delete": ({ panelId, name }, ctx) => ({ deleted: ctx.engine.deleteSecret(name, vaultOf(panelId, ctx)) }),
    "secrets:list": ({ panelId }, ctx) => ({ keys: ctx.engine.listSecrets(vaultOf(panelId, ctx)) }),
    "secrets:purge": ({ panelId }, ctx) => {
        logger.warn(`[secrets] purge requested for "${panelId}"`);
        return { purged: ctx.engine.purgeSecrets(vaultOf(panelId, ctx)) };
    },
}, "Secrets operation failed");
