import { requireHost } from "../security/principal";
import type { RpcContext } from "./context";
import { rpcModule } from "./dispatch";
import { resolvePackageSha256 } from "../packages/packageChecksum";

// a panel that asks for a package uses it: the package stays while the panel is installed
function used(packageName: string, ctx: RpcContext): string {
    const caller = ctx.callerPanelId();
    if (caller !== null) ctx.engine.recordPackageUse(packageName, caller);
    return packageName;
}

export const packagesRpc = rpcModule({
    "package:isInstalled": ({ packageName, version }, ctx) => ({ installed: ctx.engine.isPackageInstalled(used(packageName, ctx), version) }),
    "package:getIndex": (_, ctx) => ({ index: ctx.engine.getPackageIndex() }),
    "package:getPath": ({ packageName }, ctx) => ({ path: ctx.engine.getPackagePath(used(packageName, ctx)) }),
    "package:download": async ({ packageName, downloadId, sha256, allowDowngrade }, ctx, action) => {
        if (allowDowngrade) requireHost(ctx.callerPanelId(), action);
        used(packageName, ctx);
        // ad-hoc callers (Setup wizards) carry no checksum, so the daemon
        // resolves it from registry metadata itself. A failed lookup throws:
        // the engine never sees sha256: undefined from this path.
        const outcome = await ctx.engine.downloadPackage(
            packageName,
            (progress) => ctx.sendEvent("progress", { ...progress, downloadId }),
            sha256 ?? (await resolvePackageSha256(packageName)),
            { allowDowngrade },
        );
        return outcome.waiting ? { path: outcome.path, waiting: outcome.waiting } : { path: outcome.path };
    },
    "package:pending": (_, ctx) => {
        // the host sees every waiting update; a panel sees only the
        // updates its own workloads hold back, and only those workloads
        const caller = ctx.callerPanelId();
        const updates = ctx.engine.pendingPackageUpdates();
        if (caller === null) return { updates };
        return {
            updates: updates
                .map((update) => ({ ...update, blockedBy: update.blockedBy.filter((user) => user.owner === caller) }))
                .filter((update) => update.blockedBy.length > 0),
        };
    },
});
