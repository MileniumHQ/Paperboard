import { logger } from "../logger";
import type { RpcContext } from "./context";
import { assertStr, assertOptStr } from "./params";
import { forbidden } from "./errors";

// single-frame write cap: 16 MiB of parsed content is far past any
// legitimate panel state file; larger blobs ride file:download, which
// streams with its own cap instead of living twice in one JSON frame
const FILE_WRITE_MAX = 16 * 1024 * 1024;

// file space is per-panel like the vault: a panel-scoped caller naming any
// other panel's appId is refused outright. An omitted appId defaults to the
// caller's own claim; master/host callers carry no claim and keep the
// explicit-parameter behavior.
function effectiveAppId(params: any, action: string, ctx: RpcContext): string | undefined {
    const requested = assertOptStr(params?.appId, "appId", 128);
    const claim = ctx.callerPanelId();
    if (claim && requested && claim !== requested) {
        // TODO(deny after v3.2): same tombstone as secrets — unscoped
        // master-token callers start carrying claims and every disagreement
        // is denied at the registry-opening gate.
        logger.warn(
            `[files] cross-panel access refused: token claim "${claim}" ` +
            `requested "${requested}" files via "${action}"`,
        );
        throw forbidden(
            `Cross-panel files access refused: credential is scoped to "${claim}"`,
        );
    }
    return requested ?? claim ?? undefined;
}

export async function handleFiles(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    const { engine, reply, sendEvent } = ctx;
    switch (action) {
        case "file:getPath": {
            reply(id, { path: engine.getFilePath(assertStr(params?.targetPath, "targetPath", 1024), effectiveAppId(params, action, ctx)) });
            return true;
        }
        case "file:exists": {
            reply(id, { exists: await engine.fileExists(assertStr(params?.targetPath, "targetPath", 1024), effectiveAppId(params, action, ctx)) });
            return true;
        }
        case "file:write": {
            reply(id, { path: await engine.writeFile(assertStr(params?.targetPath, "targetPath", 1024), assertStr(params?.content, "content", FILE_WRITE_MAX, true), effectiveAppId(params, action, ctx)) });
            return true;
        }
        case "file:read": {
            reply(id, { content: await engine.readFile(assertStr(params?.targetPath, "targetPath", 1024), effectiveAppId(params, action, ctx)) });
            return true;
        }
        case "file:delete": {
            reply(id, { success: await engine.deleteFile(assertStr(params?.targetPath, "targetPath", 1024), effectiveAppId(params, action, ctx)) });
            return true;
        }
        case "file:clear": {
            reply(id, { success: await engine.clearFiles(effectiveAppId(params, action, ctx)) });
            return true;
        }
        case "file:download": {
            const downloadId = assertStr(params?.downloadId, "downloadId", 128);
            const dest = await engine.downloadFile(
                assertStr(params?.url, "url", 8192),
                assertStr(params?.targetPath, "targetPath", 1024),
                effectiveAppId(params, action, ctx),
                downloadId,
                params?.options || {},
                (progress) =>
                    sendEvent("progress", {
                        ...progress,
                        downloadId,
                    }),
            );
            reply(id, { path: dest });
            return true;
        }
        default:
            return false;
    }
}
