import type { PaperCraneEngine } from "../engine";
import type { RpcContext } from "./context";
import { assertOptStr, assertPanelId, assertStr, rpcErrorCode } from "./params";
import { invalidParams } from "./errors";
import { requireHost, resourcePanelId } from "../principal";
import { BackupService } from "../backups/service";
import { isDestinationId } from "../backups/config";
import { BACKUP_LABEL_MAX } from "../backups/types";
import { actionsRegistry } from "../actions";

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

function destinationId(value: unknown): string {
    if (!isDestinationId(value)) throw invalidParams(`Invalid destinationId: ${JSON.stringify(value)}`);
    return value;
}

// a panel reaches only its own backups: the token claim names the panel
function panelFor(params: any, action: string, ctx: RpcContext): string {
    const owner = resourcePanelId(ctx.callerPanelId(), assertPanelId(params?.panelId), action)!;
    return params?.sourceId === undefined ? owner : backupServiceFor(ctx.engine).sources.resolve(owner, assertStr(params.sourceId, "sourceId", 64));
}

// A backup or restore stops its panel's service while it runs. When that
// service asked for it from inside an action (duringCall names the call), it
// is gone before it can answer, so the action is answered with the outcome.
async function carrying<T>(params: any, ctx: RpcContext, operation: () => Promise<T>): Promise<T> {
    const callId = assertOptStr(params?.duringCall, "duringCall", 64);
    const finish = callId === undefined ? null : actionsRegistry.carryCall(callId, ctx.ws);
    try {
        const result = await operation();
        finish?.({ result });
        return result;
    } catch (err) {
        finish?.({ error: err instanceof Error ? err.message : String(err) });
        throw err;
    }
}

// Locations are the user's choice, made in the shell: every location
// action needs host authority. Backups themselves are panel-scoped.
export async function handleBackups(action: string, id: unknown, params: any, ctx: RpcContext): Promise<boolean> {
    if (!action.startsWith("backup:")) return false;
    const { engine, reply } = ctx;
    const backups = backupServiceFor(engine);
    try {
        switch (action) {
            case "backup:source-define": {
                const owner = resourcePanelId(ctx.callerPanelId(), assertPanelId(params?.panelId), action)!;
                backups.sources.define(owner, params?.source);
                reply(id, { success: true });
                return true;
            }
            case "backup:destinations":
                requireHost(ctx.callerPanelId(), action);
                reply(id, { destinations: backups.listDestinations() });
                return true;
            case "backup:destinations-problem":
                requireHost(ctx.callerPanelId(), action);
                reply(id, { problem: backups.locationsProblem() });
                return true;
            case "backup:destinations-recover":
                requireHost(ctx.callerPanelId(), action);
                reply(id, await backups.recoverLocations());
                return true;
            case "backup:destination-usage":
                requireHost(ctx.callerPanelId(), action);
                reply(id, await backups.destinationUsage(destinationId(params?.destinationId)));
                return true;
            case "backup:destination-add":
                requireHost(ctx.callerPanelId(), action);
                reply(id, await backups.addDestination(params?.destination));
                return true;
            case "backup:destination-reconnect":
                requireHost(ctx.callerPanelId(), action);
                reply(id, await backups.reconnectDestination(destinationId(params?.destinationId), params));
                return true;
            case "backup:destination-remove":
                requireHost(ctx.callerPanelId(), action);
                await backups.removeDestination(destinationId(params?.destinationId));
                reply(id, { success: true });
                return true;
            case "backup:panel-destination-set": {
                requireHost(ctx.callerPanelId(), action);
                const panelId = panelFor(params, action, ctx);
                const dest = params?.destinationId === null ? null : destinationId(params?.destinationId);
                await backups.setPanelDestination(panelId, dest);
                reply(id, backups.status(panelId));
                return true;
            }
            case "backup:status":
                reply(id, backups.status(panelFor(params, action, ctx)));
                return true;
            case "backup:progress": {
                // every running backup of the panel's data, its sources included
                const owner = resourcePanelId(ctx.callerPanelId(), assertPanelId(params?.panelId), action)!;
                reply(id, { progress: backups.progressFor(owner) });
                return true;
            }
            case "backup:create": {
                const panelId = panelFor(params, action, ctx);
                const label = assertOptStr(params?.label, "label", BACKUP_LABEL_MAX) ?? null;
                reply(id, await carrying(params, ctx, () => backups.create(panelId, label)));
                return true;
            }
            case "backup:list": {
                const panelId = panelFor(params, action, ctx);
                reply(id, { backups: await backups.list(panelId) });
                return true;
            }
            case "backup:restore": {
                const panelId = panelFor(params, action, ctx);
                const backupId = assertStr(params?.backupId, "backupId", 64);
                reply(id, await carrying(params, ctx, () => backups.restore(panelId, backupId)));
                return true;
            }
            case "backup:schedule-set": {
                const panelId = panelFor(params, action, ctx);
                await backups.setSchedule(panelId, params?.schedule ?? null);
                reply(id, backups.status(panelId));
                return true;
            }
            case "backup:delete": {
                const panelId = panelFor(params, action, ctx);
                await backups.remove(panelId, assertStr(params?.backupId, "backupId", 64));
                reply(id, { success: true });
                return true;
            }
            default:
                return false;
        }
    } catch (err: any) {
        reply(id, null, err?.message || "Backup operation failed", rpcErrorCode(err));
        return true;
    }
}
