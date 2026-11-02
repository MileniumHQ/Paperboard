import {
    definePanelService,
    backupApi,
    actionsApi,
    config,
    fileApi,
    defineAction,
    WIDGET_CHOICES_ACTION,
    type ServiceContext,
    type ActionDefinition,
} from "@mileniumhq/paperapi";
import {
    PANEL_ID,
    serverStateKey,
    MAX_SERVERS,
    createServerId,
    readServersConfig,
    serverName,
    type ServersConfig,
    type StoredServer,
} from "./servers";
import * as nodeFs from "node:fs/promises";
import { inServer, type ServerScope } from "./service/scope";
import { processApi as scopedProcess, LEGACY_DEPRECATION } from "./service/api";
import { type GameServerState, SERVER_PROC_ID } from "./service/types";
import { setRecoveryBlock } from "./service/recoveryState";
import { handleProcessData, handleProcessExit, stopServerInstance, cancelReadiness, restartServerInstance } from "./service/lifecycle";
import { cancelAutomation, readAutomation, scheduleDailyRestart } from "./service/automation";

import { currentGameService, gameServiceFor } from "./games/service";
import { assertGameAction, gameFor, games } from "./games";
import { loadServerOptions } from "./service/options";
import { livePortDeps } from "./service/portDeps";
export * from "./service/types";
export * from "./games/minecraft/actions";
export { LEGACY_DEPRECATION };

