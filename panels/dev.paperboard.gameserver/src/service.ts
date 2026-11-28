import {
    definePanelService,
    blocksApi,
    config,
    fileApi,
    type CallHandlers,
    type CallInput,
    type CallsOf,
    type ContractContext,
    type StateOf,
    type BlocksHandle,
    SerialQueue,
} from "@mileniumhq/paperapi";
import {
    PANEL_ID,
    MAX_SERVERS,
    createServerId,
    readServersConfig,
    serverName,
    type ServersConfig,
    type StoredServer,
} from "./servers";
import type { BackupSchedule } from "./backupSchedule";
import * as nodeFs from "node:fs/promises";
import { Server } from "./service/server";
import { announceChanges, bindBlocks, fireTrigger, mergeBlocks, serverOperation, sharedBlocks, sharedTypes } from "./service/blocks";
import { backUp, backupHooks, restoreBackup, routineBackups, type BackupsHost } from "./service/backups";
import { readScheduleChoice } from "./backupSchedule";
import { STEAM_FOLDER } from "./games/steam/steamcmd";
import { SERVER_EVENTS, serverType, serversBlocks, type ServersBlocksHost } from "./service/serversBlocks";
import { errorMessage, problemsApi } from "@mileniumhq/paperapi";
import { appendCapped, type GameServerState } from "./service/types";
import { SERVERS_CALLS, gameServerContract, type CallName, type ServerSummary } from "./service/contract";
import { pictureCall } from "./service/pictures";
import { steamAvatar } from "./service/steamAvatars";
import { handleProcessData, handleProcessExit, stopServerInstance, cancelReadiness, restartServerInstance, startServerInstance, releaseServer } from "./service/lifecycle";
import { cancelAutomation, readAutomation, scheduleDailyRestart, scheduleUpdateChecks } from "./service/automation";
import { historyWriter, readHistory } from "./service/history";

import { gameModuleFor } from "./games/service";
import { settingsBlocks } from "./service/settingsBlocks";
import { assertGameCall, gameFor, games } from "./games";
import { loadServerOptions } from "./service/options";
import { joinPort } from "./core/portNames";
import { report, resumeFolder, takeResume, waitUntil } from "./games/serviceKit";
export * from "./service/types";

