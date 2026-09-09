import type { RpcContext } from "./context";

export async function handlePanels(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    const { engine, reply } = ctx;
    switch (action) {
        case "panel:list": {
            reply(id, { panels: await engine.listPanels() });
            return true;
        }
        case "panel:install": {
            const manifest = await engine.installPanel(params.panelId, params.downloadUrl, params.sha256);
            reply(id, { panel: manifest });
            return true;
        }
        case "panel:uninstall": {
            const panelId = params.panelId;
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
            reply(id, { data: await engine.getConfig(params.id) });
            return true;
        }
        case "config:set": {
            reply(id, { success: await engine.setConfig(params.id, params.data) });
            return true;
        }
        default:
            return false;
    }
}
