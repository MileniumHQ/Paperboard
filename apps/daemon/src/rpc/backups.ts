import type { PaperCraneEngine } from "../engine/index";
import type { RpcContext } from "./context";
import { rpcModule } from "./dispatch";
import { resourcePanelId } from "../security/principal";
import { BackupService } from "../backups/service";

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

const backups = (ctx: RpcContext) => backupServiceFor(ctx.engine);
// a panel's credential names only its own backups
const panelOf = (panelId: string, ctx: RpcContext) => resourcePanelId(ctx.callerPanelId(), panelId)!;

// Locations are the user's choice, made in the shell: every location
// action needs host authority (PaperAPI's protocol/rpc.ts).
export const backupsRpc = rpcModule({
    "backup:locations": (_, ctx) => ({ locations: backups(ctx).locations.list() }),
    "backup:locations-problem": (_, ctx) => ({ problem: backups(ctx).locations.problem() }),
    "backup:locations-recover": (_, ctx) => backups(ctx).locations.recover(),
    "backup:location-usage": ({ locationId }, ctx) => backups(ctx).locations.usage(locationId),
    "backup:location-add": ({ location }, ctx) => backups(ctx).locations.add(location),
    "backup:location-reconnect": (params, ctx) => backups(ctx).locations.reconnect(params.locationId, params),
    "backup:location-remove": async ({ locationId }, ctx) => {
        await backups(ctx).locations.remove(locationId);
        return { success: true };
    },
    "backup:panel-location-set": async ({ panelId, locationId }, ctx) => {
        const panel = panelOf(panelId, ctx);
        await backups(ctx).locations.setForPanel(panel, locationId);
        return backups(ctx).status(panel, null);
    },
    "backup:status": ({ panelId, target }, ctx) => backups(ctx).status(panelOf(panelId, ctx), target ?? null),
    "backup:progress": ({ panelId }, ctx) => ({ progress: backups(ctx).progressFor(panelOf(panelId, ctx)) }),
    "backup:create": ({ panelId, target, label }, ctx) => backups(ctx).create(panelOf(panelId, ctx), target ?? null, label ?? null),
    "backup:list": async ({ panelId, target }, ctx) => ({ backups: await backups(ctx).list(panelOf(panelId, ctx), target ?? null) }),
    "backup:restore": ({ panelId, target, backupId }, ctx) => backups(ctx).restore(panelOf(panelId, ctx), target ?? null, backupId),
    "backup:delete": async ({ panelId, target, backupId }, ctx) => {
        await backups(ctx).remove(panelOf(panelId, ctx), target ?? null, backupId);
        return { success: true };
    },
}, "Backup operation failed");
