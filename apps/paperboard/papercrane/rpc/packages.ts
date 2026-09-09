import type { RpcContext } from "./context";

export async function handlePackages(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    const { engine, reply, sendEvent } = ctx;
    switch (action) {
        case "package:isInstalled": {
            reply(id, { installed: engine.isPackageInstalled(params.packageName, params.version) });
            return true;
        }
        case "package:getIndex": {
            reply(id, { index: engine.getPackageIndex() });
            return true;
        }
        case "package:getPath": {
            reply(id, { path: engine.getPackagePath(params.packageName) });
            return true;
        }
        case "package:download": {
            const targetDir = await engine.downloadPackage(
                params.packageName,
                params.downloadId,
                (progress) =>
                    sendEvent("progress", {
                        ...progress,
                        downloadId: params.downloadId,
                    }),
            );
            reply(id, { path: targetDir });
            return true;
        }
        default:
            return false;
    }
}