export interface ServerSummary extends Omit<StoredServer, "settings"> {
    configured: boolean;
    icon: string | null;
    state: Pick<
        GameServerState,
        "serverStatus" | "serverSoftware" | "serverVersion" | "serverPort" | "recoveryBlock" | "maxPlayers"
    > & { playerCount: number };
}
export interface ServersState extends Record<string, unknown> {
    servers: ServerSummary[];
    serversError: string | null;
    legacyServer?: string;
}
const entries = new Map<string, ServerScope>();
let saved: ServersConfig = readServersConfig(null);
let rootContext: ServiceContext<ServersState>;
let mutation: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = mutation.then(work, work);
    mutation = next.catch((err) => console.error("[gameserver] server change failed:", err));
    return next;
}
let configWrites: Promise<unknown> = Promise.resolve();
function updateSaved(change: (current: ServersConfig) => ServersConfig): Promise<void> {
    const work = configWrites.then(async () => {
        const next = change(saved);
        await config.set(next, PANEL_ID);
        saved = next;
        for (const server of saved.servers) {
            const entry = entries.get(server.id);
            if (entry) entry.server = server;
        }
    });
    configWrites = work.catch((err) =>
        console.error("[gameserver] server config write failed:", err),
    );
    return work;
}
const icons = new Map<string, string | null>();
function publish(changed?: ServerScope): void {
    const servers = saved.servers.map((server): ServerSummary => {
        const scope = entries.get(server.id);
        if (!scope) throw new Error(`Server scope is missing: ${server.id}`);
        const state = scope.ctx.state;
        return {
            id: server.id,
            name: server.name,
            game: server.game,
            directory: server.directory,
            createdAt: server.createdAt,
            configured: server.settings.configured === true,
            icon: icons.get(server.id) ?? null,
            state: {
                serverStatus: state.serverStatus,
                serverSoftware: state.serverSoftware,
                serverVersion: state.serverVersion,
                serverPort: state.serverPort,
                recoveryBlock: state.recoveryBlock,
                maxPlayers: state.maxPlayers,
                playerCount: state.onlinePlayers.length,
            },
        };
    });
    const patch: Partial<ServersState> = {};
    if (JSON.stringify(rootContext.state.servers) !== JSON.stringify(servers))
        patch.servers = servers;
    if (rootContext.state.legacyServer !== saved.legacyServer)
        patch.legacyServer = saved.legacyServer;
    for (const scope of changed ? [changed] : entries.values())
        patch[serverStateKey(scope.server.id)] = scope.ctx.state;
    rootContext.setState(patch);
}
function requireServer(id: unknown): ServerScope {
    if (rootContext.state.serversError) throw new Error(rootContext.state.serversError);
    const entry = typeof id === "string" ? entries.get(id) : undefined;
    if (!entry) throw new Error("Choose a server that has not been removed");
    return entry;
}
function bind(scope: ServerScope, def: ActionDefinition): ActionDefinition {
    return {
        ...def,
        ...(def.run
            ? {
                  run: async (_ctx: unknown, ...args: any[]) => {
                      if (!entries.has(scope.server.id) || scope.removing)
                          throw new Error("This server was removed or is being removed");
                      assertGameAction(gameFor(scope.server.game), {
                          settings: scope.ctx.state.gameSettings,
                          software: scope.ctx.state.serverSoftware,
                          version: scope.ctx.state.serverVersion,
                      }, def.id);
                      scope.activeOperations++;
                      try {
                          const result = await inServer(scope, () =>
                              (def.run as Function)(scope.ctx, ...args),
                          );
                          if (["set-server-icon", "remove-server-icon"].includes(def.id)) {
                              icons.set(
                                  scope.server.id,
                                  await inServer(scope, () => gameServiceFor(scope.server.game).readIcon?.() ?? null),
                              );
                              publish();
                          }
                          return result;
                      } finally {
                          scope.activeOperations--;
                      }
                  },
              }
            : {}),
    };
}
function createScope(server: StoredServer): ServerScope {
    const game = gameServiceFor(server.game);
    let state = game.initialState();
    const scope: ServerScope = {
        server,
        processIds: game.processIds,
        legacy: saved.legacyServer === server.id,
        locals: new Map(),
        activeOperations: 0,
        removing: false,
        unsubscribe: [],
        ctx: {
            get state() {
                return state;
            },
            setState(patch) {
                state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
                publish(scope);
            },
            emit: (event, payload) => rootContext.emit(`${server.id}/${event}`, payload),
            emitTrigger(id, output) {
                rootContext.emitTrigger(`${server.id}/${id}`, output);
                if (scope.legacy) rootContext.emitTrigger(id, output);
            },
        } as ServiceContext<GameServerState>,
        saveSettings: async (settings) => {
            await updateSaved((current) => {
                requireServer(server.id);
                return {
                    ...current,
                    servers: current.servers.map((s) =>
                        s.id === server.id ? { ...s, settings } : s,
                    ),
                };
            });
            publish();
        },
        bindAction: (def) => bind(scope, def),
    };
    entries.set(server.id, scope);
    return scope;
}
// Player heads were kept on disk beside the servers until they were looked
// up fresh each time; the stale copies go. Never a server's own folder.
async function removeOldHeadStore(): Promise<void> {
    const dir = `${saved.serversDirectory}/player-heads`;
    if (saved.servers.some((server) => server.directory === dir)) return;
    try {
        await nodeFs.rm(await fileApi.getPath(dir, PANEL_ID), { recursive: true, force: true });
    } catch (err) {
        console.error("[gameserver] the old player head cache could not be removed:", err);
    }
}