export type { ServerSummary };
/** The saved servers, as the pages mirror them; each server's own state is the contract's keyed state. */
export type ServersState = StateOf<typeof gameServerContract>;
const entries = new Map<string, Server>();
let saved: ServersConfig = readServersConfig(null);
let rootContext: ContractContext<typeof gameServerContract>;
// server changes, and the config writes inside them, one at a time
const serial = new SerialQueue().run;
const configWrites = new SerialQueue().run;
function updateSaved(change: (current: ServersConfig) => ServersConfig): Promise<void> {
    return configWrites(async () => {
        const next = change(saved);
        await config.set(next, PANEL_ID);
        saved = next;
        for (const server of saved.servers) {
            const entry = entries.get(server.id);
            if (entry) entry.stored = server;
        }
    });
}
/** A server as the Blocks Library shows it: as the server list does, by its own icon or else its game's. */
const blocksProject = (server: Server, name = server.name) => ({
    name,
    icon: server.definition.icon,
    image: server.icon ?? server.definition.art.icon,
});
// the panel's own blocks, once registered: before then nothing listens
let panelBlocks: BlocksHandle | null = null;
let announcedServers = "";
function announceServers(): void {
    const ids = JSON.stringify(saved.servers.map((server) => server.id));
    if (!panelBlocks || ids === announcedServers) return;
    announcedServers = ids;
    // quiet: a change notice is only a hint; Blocks reads the list itself whenever it runs
    panelBlocks.changed("servers").catch((err) => console.error("[gameserver] the change to the server list did not reach Blocks:", err));
}
/** One of the panel's own server events, for the server it happened to. */
function fireServerEvent(id: string, server: string, failed: (what: string, err: unknown) => void): void {
    if (!panelBlocks || !SERVER_EVENTS.includes(id)) return;
    panelBlocks.fire(id, { server }).catch((err) => failed(`${id} did not reach Blocks`, err));
}
// each server's console and chat are kept on disk so a service restart (an
// update, a crash, a reboot) opens with what was last said
const historyFile = (id: string) => fileApi.getPath(`${saved.serversDirectory}/history/${id}.json`, PANEL_ID);
function publish(changed?: Server): void {
    const servers = saved.servers.map((server): ServerSummary => {
        const entry = entries.get(server.id);
        if (!entry) throw new Error(`Server is missing: ${server.id}`);
        const state = entry.state;
        return {
            id: server.id,
            name: server.name,
            game: server.game,
            directory: server.directory,
            createdAt: server.createdAt,
            configured: server.settings.configured === true,
            icon: entry.icon,
            state: {
                serverStatus: state.serverStatus,
                serverSoftware: state.serverSoftware,
                serverVersion: state.serverVersion,
                serverPort: joinPort(state),
                recoveryBlock: state.recoveryBlock,
                initFailure: state.initFailure,
                maxPlayers: state.maxPlayers,
                playerCount: state.onlinePlayers.length,
            },
        };
    });
    const patch: Partial<ServersState> = {};
    if (JSON.stringify(rootContext.state.servers) !== JSON.stringify(servers))
        patch.servers = servers;
    const legacyServer = saved.legacyServer ?? null;
    if (rootContext.state.legacyServer !== legacyServer)
        patch.legacyServer = legacyServer;
    if (Object.keys(patch).length > 0) rootContext.setState(patch);
    for (const server of changed ? [changed] : entries.values())
        rootContext.keyed.server.set(server.id, server.state);
    announceServers();
}
function requireServer(id: unknown): Server {
    if (rootContext.state.serversError) throw new Error(rootContext.state.serversError);
    const entry = typeof id === "string" ? entries.get(id) : undefined;
    if (!entry) throw new Error("Choose a server that has not been removed");
    return entry;
}
/** A server that could not be set up runs nothing until setting it up again succeeds. */
function requireInitialized(server: Server): Server {
    const failure = server.state.initFailure;
    if (failure !== null) throw new Error(`${server.name} could not be set up (${failure}). Try again from its Overview tab.`);
    return server;
}
// what a server's icon call changes in the lists that show it
const ICON_CALLS: readonly CallName[] = ["setServerIcon", "removeServerIcon"];
/** One of a server's calls, as the server's game answers it, with the input the contract checked. */
function game<K extends ServerCallName>(name: K) {
    return (input: CallInput<Calls[K]>, _ctx: unknown, { server: id }: { server?: string }) =>
        onServer(id, name, async (server) => {
            const call = (await server.game.calls())[name];
            if (!call) throw new Error(`${server.definition.name} has no call "${name}"`);
            return call(server, input);
        });
}
/** Runs work for one server's call: the server must be set up and its game must answer the call. */
async function onServer<T>(id: unknown, name: CallName, work: (server: Server) => T | Promise<T>): Promise<Awaited<T>> {
    const server = requireInitialized(requireServer(id));
    if (server.removing) throw new Error("This server was removed or is being removed");
    assertGameCall(server.definition, {
        settings: server.state.gameSettings,
        software: server.state.serverSoftware,
        version: server.state.serverVersion,
    }, name);
    server.activeOperations++;
    try {
        const result = await work(server);
        if (ICON_CALLS.includes(name)) {
            server.icon = (await server.game.readIcon?.()) ?? null;
            publish();
            await server.blocks?.update(blocksProject(server));
        }
        return result;
    } finally {
        server.activeOperations--;
    }
}
function createServer(stored: StoredServer): Server {
    const history = historyWriter(() => historyFile(stored.id), (err) => report(server, "The console history could not be saved", err));
    const server: Server = new Server(stored, {
        history,
        changed(server, before) {
            announceChanges(server.blocks, before, server.state, server.name);
            publish(server);
            history.changed(server.state);
        },
        trigger(server, id, output) {
            const failed = (what: string, err: unknown) => report(server, what, err);
            fireTrigger(server.blocks, id, output, failed);
            fireServerEvent(id, server.id, failed);
        },
        async updateSettings(server, change) {
            let next: Record<string, unknown> = {};
            await updateSaved((current) => {
                requireServer(server.id);
                return {
                    ...current,
                    servers: current.servers.map((s) =>
                        s.id === server.id ? { ...s, settings: (next = change(s.settings)) } : s,
                    ),
                };
            });
            publish();
            return next;
        },
    }, saved.legacyServer === stored.id);
    entries.set(stored.id, server);
    return server;
}
// Player heads were kept on disk beside the servers until they were looked
// up fresh each time; the stale copies go. Never a server's own folder.
async function removeOldHeadStore(): Promise<void> {
    const dir = `${saved.serversDirectory}/player-heads`;
    if (saved.servers.some((server) => server.directory === dir)) return;
    try {
        await nodeFs.rm(await fileApi.getPath(dir, PANEL_ID), { recursive: true, force: true });
    } catch (err) {
        // quiet: a stale cache left on disk harms nothing, and it is tried again at the next start
        console.error("[gameserver] the old player head cache could not be removed:", err);
    }
}

