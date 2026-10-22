import { requireHost } from "../principal";
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
            if (params?.allowDowngrade === true) requireHost(ctx.callerPanelId(), action);
            const downloadId = assertStr(params?.downloadId, "downloadId", 128);
            const packageName = assertStr(params?.packageName, "packageName", 128);
            // plan-carrying callers (updater) supply their checksum fact and
            // the engine cross-checks it; ad-hoc callers (Setup wizards)
            // carry none, so the daemon resolves it from registry metadata
            // itself. A failed lookup throws — the engine never sees
            // sha256: undefined from this path.
            const sha256 = assertOptStr(params?.sha256, "sha256", 128) ?? (await resolvePackageSha256(packageName));
            const outcome = await engine.downloadPackage(
                packageName,
                downloadId,
                (progress) =>
                    sendEvent("progress", {
                        ...progress,
                        downloadId,
                    }),
                sha256,
                { allowDowngrade: params?.allowDowngrade === true },
            );
            // waiting: verified and staged, installed once the workloads
            // running from the current release stop. Accepted, not completed.
            reply(id, outcome.waiting ? { path: outcome.path, waiting: outcome.waiting } : { path: outcome.path });
            return true;
        }
        case "package:pending": {
            // the host sees every waiting update; a panel sees only the
            // updates its own workloads hold back, and only those workloads
            const caller = ctx.callerPanelId();
            const updates = engine.pendingPackageUpdates();
            if (caller === null) {
                reply(id, { updates });
                return true;
            }
            reply(id, {
                updates: updates
                    .map((update) => ({ ...update, blockedBy: update.blockedBy.filter((user) => user.owner === caller) }))
                    .filter((update) => update.blockedBy.length > 0),
            });
            return true;
        }
        default:
            return false;
    }
}
