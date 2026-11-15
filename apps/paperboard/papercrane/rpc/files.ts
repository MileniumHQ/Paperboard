import type { RpcContext } from "./context";
import { rpcModule } from "./dispatch";
import { resourcePanelId } from "../principal";

// file space is per-panel like the vault: a panel-scoped caller naming any
// other panel's appId is refused outright. An omitted appId defaults to the
// caller's own claim; master/host callers carry no claim and keep the
// explicit-parameter behavior.
const space = (appId: string | undefined, action: string, ctx: RpcContext) => resourcePanelId(ctx.callerPanelId(), appId, action);

export const filesRpc = rpcModule({
    "file:getPath": ({ targetPath, appId }, ctx, action) => ({ path: ctx.engine.getFilePath(targetPath, space(appId, action, ctx)) }),
    "file:exists": async ({ targetPath, appId }, ctx, action) => ({ exists: await ctx.engine.fileExists(targetPath, space(appId, action, ctx)) }),
    "file:write": async ({ targetPath, content, appId }, ctx, action) => ({ path: await ctx.engine.writeFile(targetPath, content, space(appId, action, ctx)) }),
    "file:read": async ({ targetPath, appId }, ctx, action) => ({ content: await ctx.engine.readFile(targetPath, space(appId, action, ctx)) }),
    "file:delete": async ({ targetPath, appId }, ctx, action) => ({ success: await ctx.engine.deleteFile(targetPath, space(appId, action, ctx)) }),
    "file:clear": async ({ appId }, ctx, action) => ({ success: await ctx.engine.clearFiles(space(appId, action, ctx)) }),
    "file:download": async ({ downloadId, url, targetPath, appId, options }, ctx, action) => ({
        path: await ctx.engine.downloadFile(url, targetPath, space(appId, action, ctx), options ?? {}, (progress) =>
            ctx.sendEvent("progress", { ...progress, downloadId }),
        ),
    }),
});