async function initialize(scope: ServerScope): Promise<ServerScope> {
    const { server } = scope;
    const game = gameServiceFor(server.game);
    try {
        await nodeFs.mkdir(await fileApi.getPath(server.directory, PANEL_ID), { recursive: true });
        await backupApi.defineSource(PANEL_ID, {
            id: server.id,
            directory: server.directory,
            config: ["servers", { id: server.id }, "settings"],
            processes: game.processIds.map((id) => scope.legacy ? id : `${server.id}-${id}`),
            ...(scope.legacy ? { legacy: true } : {}),
            ...(scope.legacy || game.backupExclude ? { exclude: [...(scope.legacy ? [saved.serversDirectory] : []), ...(game.backupExclude ?? [])] } : {}),
        });
        scope.project = await actionsApi.defineProject(
            { id: server.id, name: server.name, icon: gameFor(server.game).icon },
            PANEL_ID,
        );
        for (const def of await game.actions()) {
            await scope.project.register(bind(scope, def));
            if (scope.legacy)
                await actionsApi.register(
                    { ...bind(scope, def), deprecated: LEGACY_DEPRECATION },
                    undefined,
                    PANEL_ID,
                );
        }
        await inServer(scope, async () => {
            // A server left running keeps its identity and directory on migration.
            // Recovery must never modify that running process's files.
            const running = await scopedProcess.exists(game.primaryProcessId);
            if (running) scope.ctx.setState({ serverStatus: "online" });
            scope.unsubscribe.push(
                scopedProcess.onData(game.primaryProcessId, (chunk) =>
                    handleProcessData(scope.ctx, chunk),
                ),
            );
            scope.unsubscribe.push(
                scopedProcess.onExit(game.primaryProcessId, (code) => handleProcessExit(scope.ctx, code)),
            );
            await loadServerOptions(scope.ctx);
            await readAutomation();
            scheduleDailyRestart(scope.ctx, restartServerInstance);
            await game.initialize(scope.ctx, running);
            icons.set(server.id, (await game.readIcon?.()) ?? null);
        });
        return scope;
    } catch (err) {
        const reason = `Server initialization failed: ${err instanceof Error ? err.message : String(err)}`;
        inServer(scope, () => setRecoveryBlock(reason));
        scope.ctx.setState({ recoveryBlock: reason });
        publish(scope);
        throw err;
    }
}
const management = (id: string, run: (...args: any[]) => any) =>
    defineAction({
        id,
        name: id,
        description: "Manage saved servers",
        internal: true,
        inputs: {},
        run: (_ctx, ...args) => run(...args),
    });
