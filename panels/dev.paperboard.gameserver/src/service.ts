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
import { initialServerState } from "./service/initialState";
import { inServer, type ServerScope } from "./service/scope";
import { processApi as scopedProcess, LEGACY_DEPRECATION } from "./service/api";
import { type GameServerState, SERVER_PROC_ID } from "./service/types";
import { stopLeftoverInstaller } from "./service/installerProcess";
import { setRecoveryBlock } from "./service/recoveryState";
import { settleInterruptedWork } from "./service/recovery";
import { loadConfigAndProperties } from "./service/config";
import { handleProcessData, handleProcessExit, stopServerInstance } from "./service/lifecycle";
import {
    panelActions,
    panelEventActions,
    customTypes,
    cancelDynamicActions,
    republishDynamicActions,
    scheduleRepublishDynamicActions,
} from "./service/actions";
import { setPlayerNamesChangedHandler } from "./service/players";
import { pauseSavingForBackup, recoverPausedSaving } from "./service/saving";
import { livePortDeps } from "./service/portDeps";
import { JAVA_PORT_NAME, BEDROCK_PORT_NAME } from "./core/portNames";
import { readServerIcon } from "./service/serverIcon";
export * from "./service/types";
export * from "./service/actions";
export { LEGACY_DEPRECATION };

export interface ServerSummary extends Omit<StoredServer, "settings"> {
    configured: boolean;
    icon: string | null;
    state: Pick<
        GameServerState,
        "serverStatus" | "serverSoftware" | "serverVersion" | "recoveryBlock"
    >;
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
        const state = entries.get(server.id)!.ctx.state;
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
                recoveryBlock: state.recoveryBlock,
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
                      scope.activeOperations++;
                      try {
                          const result = await inServer(scope, () =>
                              (def.run as Function)(scope.ctx, ...args),
                          );
                          if (["set-server-icon", "remove-server-icon"].includes(def.id)) {
                              icons.set(
                                  scope.server.id,
                                  await readServerIcon({
                                      serverDir: () =>
                                          fileApi.getPath(scope.server.directory, PANEL_ID),
                                  }),
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
async function initialize(server: StoredServer): Promise<ServerScope> {
    let state = initialServerState();
    const scope: ServerScope = {
        server,
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
    try {
        if (server.game !== "minecraft") throw new Error(`Unsupported game: ${server.game}`);
        await nodeFs.mkdir(await fileApi.getPath(server.directory, PANEL_ID), { recursive: true });
        await backupApi.defineSource(PANEL_ID, {
            id: server.id,
            directory: server.directory,
            config: ["servers", { id: server.id }, "settings"],
            processes: scope.legacy
                ? ["mc-server", "mc-installer"]
                : [`${server.id}-mc-server`, `${server.id}-mc-installer`],
            ...(scope.legacy ? { legacy: true, exclude: [saved.serversDirectory] } : {}),
        });
        scope.project = await actionsApi.defineProject(
            { id: server.id, name: server.name, icon: "dns" },
            PANEL_ID,
        );
        for (const def of [...panelActions, ...panelEventActions]) {
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
            const running = await scopedProcess.exists(SERVER_PROC_ID);
            if (running) state = { ...state, serverStatus: "online" };
            scope.unsubscribe.push(
                scopedProcess.onData(SERVER_PROC_ID, (chunk) =>
                    handleProcessData(scope.ctx, chunk),
                ),
            );
            scope.unsubscribe.push(
                scopedProcess.onExit(SERVER_PROC_ID, () => handleProcessExit(scope.ctx)),
            );
            await loadConfigAndProperties(scope.ctx);
            if (!running) await settleInterruptedWork(scope.ctx);
            await recoverPausedSaving();
            setPlayerNamesChangedHandler(() => scheduleRepublishDynamicActions(scope.ctx));
            await republishDynamicActions(scope.ctx);
            icons.set(
                server.id,
                await readServerIcon({
                    serverDir: () => fileApi.getPath(server.directory, PANEL_ID),
                }),
            );
        });
        return scope;
    } catch (err) {
        const reason = `Server initialization failed: ${err instanceof Error ? err.message : String(err)}`;
        inServer(scope, () => setRecoveryBlock(reason));
        state = { ...state, recoveryBlock: reason };
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
    types: customTypes,
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
        management("add-server", ({ name }: any) =>
            serial(async () => {
                if (rootContext.state.serversError) throw new Error(rootContext.state.serversError);
                if (saved.servers.length >= MAX_SERVERS)
                    throw new Error(`This computer can keep at most ${MAX_SERVERS} servers`);
                const id = createServerId();
                const server: StoredServer = {
                    id,
                    name: serverName(name),
                    game: "minecraft",
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
                await initialize(server);
                publish();
                return { id };
            }),
        ),
        management("rename-server", ({ server, name }: any) =>
            serial(async () => {
                const scope = requireServer(server);
                const renamed = { ...scope.server, name: serverName(name) };
                await scope.project!.update({ name: renamed.name, icon: "dns" });
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
                        await stopLeftoverInstaller();
                        await stopServerInstance(scope.ctx);
                        const deadline = Date.now() + 40_000;
                        while (await scopedProcess.exists(SERVER_PROC_ID)) {
                            if (Date.now() >= deadline)
                                throw new Error(
                                    "The server has not stopped; its files and entry were kept",
                                );
                            await new Promise((resolve) => setTimeout(resolve, 100));
                        }
                        // Keep its directory and backups; removal never deletes user data.
                        await livePortDeps().ports.release(JAVA_PORT_NAME);
                        await livePortDeps().ports.release(BEDROCK_PORT_NAME);
                    });
                    await backupApi.forSource(PANEL_ID, scope.server.id).setSchedule(null);
                    await scope.project!.remove();
                    if (scope.legacy)
                        for (const def of [...panelActions, ...panelEventActions])
                            await actionsApi.unregister(def.id, PANEL_ID);
                    await updateSaved((current) => {
                        const next = {
                            ...current,
                            servers: current.servers.filter((s) => s.id !== server),
                        };
                        if (next.legacyServer === server) delete next.legacyServer;
                        return next;
                    });
                    inServer(scope, () => {
                        cancelDynamicActions();
                        setPlayerNamesChangedHandler(null);
                    });
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
        management(WIDGET_CHOICES_ACTION, () =>
            saved.servers.map((s) => ({ value: s.id, label: s.name })),
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
            for (const server of saved.servers) {
                try {
                    await initialize(server);
                } catch (err) {
                    console.error(`[gameserver] ${server.name} could not initialize:`, err);
                }
            }
            publish();
        } catch (err) {
            ctx.setState({ serversError: err instanceof Error ? err.message : String(err) });
            console.error("[gameserver] servers could not be loaded:", err);
        }
    },
    async beforeBackup() {
        const paused: ServerScope[] = [];
        try {
            for (const entry of entries.values()) {
                await inServer(entry, () => pauseSavingForBackup(entry.ctx));
                paused.push(entry);
            }
        } catch (err) {
            for (const entry of paused) await inServer(entry, () => recoverPausedSaving());
            throw err;
        }
    },
});
export default gameServerService;
