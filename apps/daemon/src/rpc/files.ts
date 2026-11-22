import type { RpcContext } from "./context";
import { rpcModule } from "./dispatch";
import { resourcePanelId } from "../security/principal";

// An omitted appId defaults to the caller's token claim.
const space = (appId: string | undefined, ctx: RpcContext) => resourcePanelId(ctx.callerPanelId(), appId);

export const filesRpc = rpcModule({
    "file:getPath": ({ targetPath, appId }, ctx) => ({ path: ctx.engine.getFilePath(targetPath, space(appId, ctx)) }),
    "file:exists": async ({ targetPath, appId }, ctx) => ({ exists: await ctx.engine.fileExists(targetPath, space(appId, ctx)) }),
    "file:write": async ({ targetPath, content, appId }, ctx) => ({ path: await ctx.engine.writeFile(targetPath, content, space(appId, ctx)) }),
    "file:read": async ({ targetPath, appId }, ctx) => ({ content: await ctx.engine.readFile(targetPath, space(appId, ctx)) }),
    "file:delete": async ({ targetPath, appId }, ctx) => ({ success: await ctx.engine.deleteFile(targetPath, space(appId, ctx)) }),
    "file:clear": async ({ appId }, ctx) => ({ success: await ctx.engine.clearFiles(space(appId, ctx)) }),
    "file:download": async ({ downloadId, url, targetPath, appId, options }, ctx) => ({
        path: await ctx.engine.downloadFile(url, targetPath, space(appId, ctx), options ?? {}, (progress) =>
            ctx.sendEvent("progress", { ...progress, downloadId }),
        ),
    }),
});