async function initialize(server: Server): Promise<Server> {
    const { game } = server;
    try {
        await nodeFs.mkdir(await fileApi.getPath(server.stored.directory, PANEL_ID), { recursive: true });
        server.blocks = await blocksApi.defineProject({ id: server.id, ...blocksProject(server) }, PANEL_ID);
        const blocks = server.blocks;
        await blocks.register(bindBlocks(server, mergeBlocks(sharedBlocks(server), settingsBlocks(server), await game.blocks?.())));
        let wasRunning = false;
        let onlineSince: number | null = null;
        let portMoves: GameServerState["portMoves"] = [];
        try {
            const history = await readHistory(await historyFile(server.id));
            wasRunning = history.running;
            onlineSince = history.onlineSince;
            portMoves = history.portMoves;
            server.history!.loaded(history);
            server.setState({ serverEntries: history.serverEntries, chatMessages: history.chatMessages });
        } catch (err) {
            console.error(`[gameserver] the console history of ${server.name} could not be read:`, err);
            server.setState({ serverEntries: [{ type: "error", content: `[Server] The saved console history could not be read: ${errorMessage(err)}` }] });
        }
        // A server left running keeps its identity and directory on migration.
        // Recovery must never modify that running process's files.
        const running = await server.process.exists(game.primaryProcessId);
        // a server left running has been online since its history says; one whose history
        // predates that record counts from now
        if (running) server.setState({ serverStatus: "online", ...(onlineSince === null ? {} : { onlineSince }) });
        // it opened the ports its start claimed, which the registry still holds,
        // and players join it on the first of them, wherever that run moved it
        if (running) {
            server.runPorts = await server.ports.held();
            const joined = server.runPorts.get(game.portNames[0]!);
            const moved = portMoves.find((move) => move.primary);
            if (joined !== undefined) server.setState(moved?.to === joined ? { portMoves, serverPort: String(moved.from) } : { serverPort: String(joined) });
        }
        server.unsubscribe.push(
            server.process.onData(game.primaryProcessId, (chunk) => handleProcessData(server, chunk)),
            server.process.onExit(game.primaryProcessId, (code) => handleProcessExit(server, code)),
        );
        const automation = await loadSettings(server, running);
        // a backup or restore that stopped the running server left a marker
        // when the service died before its end: it starts again, as that
        // work would have
        const resume = await takeResume(server);
        // the server was running when this service last saw it and nobody
        // stopped it: it went down while Paperboard was not watching (the
        // computer restarted, or the system ended it), which is a crash,
        // unless a backup or restore ended it
        const crashed = wasRunning && !running;
        const restart = !running && (resume || (crashed && automation.restartAfterCrash));
        if (crashed) {
            if (!resume) server.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type: "warn", content: `[Server] The server stopped while Paperboard was not running.${restart ? " Starting it again." : ""}` }) }));
            // the game takes back what that run set aside, as it would have at its exit
            await releaseServer(server, portMoves);
        }
        // quiet: startServerInstance puts its own failure in the console
        if (restart) void startServerInstance(server).catch((err) => console.error(`[gameserver] ${server.name} could not start again:`, err));
        return server;
    } catch (err) {
        server.setState((prev) => ({
            initFailure: errorMessage(err),
            serverEntries: appendCapped(prev.serverEntries, { type: "error", content: `[Server] The server could not be set up: ${errorMessage(err)}` }),
        }));
        throw err;
    }
}
/** Reads what the server's settings and files say, as its setup and a restore do; gives its automation. */
async function loadSettings(server: Server, running: boolean) {
    await loadServerOptions(server);
    const automation = readAutomation(server);
    scheduleDailyRestart(server, restartServerInstance);
    scheduleUpdateChecks(server, restartServerInstance);
    await server.game.initialize(running);
    server.icon = (await server.game.readIcon?.()) ?? null;
    // the server runs either way; only the Blocks Library keeps the game's art
    if (server.icon && server.blocks) {
        await server.blocks.update(blocksProject(server)).catch((err) => report(server, "The Blocks Library can't show this server's icon", err));
    }
    return automation;
}
/** Ends what a server's setup started: its subscriptions, timers and its game's own work. */
async function dispose(server: Server): Promise<void> {
    for (const off of server.unsubscribe.splice(0)) off();
    cancelReadiness(server);
    cancelAutomation(server);
    server.console.dispose();
    await server.game.dispose();
}
/** Sets up a server whose setup failed again, from nothing: what the failed setup started is undone first. */
function retryInitialize(id: unknown): Promise<void> {
    return serial(async () => {
        const server = requireServer(id);
        if (server.state.initFailure === null) throw new Error(`${server.name} is already set up`);
        await dispose(server);
        // the failure stands until the setup is done: the notice says Retrying…, and Start stays blocked
        await initialize(server);
        server.setState({ initFailure: null });
        publish();
    });
}
/** The servers that run any of these processes (their ids as the daemon knows them). */
function serversRunning(processes: string[]): Server[] {
    return [...entries.values()].filter((server) => server.game.processIds.some((id) => processes.includes(server.processId(id))));
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
        await initialize(createServer(server));
        publish();
        return id;
    });
}
function renameServer(id: unknown, name: unknown): Promise<void> {
    return serial(async () => {
        const server = requireServer(id);
        const renamed = serverName(name);
        // a server whose setup failed has no project yet: setting it up again names it
        await server.blocks?.update(blocksProject(server, renamed));
        await updateSaved((current) => ({
            ...current,
            servers: current.servers.map((s) =>
                s.id === server.id ? { ...s, name: renamed } : s,
            ),
        }));
        publish();
    });
}
/** Stops the server and removes its entry; its directory and backups are kept. */
function removeServer(id: unknown): Promise<void> {
    return serial(async () => {
        const server = requireServer(id);
        if (server.activeOperations || server.backupHold)
            throw new Error(
                "Wait for this server's current operation to finish before removing it",
            );
        server.removing = true;
        try {
            await server.game.beforeRemove();
            await stopServerInstance(server);
            await waitUntil(async () => !(await server.process.exists(server.game.primaryProcessId)), 40_000, "the server to stop; its files and entry were kept");
            // Keep its directory and backups; removal never deletes user data.
            // Its routine backups end with its entry, which holds their schedule.
            for (const name of server.game.portNames) await server.ports.release(name);
            // a setup that failed may have made none
            await server.blocks?.remove();
            await updateSaved((current) => {
                const next = {
                    ...current,
                    servers: current.servers.filter((s) => s.id !== server.id),
                };
                if (next.legacyServer === server.id) delete next.legacyServer;
                return next;
            });
            await dispose(server);
            // the history is the server's console, not its files: it goes with the entry
            await server.history!.stop();
            await nodeFs.rm(await historyFile(server.id), { force: true });
            entries.delete(server.id);
            rootContext.keyed.server.delete(server.id);
            // what went wrong with it goes with it (report keys them by its id)
            problemsApi.clear(PANEL_ID, { prefix: `${server.id}:` });
            publish();
        } catch (err) {
            server.removing = false;
            throw err;
        }
    });
}
/** What the backup hooks and routine backups work on: the saved servers and their entries. */
const backupsHost: BackupsHost = {
    server: requireServer,
    servers: () => [...entries.values()],
    // the panel's own folders beside a legacy server's files: the other servers, their histories and the resume markers, and SteamCMD
    panelFolders: () => [saved.serversDirectory, STEAM_FOLDER, ...games.map((g) => resumeFolder(g.id))],
    async saveSchedule(server, change) {
        let next: BackupSchedule | null = null;
        await updateSaved((current) => ({
            ...current,
            servers: current.servers.map((s) => {
                if (s.id !== server.id) return s;
                const { backupSchedule, ...rest } = s;
                next = change(backupSchedule ?? null);
                return next ? { ...rest, backupSchedule: next } : rest;
            }),
        }));
        return next;
    },
    async replaceSettings(server, settings) {
        await updateSaved((current) => ({
            ...current,
            servers: current.servers.map((s) => (s.id === server.id ? { ...s, settings } : s)),
        }));
        publish();
    },
    async reload(server) {
        // the server is stopped for a restore: what its last run left is settled again
        await loadSettings(server, false);
        publish();
    },
};
const backups = backupHooks(backupsHost);
const routine = routineBackups(backupsHost);
/** Runs one of a server's backup calls: counted, so removal waits for it. */
function onBackups<T>(id: unknown, work: (server: Server) => Promise<T>): Promise<T> {
    const server = requireServer(id);
    return serverOperation(server, () => work(server));
}
/** What the panel's own blocks run: the functions above, and each server's own operations. */
const serversHost: ServersBlocksHost = {
    ids: () => {
        if (rootContext.state.serversError) throw new Error(rootContext.state.serversError);
        return saved.servers.map((server) => server.id);
    },
    server: (id) => {
        const server = requireServer(id);
        return { name: server.name, game: server.definition.name, status: server.state.serverStatus };
    },
    games: () => games.map((game) => ({ label: game.name, value: game.id })),
    create: addServer,
    rename: renameServer,
    remove: removeServer,
    operate: (id, work) => {
        const server = requireInitialized(requireServer(id));
        return serverOperation(server, () => work(server));
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
type Calls = CallsOf<typeof gameServerContract>;
type Handlers = CallHandlers<typeof gameServerContract>;
type ServersCallName = (typeof SERVERS_CALLS)[number];
type ServerCallName = Exclude<CallName, ServersCallName>;
/** The calls about the saved servers, and the pictures every page shows: the panel's own, not any game's. */
const serversCalls: Pick<Handlers, ServersCallName> = {
    addServer: async ({ name, game }) => ({ id: await addServer(name, game) }),
    renameServer: async ({ name }, _ctx, { server }) => (await renameServer(server, name), true),
    removeServer: async (_input, _ctx, { server }) => {
        const id = requireServer(server).id;
        await removeServer(id);
        return { removed: id };
    },
    readServerConfig: (_input, _ctx, { server }) => requireServer(server).settings,
    retryInitialize: async (_input, _ctx, { server }) => (await retryInitialize(server), true),
    backUp: ({ label }, _ctx, { server }) => onBackups(server, (s) => backUp(s, label)),
    restoreBackup: ({ backupId }, _ctx, { server }) => onBackups(server, (s) => restoreBackup(s, backupId)),
    readBackupSchedule: (_input, _ctx, { server }) => requireServer(server).stored.backupSchedule ?? null,
    writeBackupSchedule: ({ schedule }, _ctx, { server }) => onBackups(server, (s) => routine.set(s, schedule && readScheduleChoice(schedule))),
    servedPicture: (input) => pictureCall(input),
    steamAvatar: ({ steamId, size }) => steamAvatar(steamId, size),
};
/** Every other call is about one server, and its game answers it. */
const serverCalls: Omit<Handlers, ServersCallName> = {
    // every game's
    readAutomation: game("readAutomation"), writeAutomation: game("writeAutomation"), runCommand: game("runCommand"), saveWorld: game("saveWorld"), startServer: game("startServer"),
    stopServer: game("stopServer"), restartServer: game("restartServer"), loadConfig: game("loadConfig"), sayChat: game("sayChat"), listServerFiles: game("listServerFiles"),
    readServerFile: game("readServerFile"), writeServerFile: game("writeServerFile"), listLogFiles: game("listLogFiles"), readLogFile: game("readLogFile"),
    readGameOptions: game("readGameOptions"), writeGameOptions: game("writeGameOptions"),
    // Minecraft's
    killConflictingProcess: game("killConflictingProcess"), resetWorldFiles: game("resetWorldFiles"), clearActiveIssue: game("clearActiveIssue"),
    retryRecovery: game("retryRecovery"), updatePanelConfig: game("updatePanelConfig"), listWorldDirs: game("listWorldDirs"), listWorlds: game("listWorlds"),
    setActiveWorld: game("setActiveWorld"), deleteWorld: game("deleteWorld"), exportWorld: game("exportWorld"), importWorld: game("importWorld"),
    discardWorldTransfer: game("discardWorldTransfer"), installServerVersion: game("installServerVersion"), listSoftwareVersions: game("listSoftwareVersions"),
    readLoaderSettings: game("readLoaderSettings"), writeLoaderSetting: game("writeLoaderSetting"), readCrossplay: game("readCrossplay"),
    writeCrossplaySetting: game("writeCrossplaySetting"), prepareCrossplay: game("prepareCrossplay"), readServerIcon: game("readServerIcon"), setServerIcon: game("setServerIcon"),
    removeServerIcon: game("removeServerIcon"), locateAddonConfig: game("locateAddonConfig"), listMapRegions: game("listMapRegions"), renderMapTile: game("renderMapTile"),
    listInstalledPlugins: game("listInstalledPlugins"), recordPluginInstalls: game("recordPluginInstalls"), previewPluginInstall: game("previewPluginInstall"),
    installPluginVersion: game("installPluginVersion"), deletePlugin: game("deletePlugin"), uninstallAllPlugins: game("uninstallAllPlugins"), listDatapacks: game("listDatapacks"),
    listDatapackVersions: game("listDatapackVersions"), installDatapack: game("installDatapack"), removeDatapack: game("removeDatapack"), readResourcePack: game("readResourcePack"),
    listResourcePackVersions: game("listResourcePackVersions"), selectResourcePack: game("selectResourcePack"), removeResourcePack: game("removeResourcePack"),
    readModpack: game("readModpack"), listModpackVersions: game("listModpackVersions"), installModpack: game("installModpack"), removeModpack: game("removeModpack"),
    uploadPlugins: game("uploadPlugins"), uploadDatapacks: game("uploadDatapacks"), uploadModpack: game("uploadModpack"), discardAddonUpload: game("discardAddonUpload"),
    kickPlayer: game("kickPlayer"), banPlayer: game("banPlayer"), opPlayer: game("opPlayer"), deopPlayer: game("deopPlayer"), whitelistPlayer: game("whitelistPlayer"),
    unwhitelistPlayer: game("unwhitelistPlayer"), pardonPlayer: game("pardonPlayer"), killPlayer: game("killPlayer"), deletePlayerData: game("deletePlayerData"),
    getPlayerSkin: game("getPlayerSkin"), queryPlayerStats: game("queryPlayerStats"), queryOnlinePlayers: game("queryOnlinePlayers"),
    queryPlayerPositions: game("queryPlayerPositions"), listRoster: game("listRoster"), currentPlayerNames: game("currentPlayerNames"), readBedrockNaming: game("readBedrockNaming"),
    listPlayerStats: game("listPlayerStats"), queryGamerules: game("queryGamerules"), setGamerule: game("setGamerule"),
    // Steam games'
    steamInfo: game("steamInfo"), steamSize: game("steamSize"), steamLatest: game("steamLatest"), steamInstall: game("steamInstall"),
    // Source games'
    sourceMetrics: game("sourceMetrics"), sourcePlayers: game("sourcePlayers"), sourceKick: game("sourceKick"), sourceBan: game("sourceBan"), sourceUnban: game("sourceUnban"),
    sourceChangeMap: game("sourceChangeMap"), sourceMaps: game("sourceMaps"), sourceMapPictures: game("sourceMapPictures"), sourceMapPicture: game("sourceMapPicture"),
    sourceMapCycle: game("sourceMapCycle"), sourceMapCycleSet: game("sourceMapCycleSet"), sourcePlay: game("sourcePlay"), sourceWorkshopMaps: game("sourceWorkshopMaps"),
    sourceWorkshopFind: game("sourceWorkshopFind"), sourceWorkshopAdd: game("sourceWorkshopAdd"), sourceWorkshopRemove: game("sourceWorkshopRemove"),
    sourceSourcemod: game("sourceSourcemod"), sourceSourcemodSet: game("sourceSourcemodSet"), sourcePlugin: game("sourcePlugin"), sourcePluginRemove: game("sourcePluginRemove"),
    sourcePluginUpload: game("sourcePluginUpload"), sourceAdmin: game("sourceAdmin"),
    // Terraria's
    terrariaVersions: game("terrariaVersions"), terrariaInstall: game("terrariaInstall"), terrariaWorlds: game("terrariaWorlds"), terrariaWorld: game("terrariaWorld"),
    terrariaWorldDelete: game("terrariaWorldDelete"), terrariaWorldInspect: game("terrariaWorldInspect"), terrariaWorldImport: game("terrariaWorldImport"),
    terrariaWorldDiscard: game("terrariaWorldDiscard"), terrariaMods: game("terrariaMods"), terrariaModSearch: game("terrariaModSearch"), terrariaModItems: game("terrariaModItems"),
    terrariaModInstall: game("terrariaModInstall"), terrariaModUpdates: game("terrariaModUpdates"), terrariaModRemove: game("terrariaModRemove"),
    terrariaModUpload: game("terrariaModUpload"), terrariaPlayers: game("terrariaPlayers"), terrariaKick: game("terrariaKick"), terrariaBan: game("terrariaBan"),
    terrariaUnban: game("terrariaUnban"), terrariaMotd: game("terrariaMotd"),
    // Palworld's
    palworldMetrics: game("palworldMetrics"), palworldPlayers: game("palworldPlayers"), palworldKick: game("palworldKick"), palworldBan: game("palworldBan"),
    palworldUnban: game("palworldUnban"),
    // Rust's
    rustMetrics: game("rustMetrics"), rustMap: game("rustMap"), rustMapPicture: game("rustMapPicture"), rustMapDraw: game("rustMapDraw"), rustWipe: game("rustWipe"),
    rustPlayers: game("rustPlayers"), rustKick: game("rustKick"), rustBan: game("rustBan"), rustUnban: game("rustUnban"),
    // Valheim's
    valheimSession: game("valheimSession"), valheimPlayers: game("valheimPlayers"), valheimList: game("valheimList"),
    // Factorio's
    factorioRelease: game("factorioRelease"), factorioInstall: game("factorioInstall"), factorioStatus: game("factorioStatus"),
    factorioWorlds: game("factorioWorlds"), factorioWorld: game("factorioWorld"), factorioWorldDelete: game("factorioWorldDelete"),
    factorioWorldInspect: game("factorioWorldInspect"), factorioWorldImport: game("factorioWorldImport"), factorioWorldDiscard: game("factorioWorldDiscard"),
    factorioPlayers: game("factorioPlayers"), factorioKick: game("factorioKick"), factorioBan: game("factorioBan"), factorioUnban: game("factorioUnban"), factorioList: game("factorioList"),
};
export const gameServerService = definePanelService({
    contract: gameServerContract,
    calls: {
        ...serverCalls,
        ...serversCalls,
    },
    // Home's gallery: each widget's "Server" dropdown offers the servers whose game shows that widget
    widgetChoices: Object.fromEntries(["status", "players", "console", "motd"].map((widgetId) => [widgetId, {
        server: () => saved.servers.filter((server) => {
            const state = entries.get(server.id)!.state;
            return gameFor(server.game).describe({ software: state.serverSoftware, version: state.serverVersion, settings: state.gameSettings }).widgets.includes(widgetId);
        }).map((s) => ({ value: s.id, label: s.name })),
    }])),
    async onInit(ctx) {
        rootContext = ctx;
        // The daemon stops the service with SIGTERM (for an update or a
        // restart). Each server's history is on disk before it ends: a server
        // stopped a moment ago would otherwise be found "running" by the next
        // service, and started again as one that crashed.
        process.once("SIGTERM", () => {
            void Promise.all([...entries.values()].map((server) => server.history!.flush())).then(() => process.kill(process.pid, "SIGTERM"));
        });
        try {
            const gameTypes = await Promise.all(games.map((g) => gameModuleFor(g.id).blockTypes?.() ?? []));
            const onlinePlayers = (id: string) => {
                const server = entries.get(id);
                if (!server) throw new Error(`There is no server "${id}"`);
                return server.state.onlinePlayers;
            };
            const handle = blocksApi.panel(PANEL_ID);
            await handle.register({ categories: BLOCK_CATEGORIES, types: [...sharedTypes(onlinePlayers, () => serversHost.ids()), ...gameTypes.flat(), serverType(serversHost)], ...serversBlocks(serversHost) });
            const original = await config.get(PANEL_ID);
            saved = readServersConfig(original);
            // No file operations or data moves: installed records and all config
            // keys become settings of the migrated server in one atomic write.
            await config.set(saved, PANEL_ID);
            await removeOldHeadStore();
            for (const server of saved.servers.map(createServer)) {
                try {
                    await initialize(server);
                } catch (err) {
                    // quiet: initialize puts its failure on the server's page (initFailure) and in its console
                    console.error(`[gameserver] ${server.name} could not initialize:`, err);
                }
            }
            // the list as Blocks first reads it; changes from here on are announced
            announcedServers = JSON.stringify(saved.servers.map((server) => server.id));
            panelBlocks = handle;
            publish();
            routine.start();
        } catch (err) {
            ctx.setState({ serversError: errorMessage(err) });
            console.error("[gameserver] servers could not be loaded:", err);
        }
    },
    // an update of Game Server, or of a runtime its servers run on (Java),
    // stops each server in its way the way Stop does, saving the world,
    // and starts it again once the update ends
    async beforeUpdate(_ctx, { processes }) {
        for (const server of serversRunning(processes)) {
            if (server.state.serverStatus === "restarting")
                throw new Error(`${server.name} is restarting; update once it's back online`);
            server.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type: "info", content: "[Server] Stopping for an update..." }) }));
            await stopServerInstance(server);
            await waitUntil(async () => !(await server.process.exists(server.game.primaryProcessId)), 90_000, `${server.name} to stop`);
        }
    },
    async afterUpdate(_ctx, { processes, ok, error }) {
        for (const server of serversRunning(processes)) {
            const why = ok
                ? { type: "info" as const, content: "[Server] Updated. Starting again." }
                : { type: "warn" as const, content: `[Server] The update failed, so nothing changed: ${error ?? "no reason given"}. Starting again.` };
            // quiet: startServerInstance puts its own failure in the console
            await startServerInstance(server, [why]).catch((err) =>
                console.error(`[gameserver] ${server.name} could not start again after the update:`, err),
            );
        }
    },
    // a backup of one server at a time: its folder, readied for the copy, and its settings
    beforeBackup: (_ctx, { target }) => backups.beforeBackup(target),
    afterBackup: (_ctx, { target }) => backups.afterBackup(target),
    // a restore stops the server, and starts it again on the restored files and settings if it ran
    beforeRestore: (_ctx, { target }) => backups.beforeRestore(target),
    afterRestore: (_ctx, ended) => backups.afterRestore(ended),
});
export default gameServerService;
