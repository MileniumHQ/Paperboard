import type { PaperCraneEngine } from "../engine/index";
import type { RpcContext } from "./context";
import { rpcModule } from "./dispatch";
import { resourcePanelId } from "../security/principal";
import { BackupService } from "../backups/service";
import { blocksRegistry } from "../server/actions";
import { errorMessage } from "@mileniumhq/paperapi/errors";

// one service per engine; it lives as long as the engine does
const services = new WeakMap<PaperCraneEngine, BackupService>();

export function backupServiceFor(engine: PaperCraneEngine): BackupService {
    let service = services.get(engine);
    if (!service) {
        service = new BackupService(engine);
        services.set(engine, service);
    }
    return service;
}

// a panel reaches only its own backups: the token claim names the panel
function panelFor({ panelId, sourceId }: { panelId: string; sourceId?: string }, action: string, ctx: RpcContext): string {
    const owner = resourcePanelId(ctx.callerPanelId(), panelId, action)!;
    return sourceId === undefined ? owner : backupServiceFor(ctx.engine).sources.resolve(owner, sourceId);
}

// A backup or restore stops its panel's service while it runs. When that
// service asked for it from inside a block (duringCall names the call), it
// is gone before it can answer, so the call is answered with the outcome.
async function carrying<T>(callId: string | undefined, ctx: RpcContext, operation: () => Promise<T>): Promise<T> {
    const finish = callId === undefined ? null : blocksRegistry.carryCall(callId, ctx.ws);
    try {
        const result = await operation();
        finish?.({ result });
        return result;
    } catch (err) {
        finish?.({ error: errorMessage(err) });
        throw err;
    }
}

// Locations are the user's choice, made in the shell: every location
// action needs host authority (PaperAPI's protocol/rpc.ts). Backups themselves are panel-scoped.
const backups = (ctx: RpcContext) => backupServiceFor(ctx.engine);

export const backupsRpc = rpcModule({
    "backup:source-define": ({ panelId, source }, ctx, action) => {
        backups(ctx).sources.define(resourcePanelId(ctx.callerPanelId(), panelId, action)!, source);
        return { success: true };
    },
    "backup:destinations": (_, ctx) => ({ destinations: backups(ctx).listDestinations() }),
    "backup:destinations-problem": (_, ctx) => ({ problem: backups(ctx).locationsProblem() }),
    "backup:destinations-recover": (_, ctx) => backups(ctx).recoverLocations(),
    "backup:destination-usage": ({ destinationId }, ctx) => backups(ctx).destinationUsage(destinationId),
    "backup:destination-add": ({ destination }, ctx) => backups(ctx).addDestination(destination),
    "backup:destination-reconnect": (params, ctx) => backups(ctx).reconnectDestination(params.destinationId, params),
    "backup:destination-remove": async ({ destinationId }, ctx) => {
        await backups(ctx).removeDestination(destinationId);
        return { success: true };
    },
    "backup:panel-destination-set": async (params, ctx, action) => {
        const panelId = panelFor(params, action, ctx);
        await backups(ctx).setPanelDestination(panelId, params.destinationId);
        return backups(ctx).status(panelId);
    },
    "backup:status": (params, ctx, action) => backups(ctx).status(panelFor(params, action, ctx)),
    // every running backup of the panel's data, its sources included
    "backup:progress": ({ panelId }, ctx, action) => ({ progress: backups(ctx).progressFor(resourcePanelId(ctx.callerPanelId(), panelId, action)!) }),
    "backup:create": (params, ctx, action) => {
        const panelId = panelFor(params, action, ctx);
        return carrying(params.duringCall, ctx, () => backups(ctx).create(panelId, params.label ?? null));
    },
    "backup:list": async (params, ctx, action) => ({ backups: await backups(ctx).list(panelFor(params, action, ctx)) }),
    "backup:restore": (params, ctx, action) => {
        const panelId = panelFor(params, action, ctx);
        return carrying(params.duringCall, ctx, () => backups(ctx).restore(panelId, params.backupId));
    },
    "backup:schedule-set": async (params, ctx, action) => {
        const panelId = panelFor(params, action, ctx);
        await backups(ctx).setSchedule(panelId, params.schedule);
        return backups(ctx).status(panelId);
    },
    "backup:delete": async (params, ctx, action) => {
        await backups(ctx).remove(panelFor(params, action, ctx), params.backupId);
        return { success: true };
    },
}, "Backup operation failed");
