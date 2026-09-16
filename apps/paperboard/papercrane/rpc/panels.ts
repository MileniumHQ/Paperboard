import type { RpcContext } from "./context";
import { logger } from "../logger";
import { assertConfigPath, assertId, assertPanelId, assertStr, assertOptStr, rpcErrorCode } from "./params";
import { forbidden } from "./errors";

// Since scoped tokens shipped, the socket's token claim is the identity —
// mirrors rpc/secrets.ts exactly (same shape, same typed errors): a
// panel-scoped caller naming any other panel is refused outright, master
// /host callers carry no claim and keep explicit-parameter behavior.
function effectivePanelId(requested: string, action: string, ctx: RpcContext): string {
    const claim = ctx.callerPanelId();
    if (claim && claim !== requested) {
        // TODO(deny after v3.2): the mismatch log below becomes the only
        // behavior — every disagreement is denied after v3.2.
        logger.warn(
            `[panels] cross-panel access refused: token claim "${claim}" ` +
            `requested "${requested}" via "${action}"`,
        );
        throw forbidden(
            `Cross-panel access refused: scope is limited to "${claim}"`,
        );
    }
    return requested;
}

export async function handlePanels(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    const { engine, reply } = ctx;
    try {
        switch (action) {
            case "panel:list": {
                reply(id, { panels: await engine.listPanels() });
                return true;
            }
            case "panel:install": {
                const panelId = assertPanelId(params?.panelId);
                // installing a panel is a host action, never panel equipment:
                // a scoped token grants one panel claim and no wider reach
                if (ctx.callerPanelId()) {
                    throw forbidden("panel:install is host-only; scoped panel tokens may not install");
                }
                const downloadUrl = assertStr(params?.downloadUrl, "downloadUrl", 8192);
                const sha256 = assertOptStr(params?.sha256, "sha256", 128);
                const manifest = await engine.installPanel(panelId, downloadUrl, sha256);
                reply(id, { panel: manifest });
                return true;
            }
            case "panel:uninstall": {
                const panelId = effectivePanelId(assertPanelId(params?.panelId), action, ctx);
                try {
                    const success = await engine.uninstallPanel(panelId);
                    if (!success) {
                        reply(id, null, `Invalid panel id: ${JSON.stringify(panelId)}`);
                        return true;
                    }
                    reply(id, { success: true });
                } catch (err: any) {
                    reply(id, null, `Uninstall failed: ${err?.message}`);
                }
                return true;
            }
            case "config:get": {
                try {
                    // config ids are panel-scoped (default config in
                    // configs/, an explicit path in the panel's files dir);
                    // a scoped caller may only touch its own claim.
                    // Assertion inside the try so traversal ids and paths
                    // are refused with the typed INVALID_PARAMS shape.
                    const requested = assertId(params?.id, "config id");
                    const panelId = effectivePanelId(requested, action, ctx);
                    const configPath = assertConfigPath(params?.path);
                    reply(id, { data: await engine.getConfig(panelId, configPath) });
                } catch (err: any) {
                    logger.debug("[panels] config:get refused:", err?.message || err);
                    reply(id, null, err?.message || "Invalid config id", rpcErrorCode(err));
                }
                return true;
            }
            case "config:set": {
                try {
                    const requested = assertId(params?.id, "config id");
                    const panelId = effectivePanelId(requested, action, ctx);
                    const configPath = assertConfigPath(params?.path);
                    reply(id, { success: await engine.setConfig(panelId, params?.data, configPath) });
                } catch (err: any) {
                    logger.debug("[panels] config:set refused:", err?.message || err);
                    reply(id, null, err?.message || "Invalid config id", rpcErrorCode(err));
                }
                return true;
            }
            default:
                return false;
        }
    } catch (err: any) {
        // codes travel on the error (RpcError, InvalidParams) — see rpc/errors.ts
        reply(id, null, err?.message || "Panel operation failed", rpcErrorCode(err));
        return true;
    }
}
