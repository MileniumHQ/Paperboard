import {
    definePanelService,
    backupApi,
    blocksApi,
    config,
    fileApi,
    type ServiceContext,
    type BlocksHandle,
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
import { bindScope, inServer, type ServerScope } from "./service/scope";
import type { ServerCalls } from "./service/calls";
import { announceChanges, bindBlocks, fireBackupEnded, fireTrigger, mergeBlocks, serverOperation, sharedBlocks, sharedTypes } from "./service/blocks";
import { SERVER_EVENTS, serverType, serversBlocks, type ServersBlocksHost } from "./service/serversBlocks";
import { processApi as scopedProcess } from "./service/api";
import { type GameServerState, SERVER_PROC_ID, appendCapped } from "./service/types";
import { CALLS } from "./service/contract";
import { setRecoveryBlock } from "./service/recoveryState";
import { handleProcessData, handleProcessExit, stopServerInstance, cancelReadiness, restartServerInstance, startServerInstance } from "./service/lifecycle";
import { cancelAutomation, readAutomation, scheduleDailyRestart, scheduleUpdateChecks } from "./service/automation";
import { historyWriter, onlineSinceAfter, readHistory } from "./service/history";

import { currentGameService, gameServiceFor } from "./games/service";
import { settingsBlocks } from "./service/settingsBlocks";
import { assertGameCall, gameFor, games } from "./games";
import { loadServerOptions } from "./service/options";
import { livePortDeps } from "./service/portDeps";
import { waitUntil } from "./games/serviceKit";
export * from "./service/types";

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
/** A server as the Blocks Library shows it: as the server list does, by its own icon or else its game's. */
const blocksProject = (server: StoredServer) => ({
    name: server.name,
    icon: gameFor(server.game).icon,
    image: icons.get(server.id) ?? gameFor(server.game).art.icon,
});
// the panel's own blocks, once registered: before then nothing listens
let panelBlocks: BlocksHandle | null = null;
let announcedServers = "";
function announceServers(): void {
    const ids = JSON.stringify(saved.servers.map((server) => server.id));
    if (!panelBlocks || ids === announcedServers) return;
    announcedServers = ids;
    panelBlocks.changed("servers").catch((err) => console.error("[gameserver] the change to the server list did not reach Blocks:", err));
}
/** One of the panel's own server events, for the server it happened to. */
function fireServerEvent(id: string, server: string): void {
    if (!panelBlocks || !SERVER_EVENTS.includes(id)) return;
    panelBlocks.fire(id, { server }).catch((err) => console.error(`[gameserver] ${id} for ${server} did not reach Blocks:`, err));
}
// each server's console and chat, kept on disk so a service restart (an
// update, a crash, a reboot) opens with what was last said
const histories = new Map<string, ReturnType<typeof historyWriter>>();
const historyFile = (id: string) => fileApi.getPath(`${saved.serversDirectory}/history/${id}.json`, PANEL_ID);
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
    announceServers();
}
function requireServer(id: unknown): ServerScope {
    if (rootContext.state.serversError) throw new Error(rootContext.state.serversError);
    const entry = typeof id === "string" ? entries.get(id) : undefined;
    if (!entry) throw new Error("Choose a server that has not been removed");
    return entry;
}
/** Every game's calls, by game; a server answers the ones its game does. */
const gameCalls = new Map<string, ServerCalls>(await Promise.all(games.map(async (game): Promise<[string, ServerCalls]> => [game.id, await gameServiceFor(game.id).calls()])));
// what a server's icon call changes in the lists that show it
const ICON_CALLS: readonly string[] = [CALLS.setServerIcon, CALLS.removeServerIcon];
/** Runs one of a server's calls: the input names the server, and the rest is the call's own. */
async function serverCall(name: string, input: unknown): Promise<unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${name} needs the server it is for`);
    const { server, ...rest } = input as Record<string, unknown>;
    const scope = requireServer(server);
    if (scope.removing) throw new Error("This server was removed or is being removed");
    assertGameCall(gameFor(scope.server.game), {
        settings: scope.ctx.state.gameSettings,
        software: scope.ctx.state.serverSoftware,
        version: scope.ctx.state.serverVersion,
    }, name);
    const call = gameCalls.get(scope.server.game)?.[name];
    if (!call) throw new Error(`${gameFor(scope.server.game).name} has no call "${name}"`);
    scope.activeOperations++;
    try {
        const result = await inServer(scope, () => call(scope.ctx, rest));
        if (ICON_CALLS.includes(name)) {
            icons.set(
                scope.server.id,
                await inServer(scope, () => gameServiceFor(scope.server.game).readIcon?.() ?? null),
            );
            publish();
            await scope.blocks?.update(blocksProject(scope.server));
        }
        return result;
    } finally {
        scope.activeOperations--;
    }
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
                const before = state;
                state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
                state.onlineSince = onlineSinceAfter(before, state);
                announceChanges(scope.blocks, before, state, server.name);
                publish(scope);
                histories.get(server.id)?.changed(state);
            },
            emit: (event, payload) => rootContext.emit(event, { server: server.id, payload }),
        } as ServiceContext<GameServerState>,
        trigger(id, output) {
            fireTrigger(scope.blocks, id, output, server.name);
            fireServerEvent(id, server.id);
        },
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
    };
    bindScope(scope.ctx, scope);
    entries.set(server.id, scope);
    histories.set(server.id, historyWriter(() => historyFile(server.id), (err) => {
        console.error(`[gameserver] the console history of ${server.name} could not be saved:`, err);
        scope.ctx.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type: "error", content: `[Server] The console history could not be saved: ${err instanceof Error ? err.message : String(err)}` }) }));
    }));
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
            ...(game.backupSkip ? { skip: [...game.backupSkip] } : {}),
        });
        scope.blocks = await blocksApi.defineProject({ id: server.id, ...blocksProject(server) }, PANEL_ID);
        const blocks = scope.blocks;
        await inServer(scope, async () => blocks.register(bindBlocks(scope, mergeBlocks(sharedBlocks(scope.ctx), settingsBlocks(scope.ctx), await game.blocks?.(scope.ctx)))));
        let wasRunning = false;
        let onlineSince: number | null = null;
        try {
            const history = await readHistory(await historyFile(server.id));
            wasRunning = history.running;
            onlineSince = history.onlineSince;
            histories.get(server.id)!.loaded(history);
            scope.ctx.setState({ serverEntries: history.serverEntries, chatMessages: history.chatMessages });
        } catch (err) {
            console.error(`[gameserver] the console history of ${server.name} could not be read:`, err);
            scope.ctx.setState({ serverEntries: [{ type: "error", content: `[Server] The saved console history could not be read: ${err instanceof Error ? err.message : String(err)}` }] });
        }
        await inServer(scope, async () => {
            // A server left running keeps its identity and directory on migration.
            // Recovery must never modify that running process's files.
            const running = await scopedProcess.exists(game.primaryProcessId);
            // a server left running has been online since its history says; one whose history
            // predates that record counts from now
            if (running) scope.ctx.setState({ serverStatus: "online", ...(onlineSince === null ? {} : { onlineSince }) });
            scope.unsubscribe.push(
                scopedProcess.onData(game.primaryProcessId, (chunk) =>
                    handleProcessData(scope.ctx, chunk),
                ),
            );
            scope.unsubscribe.push(
                scopedProcess.onExit(game.primaryProcessId, (code) => handleProcessExit(scope.ctx, code)),
            );
            await loadServerOptions(scope.ctx);
            const automation = await readAutomation();
            scheduleDailyRestart(scope.ctx, restartServerInstance);
            scheduleUpdateChecks(scope.ctx, restartServerInstance);
            await game.initialize(scope.ctx, running);
            icons.set(server.id, (await game.readIcon?.()) ?? null);
            // the server runs either way; only the Blocks Library keeps the game's art
            if (icons.get(server.id)) {
                await blocks.update(blocksProject(server)).catch((err) =>
                    console.error(`[gameserver] the Blocks Library can't show ${server.name}'s icon:`, err),
                );
            }
            // the server was running when this service last saw it and nobody
            // stopped it: it went down while Paperboard was not watching (the
            // computer restarted, or the system ended it), which is a crash
            if (wasRunning && !running) {
                const restart = automation.restartAfterCrash;
                scope.ctx.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type: "warn", content: `[Server] The server stopped while Paperboard was not running.${restart ? " Starting it again." : ""}` }) }));
                // a launch that fails says so in the console itself
                if (restart) void startServerInstance(scope.ctx).catch((err) => console.error(`[gameserver] ${server.name} could not start again:`, err));
            }
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
/** The servers that run any of these processes (their ids as the daemon knows them). */
function serversRunning(processes: string[]): ServerScope[] {
    return [...entries.values()].filter((scope) =>
        gameServiceFor(scope.server.game).processIds.some((id) => processes.includes(scope.legacy ? id : `${scope.server.id}-${id}`)),
    );
}
/** Makes a server, as New server does; gives its id. */
function addServer(name: unknown, game: unknown): Promise<string> {
    return serial(async () => {
        if (rootContext.state.serversError) throw new Error(rootContext.state.serversError);
        if (saved.servers.length >= MAX_SERVERS)
            throw new Error(`This computer can keep at most ${MAX_SERVERS} servers`);
        const definition = gameFor(game as string);
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
        return id;
    });
}
function renameServer(server: unknown, name: unknown): Promise<void> {
    return serial(async () => {
        const scope = requireServer(server);
        const renamed = { ...scope.server, name: serverName(name) };
        await scope.blocks!.update(blocksProject(renamed));
        await updateSaved((current) => ({
            ...current,
            servers: current.servers.map((s) =>
                s.id === renamed.id ? { ...s, name: renamed.name } : s,
            ),
        }));
        publish();
    });
}
/** Stops the server and removes its entry; its directory and backups are kept. */
function removeServer(server: unknown): Promise<void> {
    return serial(async () => {
        const scope = requireServer(server);
        const id = scope.server.id;
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
            await backupApi.forSource(PANEL_ID, id).setSchedule(null);
            await scope.blocks!.remove();
            await updateSaved((current) => {
                const next = {
                    ...current,
                    servers: current.servers.filter((s) => s.id !== id),
                };
                if (next.legacyServer === id) delete next.legacyServer;
                return next;
            });
            await inServer(scope, async () => { cancelReadiness(); cancelAutomation(); await currentGameService().dispose(); });
            // the history is the server's console, not its files: it goes with the entry
            await histories.get(id)!.stop();
            histories.delete(id);
            await nodeFs.rm(await historyFile(id), { force: true });
            for (const off of scope.unsubscribe) off();
            entries.delete(id);
            icons.delete(id);
            rootContext.setState({ [serverStateKey(id)]: null });
            publish();
        } catch (err) {
            scope.removing = false;
            throw err;
        }
    });
}
/** What the panel's own blocks run: the functions above, and each server's own operations. */
const serversHost: ServersBlocksHost = {
    ids: () => {
        if (rootContext.state.serversError) throw new Error(rootContext.state.serversError);
        return saved.servers.map((server) => server.id);
    },
    server: (id) => {
        const scope = requireServer(id);
        return { name: scope.server.name, game: gameFor(scope.server.game).name, status: scope.ctx.state.serverStatus };
    },
    games: () => games.map((game) => ({ label: game.name, value: game.id })),
    create: addServer,
    rename: renameServer,
    remove: removeServer,
    operate: (id, work) => {
        const scope = requireServer(id);
        return serverOperation(scope, () => work(scope.ctx));
    },
};
/** The sections the panel's and its servers' blocks sit in; registered first, so every server's blocks find them. */
const BLOCK_CATEGORIES = [
    { name: "Servers", icon: "storage" },
    { name: "Server", icon: "dns" },
    { name: "Players", icon: "group" },
    { name: "Chat", icon: "chat" },
    { name: "Worlds", icon: "public" },
    { name: "Game Rules", icon: "rule" },
    { name: "Options", icon: "tune" },
    { name: "Files", icon: "folder" },
    { name: "Plugins", icon: "extension" },
    { name: "Datapacks", icon: "deployed_code" },
    { name: "Modpack", icon: "package_2" },
    { name: "Backups", icon: "backup" },
    { name: "Automation", icon: "autorenew" },
    { name: "Logs", icon: "receipt_long" },
];
type RootCalls = Record<string, (ctx: ServiceContext<ServersState>, input: any) => unknown>;
/** The calls that manage the saved servers; every other call is a server's own and names its server. */
const managementCalls: RootCalls = {
    "read-server-config": (_ctx, { server }) => requireServer(server).server.settings,
    "add-server": async (_ctx, { name, game }) => ({ id: await addServer(name, game) }),
    "rename-server": async (_ctx, { server, name }) => (await renameServer(server, name), true),
    "remove-server": async (_ctx, { server }) => (await removeServer(server), { removed: server }),
};
/** One root call for each name any game answers, which asks the server in its input. */
const callNames = [...new Set([...gameCalls.values()].flatMap((calls) => Object.keys(calls)))];
for (const name of callNames) {
    if (Object.hasOwn(managementCalls, name)) throw new Error(`The call "${name}" is both a server's and a management call`);
}
export const gameServerService = definePanelService({
    id: PANEL_ID,
    state: { servers: [], serversError: null } as ServersState,
    calls: {
        ...managementCalls,
        ...Object.fromEntries(callNames.map((name): [string, RootCalls[string]] => [name, (_ctx, input) => serverCall(name, input)])),
    },
    // Home's gallery: each widget's "Server" dropdown offers the servers whose game shows that widget
    widgetChoices: Object.fromEntries(["status", "players", "console", "motd"].map((widgetId) => [widgetId, {
        server: () => saved.servers.filter((server) => {
            const state = entries.get(server.id)!.ctx.state;
            return gameFor(server.game).describe({ software: state.serverSoftware, version: state.serverVersion, settings: state.gameSettings }).widgets.includes(widgetId);
        }).map((s) => ({ value: s.id, label: s.name })),
    }])),
    async onInit(ctx) {
        rootContext = ctx;
        try {
            const gameTypes = await Promise.all(games.map((g) => gameServiceFor(g.id).blockTypes?.() ?? []));
            const onlinePlayers = (server: string) => {
                const scope = entries.get(server);
                if (!scope) throw new Error(`There is no server "${server}"`);
                return scope.ctx.state.onlinePlayers;
            };
            const handle = blocksApi.panel(PANEL_ID);
            await handle.register({ categories: BLOCK_CATEGORIES, types: [...sharedTypes(onlinePlayers, () => serversHost.ids()), ...gameTypes.flat(), serverType(serversHost)], ...serversBlocks(serversHost) });
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
            // the list as Blocks first reads it; changes from here on are announced
            announcedServers = JSON.stringify(saved.servers.map((server) => server.id));
            panelBlocks = handle;
            publish();
        } catch (err) {
            ctx.setState({ serversError: err instanceof Error ? err.message : String(err) });
            console.error("[gameserver] servers could not be loaded:", err);
        }
    },
    // an update of Game Server, or of a runtime its servers run on (Java),
    // stops each server in its way the way Stop does, saving the world,
    // and starts it again once the update ends
    async beforeUpdate(_ctx, { processes }) {
        for (const scope of serversRunning(processes)) {
            await inServer(scope, async () => {
                if (scope.ctx.state.serverStatus === "restarting")
                    throw new Error(`${scope.server.name} is restarting; update once it's back online`);
                scope.ctx.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type: "info", content: "[Server] Stopping for an update..." }) }));
                await stopServerInstance(scope.ctx);
                await waitUntil(async () => !(await scopedProcess.exists(currentGameService().primaryProcessId)), 90_000, `${scope.server.name} to stop`);
            });
        }
    },
    async afterUpdate(_ctx, { processes, ok, error }) {
        for (const scope of serversRunning(processes)) {
            const why = ok
                ? { type: "info" as const, content: "[Server] Updated. Starting again." }
                : { type: "warn" as const, content: `[Server] The update failed, so nothing changed: ${error ?? "no reason given"}. Starting again.` };
            // a launch that fails says so in the console itself
            await inServer(scope, () => startServerInstance(scope.ctx, [why])).catch((err) =>
                console.error(`[gameserver] ${scope.server.name} could not start again after the update:`, err),
            );
        }
    },
    async beforeRestore(_ctx, { sourceId }) {
        const selected = sourceId === undefined ? [...entries.values()] : [requireServer(sourceId)];
        for (const entry of selected) await inServer(entry, async () => {
            if (currentGameService().backup.mode === "offline") await currentGameService().backup.before(entry.ctx);
        });
    },
    // a server's backup fires its Blocks events; a backup of the whole panel is no one server's
    afterBackup(_ctx, ended) {
        const scope = ended.sourceId === undefined ? undefined : entries.get(ended.sourceId);
        if (scope) fireBackupEnded(scope.blocks, ended, scope.server.name);
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
