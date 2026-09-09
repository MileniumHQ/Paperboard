import type { RpcContext } from "./context";

export async function handleFiles(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    const { engine, reply, sendEvent } = ctx;
    switch (action) {
        case "file:getPath": {
            reply(id, { path: engine.getFilePath(params.targetPath, params.appId) });
            return true;
        }
        case "file:exists": {
            reply(id, { exists: await engine.fileExists(params.targetPath, params.appId) });
            return true;
        }
        case "file:write": {
            reply(id, { path: await engine.writeFile(params.targetPath, params.content, params.appId) });
            return true;
        }
        case "file:read": {
            reply(id, { content: await engine.readFile(params.targetPath, params.appId) });
            return true;
        }
        case "file:delete": {
            reply(id, { success: await engine.deleteFile(params.targetPath, params.appId) });
            return true;
        }
        case "file:clear": {
            reply(id, { success: await engine.clearFiles(params.appId) });
            return true;
        }
        case "file:download": {
            const dest = await engine.downloadFile(
                params.url,
                params.targetPath,
                params.appId,
                params.downloadId,
                params.options || {},
                (progress) =>
                    sendEvent("progress", {
                        ...progress,
                        downloadId: params.downloadId,
                    }),
            );
            reply(id, { path: dest });
            return true;
        }
        default:
            return false;
    }
}
