import type { RpcContext } from "./context";
import { assertStr, assertOptStr } from "./params";
import { resolvePackageSha256 } from "../packageChecksum";

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
            const packageName = assertStr(params?.packageName, "packageName", 128);
            // plan-carrying callers (updater) supply their checksum fact and
            // the engine cross-checks it; ad-hoc callers (Setup wizards)
            // carry none, so the daemon resolves it from registry metadata
            // itself. A failed lookup throws — the engine never sees
            // sha256: undefined from this path.
            const sha256 = assertOptStr(params?.sha256, "sha256", 128) ?? (await resolvePackageSha256(packageName));
            const targetDir = await engine.downloadPackage(
                packageName,
                downloadId,
                (progress) =>
                    sendEvent("progress", {
                        ...progress,
                        downloadId,
                    }),
                sha256,
            );
            reply(id, { path: targetDir });
            return true;
        }
        default:
            return false;
    }
}
