import { logger } from "../logger";
import type { RpcContext } from "./context";
import { assertPanelId, rpcErrorCode } from "./params";
import { invalidParams } from "./errors";
import { resourcePanelId } from "../principal";

// every secrets call names its panel explicitly; the vault's isolation is
// panel-id-scoped at this boundary
function validatePanelId(params: any, action: string): string {
    try {
        return assertPanelId(params?.panelId);
    } catch {
        throw invalidParams(`Secrets "${action}" requires an explicit panelId`);
    }
}

// Since scoped tokens shipped, the socket's token claim is the identity:
// a panel-scoped caller naming any other panel is refused outright (no
// legitimate flow does that, so nothing breaks). Master/host callers
// carry no claim and keep the explicit-parameter behavior.
function effectivePanelId(params: any, action: string, ctx: RpcContext): string {
    const requested = validatePanelId(params, action);
    return resourcePanelId(ctx.callerPanelId(), requested, action)!;
}

export async function handleSecrets(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    const { engine, reply } = ctx;
    try {
        switch (action) {
            case "secrets:set": {
                const panelId = effectivePanelId(params, action, ctx);
                engine.setSecret(params.name, params.value, panelId);
                reply(id, { success: true });
                return true;
            }
            case "secrets:get": {
                const panelId = effectivePanelId(params, action, ctx);
                reply(id, engine.getSecret(params.name, panelId));
                return true;
            }
            case "secrets:delete": {
                const panelId = effectivePanelId(params, action, ctx);
                reply(id, { deleted: engine.deleteSecret(params.name, panelId) });
                return true;
            }
            case "secrets:list": {
                // cross-panel listing is engine-internal; on the wire every
                // list call is scoped to the named panel — no widening flag
                // travels over the wire
                const panelId = effectivePanelId(params, action, ctx);
                reply(id, { keys: engine.listSecrets(panelId) });
                return true;
            }
            case "secrets:purge": {
                // purge is destructive and cross-panel-capable: visible
                logger.warn(`[secrets] purge requested for "${params?.panelId}"`);
                const panelId = effectivePanelId(params, action, ctx);
                reply(id, { purged: engine.purgeSecrets(panelId) });
                return true;
            }
            default:
                return false;
        }
    } catch (err: any) {
        // codes travel on the error (RpcError, SecretError, InvalidParams);
        // message-text regex matching is banned — see rpc/errors.ts
        reply(id, null, err?.message || "Secrets operation failed", rpcErrorCode(err));
        return true;
    }
}