export const gameServerService = definePanelService({
    id: PANEL_ID,
    state: { servers: [], serversError: null } as ServersState,
    types: (await Promise.all(games.map(g => gameServiceFor(g.id).customTypes?.() ?? []))).flat(),
    categories: [
        { name: "Server", icon: "dns", order: 1 },
        { name: "Players", icon: "group", order: 2 },
        { name: "Worlds", icon: "public", order: 3 },
        { name: "Game Rules", icon: "rule", order: 4 },
        { name: "Plugins", icon: "extension", order: 5 },
        { name: "Logs", icon: "receipt_long", order: 6 },
        { name: "Events", icon: "bolt", order: 7 },
    ],
    actions: [
        management("list-servers", () => rootContext.state),
        management(
            "read-server-config",
            ({ server }: any) => requireServer(server).server.settings,
        ),
        management("add-server", ({ name, game }: any) =>
            serial(async () => {
                if (rootContext.state.serversError) throw new Error(rootContext.state.serversError);
                if (saved.servers.length >= MAX_SERVERS)
                    throw new Error(`This computer can keep at most ${MAX_SERVERS} servers`);
                const definition = gameFor(game);
                const id = createServerId();
                const server: StoredServer = {
                    id,
                    name: serverName(name),
                    game: definition.id,
                    directory: `${saved.serversDirectory}/${id}`,
                    createdAt: Date.now(),
                    settings: {},
                };
                // Persist before creating files: a failed setup remains visible and resumable.
                await updateSaved((current) => ({
                    ...current,
                    servers: [...current.servers, server],
                }));
                await fileApi.getPath(server.directory, PANEL_ID);
                await initialize(createScope(server));
                publish();
                return { id };
            }),
        ),
        management("rename-server", ({ server, name }: any) =>
            serial(async () => {
                const scope = requireServer(server);
                const renamed = { ...scope.server, name: serverName(name) };
                await scope.project!.update({ name: renamed.name, icon: gameFor(renamed.game).icon });
                await updateSaved((current) => ({
                    ...current,
                    servers: current.servers.map((s) =>
                        s.id === server ? { ...s, name: renamed.name } : s,
                    ),
                }));
                publish();
                return true;
            }),
        ),
        management("remove-server", ({ server }: any) =>
            serial(async () => {
                const scope = requireServer(server);
                if (scope.activeOperations)
                    throw new Error(
                        "Wait for this server's current operation to finish before removing it",
                    );
                scope.removing = true;
                try {
                    await inServer(scope, async () => {
                        await currentGameService().beforeRemove();
                        await stopServerInstance(scope.ctx);
                        const deadline = Date.now() + 40_000;
                        while (await scopedProcess.exists(currentGameService().primaryProcessId)) {
                            if (Date.now() >= deadline)
                                throw new Error(
                                    "The server has not stopped; its files and entry were kept",
                                );
                            await new Promise((resolve) => setTimeout(resolve, 100));
                        }
                        // Keep its directory and backups; removal never deletes user data.
                        for (const name of currentGameService().portNames)
                            await livePortDeps().ports.release(name);
                    });
                    await backupApi.forSource(PANEL_ID, scope.server.id).setSchedule(null);
                    await scope.project!.remove();
                    if (scope.legacy)
                        for (const def of await gameServiceFor(scope.server.game).actions())
                            await actionsApi.unregister(def.id, PANEL_ID);
                    await updateSaved((current) => {
                        const next = {
                            ...current,
                            servers: current.servers.filter((s) => s.id !== server),
                        };
                        if (next.legacyServer === server) delete next.legacyServer;
                        return next;
                    });
                    await inServer(scope, async () => { cancelReadiness(); cancelAutomation(); await currentGameService().dispose(); });
                    for (const off of scope.unsubscribe) off();
                    entries.delete(server);
                    icons.delete(server);
                    rootContext.setState({ [serverStateKey(server)]: null });
                    publish();
                    return { removed: server };
                } catch (err) {
                    scope.removing = false;
                    throw err;
                }
            }),
        ),
        management(WIDGET_CHOICES_ACTION, ({ widgetId }: { widgetId: string }) =>
            saved.servers.filter((server) => {
                const state = entries.get(server.id)!.ctx.state;
                return gameFor(server.game).describe({ software: state.serverSoftware, version: state.serverVersion, settings: state.gameSettings }).widgets.includes(widgetId);
            }).map((s) => ({ value: s.id, label: s.name })),
        ),
    ],
    async onInit(ctx) {
        rootContext = ctx;
        try {
            const original = await config.get(PANEL_ID);
            saved = readServersConfig(original);
            // No file operations or data moves: installed records and all config
            // keys become settings of the migrated server in one atomic write.
            await config.set(saved, PANEL_ID);
            await removeOldHeadStore();
            const scopes = saved.servers.map(createScope);
            for (const scope of scopes) {
                try {
                    await initialize(scope);
                } catch (err) {
                    console.error(`[gameserver] ${scope.server.name} could not initialize:`, err);
                }
            }
            publish();
        } catch (err) {
            ctx.setState({ serversError: err instanceof Error ? err.message : String(err) });
            console.error("[gameserver] servers could not be loaded:", err);
        }
    },
    async beforeRestore(_ctx, { sourceId }) {
        const selected = sourceId === undefined ? [...entries.values()] : [requireServer(sourceId)];
        for (const entry of selected) await inServer(entry, async () => {
            if (currentGameService().backup.mode === "offline") await currentGameService().backup.before(entry.ctx);
        });
    },
    async beforeBackup(_ctx, { sourceId }) {
        const paused: ServerScope[] = [];
        try {
            const selected = sourceId === undefined ? [...entries.values()] : [requireServer(sourceId)];
            for (const entry of selected) {
                await inServer(entry, () => {
                    const policy = currentGameService().backup;
                    return policy.before(entry.ctx);
                });
                paused.push(entry);
            }
        } catch (err) {
            for (const entry of paused) await inServer(entry, () => currentGameService().backup.recover());
            throw err;
        }
    },
});
export default gameServerService;
