import type { RpcContext } from "./context";
import { assertStr, assertOptStr } from "./params";

export async function handlePackages(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    const { engine, reply, sendEvent } = ctx;
    switch (action) {
        case "package:isInstalled": {
            reply(id, { installed: engine.isPackageInstalled(assertStr(params?.packageName, "packageName", 128), assertOptStr(params?.version, "version", 64)) });
            return true;
        }
        case "package:getIndex": {
            reply(id, { index: engine.getPackageIndex() });
            return true;
        }
        case "package:getPath": {
            reply(id, { path: engine.getPackagePath(assertStr(params?.packageName, "packageName", 128)) });
            return true;
        }
        case "package:download": {
            const downloadId = assertStr(params?.downloadId, "downloadId", 128);
            const targetDir = await engine.downloadPackage(
                assertStr(params?.packageName, "packageName", 128),
                downloadId,
                (progress) =>
                    sendEvent("progress", {
                        ...progress,
                        downloadId,
                    }),
                assertOptStr(params?.sha256, "sha256", 128),
            );
            reply(id, { path: targetDir });
            return true;
        }
        default:
            return false;
    }
}
