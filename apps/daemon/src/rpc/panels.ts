import type { RpcContext } from "./context";
import { Refusal } from "./errors";
import { rpcModule } from "./dispatch";
import { resourcePanelId } from "../security/principal";
import { problemsFor } from "./problems";
import { errorMessage } from "@mileniumhq/paperapi/errors";
import type { DownloadProgressPayload } from "../packages/download";

// a scoped caller reaches only its own panel
function ownPanel(requested: string, action: string, ctx: RpcContext): string {
    return resourcePanelId(ctx.callerPanelId(), requested, action)!;
}

// a failure of the operation itself is answered as what failed, with no code
async function failedAs<T>(what: string, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (err) {
        throw new Refusal(`${what} failed: ${errorMessage(err)}`);
    }
}

export const panelsRpc = rpcModule({
    "panel:list": (_, ctx) => ctx.engine.listPanels(),
    // control-plane readout for the shell tray; a scoped panel token must
    // not learn the whole machine's service count
    "service:count": (_, ctx) => ({ running: ctx.engine.runningServiceCount() }),
    "panel:install": async ({ panelId, version, sha256, downloadId, allowDowngrade, ifUnused }, ctx) => {
        // installing a panel is a host action, never panel equipment. The
        // daemon resolves the release and its bytes from its own registry;
        // any downloadUrl sent is ignored.
        const expected = { allowDowngrade: allowDowngrade === true, version, sha256 };
        const progress = downloadId ? (payload: DownloadProgressPayload) => ctx.sendEvent("progress", { ...payload, downloadId }) : undefined;
        // ifUnused (the updater): a panel running something people rely on
        // (important or long running) is held, and the reply names those
        // processes; anything else it runs is stopped for the install and
        // started again by the panel
        if (ifUnused) {
            const processes = ctx.engine.panelWorkloads(panelId);
            const holding = processes.filter((processId) => ctx.engine.holdsUpdates(processId));
            if (holding.length > 0) return { held: { processes: holding } };
            if (processes.length > 0) {
                const { installed, failures } = await ctx.engine.updateInUse({ panels: [{ id: panelId, expected }] }, (_target, payload) => progress?.(payload));
                const failure = failures[`panel:${panelId}`];
                if (failure) throw new Error(failure);
                return { panel: installed[0] };
            }
        }
        return { panel: await ctx.engine.installPanel(panelId, expected, progress) };
    },
    // Stop and update: stops what the updates wait for, then installs
    // every panel and swaps in every staged package
    "update:inUse": async ({ panels, packages, downloadId }, ctx) => {
        const { installed, failures } = await ctx.engine.updateInUse(
            { panels: (panels ?? []).map(({ id, version, sha256 }) => ({ id, expected: { version, sha256 } })), packages: packages ?? [] },
            downloadId ? (target, payload) => ctx.sendEvent("progress", { ...payload, target, downloadId }) : undefined,
        );
        return { panels: installed, failures };
    },
    "panel:uninstall": ({ panelId, deleteData }, ctx, action) => {
        const owned = ownPanel(panelId, action, ctx);
        return failedAs("Uninstall", async () => {
            const result = await ctx.engine.uninstallPanel(owned, { deleteData: deleteData === true });
            // what went wrong with it went with it
            problemsFor(ctx.engine).clear(owned);
            return { success: true, ...result };
        });
    },
    "panel:restartService": ({ panelId }, ctx, action) => {
        const owned = ownPanel(panelId, action, ctx);
        return failedAs("Restart", async () => ({ restarted: await ctx.engine.restartPanelService(owned) }));
    },
    // config ids are panel-scoped (default config in configs/, an explicit
    // path in the panel's files dir); a scoped caller may only touch its own claim
    "config:get": async ({ id, path }, ctx, action) => ({ data: await ctx.engine.getConfig(ownPanel(id, action, ctx), path) }),
    "config:set": async ({ id, path, data }, ctx, action) => ({ success: await ctx.engine.setConfig(ownPanel(id, action, ctx), data, path) }),
}, "Panel operation failed");
