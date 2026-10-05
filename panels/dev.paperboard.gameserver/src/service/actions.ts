import {
    actionsApi,
    defineType,
    defineAction,
    files as fileApi,
    packages as packageApi,
    type ActionDefinition,
    type CustomTypeDefinition,
    type ServiceContext,
} from "@paperboard-dev/paperapi";
import {
    startServerInstance,
    stopServerInstance,
    restartServerInstance,
    sendServerCommand,
    sendChatMessage,
} from "./lifecycle";
import {
    queryOnlinePlayers,
    queryPlayerStats,
    queryPlayerPositions,
    forgetPlayerData,
    deletePlayerData,
    usernameFromUuid,
    playerNameOptions,
} from "./players";
import {
    clearActiveIssue,
    killConflictingProcess,
    resetWorldFiles,
} from "./diagnostics";
import { listInstalledPlugins, deletePlugin, uninstallAllPlugins } from "./plugins";
import {
    listWorldDirs,
    listWorlds,
    setActiveWorld,
    deleteActiveWorldDirs,
} from "./worlds";
import { loadConfigAndProperties, updatePanelConfig } from "./config";
import { listMapRegions, renderMapTile } from "./map";
import type { MapDimension } from "../core/map";
import { listPlayerStats } from "./playerStats";
import { getHeadDataUrl } from "./skins";
import { listLogFiles, readLogFile } from "./logs";
import { queryGamerules, setGamerule } from "./gamerules";
import { applyRuntimeProperties } from "./runtimeProperties";
import {
    toInstallProgress,
    shouldRelayInstallProgress,
    type InstallProgress,
} from "./installProgress";
import { assertPlayerName, assertSingleLine } from "../core/players";
import type { GameServerState } from "./types";
import { ACTION_IDS, TRIGGER_IDS, PANEL_ID } from "./contract";
import { getRequiredJavaVersion, getSoftwareDownload, SOFTWARE_NAMES } from "../lib/software";
import { isSupportedMcVersion, mcAtLeast, MIN_SUPPORTED_MC_VERSION } from "../lib/versionProfile";
import { GAMERULES } from "../generated/gamerules.generated";

export const playerType = defineType({
    id: "player",
    name: "Player",
    description: "Minecraft player username",
    base: "string",
});

export const messageType = defineType({
    id: "message",
    name: "Chat Message",
    description: "In-game chat message object",
    base: "object",
    defaultField: "content",
    toString: (msg: any) => msg?.content || msg?.text || String(msg || ""),
    fields: {
        content: { type: "string", label: "Message" },
        sender: { type: "player", label: "Sender" },
        timestamp: { type: "string", label: "Timestamp" },
    },
});

export const commandType = defineType({
    id: "command",
    name: "Console Command",
    description: "Minecraft console command string",
    base: "string",
});

export const customTypes: CustomTypeDefinition[] = [
    playerType,
    messageType,
    commandType,
];

// World names and version-filtered gamerule names are schema options, not
// free text: any event that can change either list re-registers the two
// actions so the picker's dropdowns never go stale.
// One bounded trailing timer: a burst of joins republishes once, not once
// per log line. The timer lives for the service's lifetime.
let republishTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleRepublishDynamicActions(
    ctx: ServiceContext<GameServerState>,
): void {
    if (republishTimer) return;
    republishTimer = setTimeout(() => {
        republishTimer = null;
        void republishDynamicActions(ctx).catch((err) =>
            console.error("[Gameserver] scheduled republish failed:", err),
        );
    }, 2000);
}

export async function republishDynamicActions(
    ctx: ServiceContext<GameServerState>,
): Promise<void> {
    let worlds: string[] = [];
    try {
        worlds = await listWorldDirs();
    } catch (err) {
        console.error("[Gameserver] world list unreadable for action options:", err);
    }
    let pluginFiles: string[] = [];
    try {
        const { plugins } = await listInstalledPlugins(ctx);
        pluginFiles = plugins.map((plugin) => plugin.filename);
    } catch (err) {
        console.error("[Gameserver] plugin list unreadable for action options:", err);
    }
    const version = ctx.state.serverVersion;
    const ruleNames = GAMERULES.filter(
        (rule) => !rule.addedIn || mcAtLeast(version, rule.addedIn),
    ).map((rule) => rule.name);

    for (const def of [
        setActiveWorldAction(worlds),
        setGameruleAction(ruleNames),
        deleteWorldAction(worlds),
        deletePluginAction(pluginFiles),
        // the join/leave player dropdowns list who the server has seen; the
        // service republishes them when that set changes
        playerJoinedTrigger(playerNameOptions()),
        playerLeftTrigger(playerNameOptions()),
    ]) {
        try {
            await actionsApi.register(bindDynamicAction(def, ctx), undefined, PANEL_ID);
        } catch (err) {
            console.error(
                `[Gameserver] failed to republish action "${def.id}":`,
                err,
            );
        }
    }
}

/**
 * Binds a dynamic definition's run body to the live service context. Event
 * actions have no run body and are registered as-is: stamping a run onto one
 * would declare an event source callable, and the registration validator
 * refuses match rules on a callable action (which is what silently kept the
 * player dropdowns from ever republishing).
 */
export function bindDynamicAction(
    def: ActionDefinition,
    ctx: ServiceContext<GameServerState>,
): ActionDefinition {
    if (!def.run) return def;
    return {
        ...def,
        run: (_c, inputs) => {
            if (!def.run) throw new Error(`Action "${def.id}" has no run body`);
            return def.run(ctx, inputs);
        },
    };
}

// option list for a gamerule's name input: every rule the server's version
// knows, so a flow can never send a rule the server has never heard of
export function gameruleNameOptions(version: string): { label: string; value: string }[] {
    return GAMERULES.filter(
        (rule) => !rule.addedIn || mcAtLeast(version, rule.addedIn),
    ).map((rule) => ({ label: rule.name, value: rule.name }));
}

// Set Active World: the world name is a dropdown over the worlds on disk.
// republishDynamicActions re-registers it whenever that list changes.
export function setActiveWorldAction(worlds: string[]): ActionDefinition {
    return defineAction({
        id: ACTION_IDS.setActiveWorld,
        name: "Set Active World",
        category: "Worlds",
        description: "Makes a world the boot target (offline only, trash-safe)",
        template: "Set active world {levelName}",
        inputs: {
            levelName: {
                type: "string",
                label: "World",
                required: true,
                options: worlds.map((name) => ({ label: name, value: name })),
            },
            seed: { type: "string", label: "Seed (new worlds only)", required: false },
            createOnly: {
                type: "boolean",
                label: "Create only",
                description: "Refuse instead of switching when the world already exists",
                required: false,
            },
        },
        output: { type: "object", label: "Active World" },
        quick: false,
        icon: "public",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { levelName: string; seed?: string; createOnly?: boolean },
        ) => {
            if (!inputs?.levelName) throw new Error("World name is required");
            const result = await setActiveWorld(
                ctx,
                inputs.levelName,
                inputs.seed,
                inputs.createOnly === true,
            );
            await republishDynamicActions(ctx);
            return result;
        },
    });
}

// Set Game Rule: the rule name is a dropdown of the rules this server
// version knows; republished when the installed version changes.
export function setGameruleAction(ruleNames: string[]): ActionDefinition {
    return defineAction({
        id: ACTION_IDS.setGamerule,
        name: "Set Game Rule",
        category: "Game Rules",
        description: "Sets a game rule live, or saves it for the next server start when offline",
        template: "Set game rule {name} to {value}",
        inputs: {
            name: {
                type: "string",
                label: "Rule",
                required: true,
                options: ruleNames.map((name) => ({ label: name, value: name })),
            },
            value: { type: "string", label: "Value", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "list_alt_check",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { name?: string; value?: string },
        ) => {
            if (!inputs?.name || !inputs?.value) {
                throw new Error("Game rule name and value are required");
            }
            return setGamerule(ctx, inputs.name, inputs.value);
        },
    });
}

// Delete World: the world name is a dropdown over the worlds on disk.
// republishDynamicActions re-registers it whenever that list changes; a
// name chosen from a stale list still fails loudly in deleteActiveWorldDirs.
export function deleteWorldAction(worlds: string[]): ActionDefinition {
    return defineAction({
        id: ACTION_IDS.deleteWorld,
        name: "Delete World",
        category: "Worlds",
        description: "Deletes a world's directories (offline only, trash-first, recoverable on crash)",
        template: "Delete world {levelName}",
        inputs: {
            levelName: {
                type: "string",
                label: "World Name",
                required: true,
                options: worlds.map((name) => ({ label: name, value: name })),
            },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "delete",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { levelName: string },
        ) => {
            if (!inputs?.levelName) throw new Error("World name is required");
            await deleteActiveWorldDirs(ctx, inputs.levelName);
            await republishDynamicActions(ctx);
            return true;
        },
    });
}

// Delete Plugin: the filename is a dropdown over the installed jars.
// republishDynamicActions re-registers it whenever that list changes; a
// name chosen from a stale list still fails loudly in deletePlugin.
export function deletePluginAction(filenames: string[]): ActionDefinition {
    return defineAction({
        id: ACTION_IDS.deletePlugin,
        name: "Delete Plugin",
        category: "Plugins",
        description: "Deletes a plugin jar (trash-first, recoverable on crash)",
        template: "Delete plugin {filename}",
        inputs: {
            filename: {
                type: "string",
                label: "Filename",
                required: true,
                options: filenames.map((name) => ({ label: name, value: name })),
            },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "delete",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { filename: string },
        ) => {
            if (!inputs?.filename) throw new Error("Filename is required");
            await deletePlugin(ctx, inputs.filename);
            await republishDynamicActions(ctx);
            return true;
        },
    });
}

export const panelActions: ActionDefinition[] = [
    defineAction({
        id: ACTION_IDS.runCommand,
        name: "Run Command",
        category: "Server",
        description: "Executes a raw console command on the server instance",
        template: "Execute command {command}",
        inputs: {
            command: {
                type: "string",
                label: "Command",
                placeholder: "Command",
                required: true,
            },
        },
        output: {
            type: "string",
            label: "Command Result",
        },
        quick: false,
        icon: "terminal",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { command: string } | string,
        ) => {
            const cmd = typeof inputs === "string" ? inputs : inputs?.command || "";
            await sendServerCommand(ctx, cmd);
            return `Executed: ${cmd}`;
        },
    }),

    defineAction({
        id: ACTION_IDS.startServer,
        name: "Start the server",
        category: "Server",
        description: "Launches the game server process",
        template: "Start the server",
        writtenOut: "Start the server",
        output: {
            type: "boolean",
            label: "Started",
        },
        quick: true,
        icon: "power",
        run: async (ctx: ServiceContext<GameServerState>) => {
            await startServerInstance(ctx);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.stopServer,
        name: "Stop the server",
        category: "Server",
        description: "Gracefully stops the game server",
        template: "Stop the server",
        writtenOut: "Stop the server",
        output: {
            type: "boolean",
            label: "Stopped",
        },
        quick: true,
        icon: "stop",
        run: async (ctx: ServiceContext<GameServerState>) => {
            await stopServerInstance(ctx);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.restartServer,
        name: "Restart the server",
        category: "Server",
        description: "Restarts the running server",
        template: "Restart the server",
        writtenOut: "Restart the server",
        output: {
            type: "boolean",
            label: "Restarted",
        },
        quick: true,
        icon: "restart_alt",
        run: async (ctx: ServiceContext<GameServerState>) => {
            await restartServerInstance(ctx);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.loadConfig,
        name: "Reload Configuration",
        category: "Server",
        description: "Reloads server properties and panel config",
        internal: true,
        template: "Reload server configuration",
        writtenOut: "Reload server configuration",
        output: { type: "boolean", label: "Success" },
        run: async (ctx) => {
            await loadConfigAndProperties(ctx);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.sayChat,
        name: "Send Chat Message",
        category: "Server",
        description: "Broadcasts a chat message to all players in game",
        template: "Say {message}",
        inputs: {
            message: {
                type: "string",
                label: "Message",
                placeholder: "Message",
                required: true,
            },
        },
        output: {
            type: "string",
            label: "Sent Message",
        },
        quick: false,
        icon: "chat",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { message: string },
        ) => {
            // single-line: a line break would inject a second console command
            const msg = assertSingleLine((inputs?.message || "").trim(), "chat message", 500);
            if (!msg) throw new Error("Message is required");
            await sendChatMessage(ctx, msg);
            return msg;
        },
    }),

    defineAction({
        id: ACTION_IDS.kickPlayer,
        name: "Kick Player",
        category: "Players",
        description: "Kicks a player from the server with an optional reason",
        template: "Kick {player}",
        inputs: {
            player: {
                type: "string",
                label: "Player",
                placeholder: "Player",
                required: true,
            },
            reason: {
                type: "string",
                label: "Reason",
                placeholder: "Reason",
            },
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        quick: false,
        icon: "person_remove",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { player: string; reason?: string },
        ) => {
            const name = assertPlayerName(inputs?.player);
            const reason = inputs?.reason
                ? assertSingleLine(inputs.reason.trim(), "kick reason")
                : "";
            await sendServerCommand(ctx, reason ? `kick ${name} ${reason}` : `kick ${name}`);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.banPlayer,
        name: "Ban Player",
        category: "Players",
        description: "Bans a player from the server with an optional reason",
        template: "Ban {player}",
        inputs: {
            player: {
                type: "string",
                label: "Player",
                placeholder: "Player",
                required: true,
            },
            reason: {
                type: "string",
                label: "Reason",
                placeholder: "Reason",
            },
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        quick: false,
        icon: "gavel",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { player: string; reason?: string },
        ) => {
            const name = assertPlayerName(inputs?.player);
            const reason = inputs?.reason
                ? assertSingleLine(inputs.reason.trim(), "ban reason")
                : "";
            await sendServerCommand(ctx, reason ? `ban ${name} ${reason}` : `ban ${name}`);
            return true;
        },
    }),

    // player-flag actions: every one validates at this boundary — the UI
    // may never compose console commands from raw player names. Validated
    // kick/ban above set the pattern; op/deop/whitelist/pardon/kill follow it.
    defineAction({
        id: ACTION_IDS.opPlayer,
        name: "Op Player",
        category: "Players",
        description: "Grants operator status to a player",
        template: "Op {player}",
        inputs: {
            player: { type: "string", label: "Player", placeholder: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "shield",
        run: async (ctx: ServiceContext<GameServerState>, inputs: { player: string }) => {
            const name = assertPlayerName(inputs?.player);
            await sendServerCommand(ctx, `op ${name}`);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.deopPlayer,
        name: "Deop Player",
        category: "Players",
        description: "Revokes operator status from a player",
        template: "Deop {player}",
        inputs: {
            player: { type: "string", label: "Player", placeholder: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "shield_person",
        run: async (ctx: ServiceContext<GameServerState>, inputs: { player: string }) => {
            const name = assertPlayerName(inputs?.player);
            await sendServerCommand(ctx, `deop ${name}`);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.whitelistPlayer,
        name: "Whitelist Player",
        category: "Players",
        description: "Adds a player to the server whitelist",
        template: "Whitelist {player}",
        inputs: {
            player: { type: "string", label: "Player", placeholder: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "verified_user",
        run: async (ctx: ServiceContext<GameServerState>, inputs: { player: string }) => {
            const name = assertPlayerName(inputs?.player);
            await sendServerCommand(ctx, `whitelist add ${name}`);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.unwhitelistPlayer,
        name: "Unwhitelist Player",
        category: "Players",
        description: "Removes a player from the server whitelist",
        template: "Unwhitelist {player}",
        inputs: {
            player: { type: "string", label: "Player", placeholder: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "person_off",
        run: async (ctx: ServiceContext<GameServerState>, inputs: { player: string }) => {
            const name = assertPlayerName(inputs?.player);
            await sendServerCommand(ctx, `whitelist remove ${name}`);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.pardonPlayer,
        name: "Pardon Player",
        category: "Players",
        description: "Removes a player from the ban list",
        template: "Pardon {player}",
        inputs: {
            player: { type: "string", label: "Player", placeholder: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "undo",
        run: async (ctx: ServiceContext<GameServerState>, inputs: { player: string }) => {
            const name = assertPlayerName(inputs?.player);
            await sendServerCommand(ctx, `pardon ${name}`);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.killPlayer,
        name: "Kill Player",
        category: "Players",
        description: "Kills an online player in-game",
        template: "Kill {player}",
        inputs: {
            player: { type: "string", label: "Player", placeholder: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "heart_broken",
        run: async (ctx: ServiceContext<GameServerState>, inputs: { player: string }) => {
            const name = assertPlayerName(inputs?.player);
            await sendServerCommand(ctx, `kill ${name}`);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.listPlayers,
        name: "List Online Players",
        category: "Players",
        description: "Returns the usernames of currently online players",
        template: "List online players",
        writtenOut: "List online players",
        inputs: {},
        output: {
            type: "string",
            label: "Player List",
        },
        quick: false,
        icon: "group",
        run: async (ctx: ServiceContext<GameServerState>) => {
            queryOnlinePlayers(ctx);
            return (ctx.state.onlinePlayers || []).join(", ");
        },
    }),

    defineAction({
        id: ACTION_IDS.playerCount,
        name: "Player Count",
        category: "Players",
        description: "Returns the number of currently online players",
        template: "Count online players",
        writtenOut: "Count online players",
        inputs: {},
        output: {
            type: "number",
            label: "Player Count",
        },
        quick: false,
        icon: "tag",
        run: async (ctx: ServiceContext<GameServerState>) => {
            return (ctx.state.onlinePlayers || []).length;
        },
    }),

    // service-boundary actions: the panel UI calls every one of these
    // through serverBridge.call(ACTION_IDS.*). They are registered here —
    // never reached through the stringly actions.* proxy — so a missing
    // registration is a contract-test failure, not a silent no-op.

    defineAction({
        id: ACTION_IDS.killConflictingProcess,
        name: "Kill Conflicting Process",
        category: "Server",
        description: "Kills the process bound to the server port",
        internal: true,
        template: "Kill conflicting process on {port}",
        inputs: {
            port: { type: "string", label: "Port", placeholder: "Port" },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "skull",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { port?: string },
        ) => {
            // the boolean is the real outcome: a failed kill is a false,
            // never a laundered true
            return killConflictingProcess(ctx, inputs?.port);
        },
    }),

    defineAction({
        id: ACTION_IDS.resetWorldFiles,
        name: "Reset World Files",
        category: "Worlds",
        description: "Deletes the live world directories (trash-first, recoverable on crash)",
        template: "Reset world files",
        writtenOut: "Reset world files",
        inputs: {},
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "restart_alt",
        run: async (ctx: ServiceContext<GameServerState>) => {
            const result = await resetWorldFiles(ctx);
            await republishDynamicActions(ctx);
            return result;
        },
    }),

    defineAction({
        id: ACTION_IDS.clearActiveIssue,
        name: "Clear Active Issue",
        category: "Server",
        description: "Dismisses the currently detected server issue",
        internal: true,
        template: "Clear active issue",
        inputs: {},
        output: { type: "boolean", label: "Success" },
        quick: true,
        icon: "check",
        run: async (ctx: ServiceContext<GameServerState>) => {
            clearActiveIssue(ctx);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.updatePanelConfig,
        name: "Update Panel Config",
        category: "Server",
        description: "Merges a patch into the panel config and reloads",
        internal: true,
        template: "Update panel config",
        inputs: {
            patch: { type: "object", label: "Patch" },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "settings",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { patch?: Record<string, unknown> },
        ) => {
            await updatePanelConfig(ctx, inputs?.patch ?? {});
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.listWorldDirs,
        name: "List World Directories",
        category: "Worlds",
        description: "Lists world directories on disk",
        template: "List world directories",
        inputs: {},
        output: { type: "object", label: "Worlds" },
        quick: false,
        icon: "folder",
        run: async () => {
            return listWorldDirs();
        },
    }),

    defineAction({
        id: ACTION_IDS.listWorlds,
        name: "List Worlds",
        category: "Worlds",
        description: "Lists on-disk worlds with active flag and generated dimensions",
        template: "List worlds",
        inputs: {},
        output: { type: "object", label: "Worlds" },
        quick: false,
        icon: "public",
        run: async () => {
            return listWorlds();
        },
    }),

    defineAction({
        id: ACTION_IDS.installServerVersion,
        name: "Install Server Version",
        category: "Server",
        description: "Downloads and replaces server.jar for a software/version (offline only)",
        template: "Install server {software} {version}",
        inputs: {
            software: {
                type: "string",
                label: "Software",
                required: true,
                options: (["vanilla", "paper", "fabric"] as const).map((value) => ({
                    label: SOFTWARE_NAMES[value],
                    value,
                })),
            },
            version: { type: "string", label: "Version", required: true },
        },
        output: { type: "object", label: "Installed" },
        quick: false,
        icon: "deployed_code",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { software: string; version: string },
        ) => {
            const software = String(inputs?.software ?? "");
            if (software !== "vanilla" && software !== "paper" && software !== "fabric") {
                throw new Error(`Unknown server software: ${JSON.stringify(inputs?.software)}`);
            }
            const version = assertSingleLine(inputs?.version, "version", 64);
            if (!isSupportedMcVersion(version)) {
                throw new Error(
                    `Minecraft ${version} is below Paperboard's minimum supported version (${MIN_SUPPORTED_MC_VERSION}).`,
                );
            }
            // the owner enforces offline, not just the button
            if (ctx.state.serverStatus !== "offline") {
                throw new Error("Stop the server before switching versions");
            }
            const javaPkg = getRequiredJavaVersion(version);
            if (!javaPkg) {
                throw new Error(`Could not determine the Java runtime for ${version}`);
            }
            if (!(await packageApi.isInstalled(javaPkg))) {
                await packageApi.download(javaPkg);
            }
            // throws when the upstream record has no checksum (never undefined)
            const download = await getSoftwareDownload(software, version);
            // the Versions modal reads the jar row through service state:
            // bridge calls are request/response, so without this relay the
            // row would sit static until the call resolves
            ctx.setState({ installProgress: null });
            let lastProgress: InstallProgress | null = null;
            await fileApi.download({
                url: download.url,
                targetPath: "server.jar",
                appId: PANEL_ID,
                sha1: download.sha1,
                sha256: download.sha256,
                onProgress: (payload) => {
                    const next = toInstallProgress(payload);
                    if (!next) return;
                    if (!shouldRelayInstallProgress(lastProgress, next)) return;
                    lastProgress = next;
                    ctx.setState({ installProgress: next });
                },
            });
            await updatePanelConfig(ctx, { software, version });
            // the version decides which gamerules exist: refresh the rule
            // dropdown so the flow builder can't offer a rule this jar lacks
            await republishDynamicActions(ctx);
            return { software, version };
        },
    }),

    defineAction({
        id: ACTION_IDS.listMapRegions,
        name: "List Map Regions",
        category: "Worlds",
        description: "Lists generated overworld region files for the active world",
        template: "List map regions",
        inputs: {},
        output: { type: "object", label: "Map Regions" },
        quick: false,
        icon: "map",
        run: async (ctx: ServiceContext<GameServerState>) => {
            return listMapRegions(ctx);
        },
    }),

    defineAction({
        id: ACTION_IDS.renderMapTile,
        name: "Render Map Tile",
        category: "Worlds",
        // internal: the Map tab calls this directly; flows should never see
        // it as a block. Callable, never offered.
        internal: true,
        description: "Renders one 512x512 top-down map tile for a dimension and region coordinate",
        template: "Render map tile {dimension} {rx} {rz}",
        inputs: {
            dimension: { type: "string", label: "Dimension", required: true },
            rx: { type: "number", label: "Region X", required: true },
            rz: { type: "number", label: "Region Z", required: true },
        },
        output: { type: "object", label: "Tile" },
        quick: false,
        icon: "map",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { dimension: string; rx: number; rz: number },
        ) => {
            return renderMapTile(
                ctx,
                inputs?.dimension as MapDimension,
                Number(inputs?.rx),
                Number(inputs?.rz),
            );
        },
    }),

    defineAction({
        id: ACTION_IDS.listInstalledPlugins,
        name: "List Installed Plugins",
        category: "Plugins",
        description: "Lists installed server plugins",
        template: "List installed plugins",
        inputs: {},
        output: { type: "object", label: "Plugins" },
        quick: false,
        icon: "extension",
        run: async (ctx: ServiceContext<GameServerState>) => {
            return listInstalledPlugins(ctx);
        },
    }),

    defineAction({
        id: ACTION_IDS.uninstallAllPlugins,
        name: "Uninstall All Plugins",
        category: "Plugins",
        description: "Trash-first removes every jar in plugins/ and mods/",
        template: "Uninstall all plugins",
        inputs: {},
        output: { type: "number", label: "Removed" },
        quick: false,
        icon: "delete_sweep",
        run: async (ctx: ServiceContext<GameServerState>) => {
            return uninstallAllPlugins(ctx);
        },
    }),

    defineAction({
        id: ACTION_IDS.deletePlayerData,
        name: "Delete Player Data",
        category: "Players",
        description: "Deletes a player's data files (trash-first, recoverable on crash)",
        template: "Delete data for {player}",
        inputs: {
            player: { type: "string", label: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "person_remove",
        run: async (
            ctx: ServiceContext<GameServerState>,
            // uuid stays an optional input for the panel's own player
            // list; flow authors only ever name a player
            inputs: { player: string; uuid?: string },
        ) => {
            await deletePlayerData(ctx, inputs?.player, inputs?.uuid);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.getUsernameFromUuid,
        name: "Get Username from UUID",
        category: "Players",
        description: "Resolves a player's username from a UUID via the server's player files",
        template: "Get username for {uuid}",
        inputs: {
            uuid: { type: "string", label: "UUID", required: true },
        },
        output: { type: "string", label: "Username" },
        quick: false,
        icon: "badge",
        run: async (
            _ctx: ServiceContext<GameServerState>,
            inputs: { uuid?: string },
        ) => {
            if (!inputs?.uuid) throw new Error("UUID is required");
            const name = await usernameFromUuid(inputs.uuid);
            if (!name) {
                throw new Error(`No username on file for UUID ${inputs.uuid}`);
            }
            return name;
        },
    }),

    defineAction({
        // decorative lookup the Players/Map/Chat UI calls directly; not a
        // flow block, so it stays out of the Actions library
        id: ACTION_IDS.getPlayerSkin,
        name: "Get Player Skin",
        category: "Players",
        description: "Builds a layered player head from Mojang's skin service",
        template: "Get skin for {player}",
        internal: true,
        inputs: {
            player: { type: "string", label: "Player", optional: true },
            uuid: { type: "string", label: "UUID", optional: true },
            size: { type: "number", label: "Size", optional: true },
        },
        output: { type: "string", label: "Head image" },
        quick: false,
        icon: "person",
        run: async (
            _ctx: ServiceContext<GameServerState>,
            inputs: { player?: string; uuid?: string; size?: number },
        ) => {
            return getHeadDataUrl({
                name: inputs?.player,
                uuid: inputs?.uuid,
                size: inputs?.size,
            });
        },
    }),

    defineAction({
        id: ACTION_IDS.forgetPlayerData,
        name: "Forget Player",
        category: "Players",
        description: "Drops a player from the panel's tracked presence",
        template: "Forget player {player}",
        inputs: {
            player: { type: "string", label: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "person_off",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { player: string },
        ) => {
            forgetPlayerData(ctx, inputs?.player);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.queryPlayerStats,
        name: "Query Player Stats",
        category: "Players",
        description: "Queries a player's live stats from the server",
        template: "Query stats for {player}",
        inputs: {
            player: { type: "string", label: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "query_stats",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { player: string },
        ) => {
            queryPlayerStats(ctx, inputs?.player);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.queryOnlinePlayers,
        name: "Query Online Players",
        category: "Players",
        description: "Refreshes the online player list from the server",
        template: "Query online players",
        inputs: {},
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "group",
        run: async (ctx: ServiceContext<GameServerState>) => {
            queryOnlinePlayers(ctx);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.queryPlayerPositions,
        name: "Query Player Positions",
        category: "Players",
        description: "Reads online players' coordinates and dimension for the map",
        template: "Query player positions",
        inputs: {},
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "map",
        run: async (ctx: ServiceContext<GameServerState>) => {
            queryPlayerPositions(ctx);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.listPlayerStats,
        name: "List Player Statistics",
        category: "Players",
        description: "Reads every player's offline statistics from the world's stats files",
        template: "List player statistics",
        inputs: {},
        output: { type: "object", label: "Player Statistics" },
        quick: false,
        icon: "leaderboard",
        run: async (ctx: ServiceContext<GameServerState>) => {
            return listPlayerStats(ctx);
        },
    }),

    defineAction({
        id: ACTION_IDS.listLogFiles,
        name: "List Log Files",
        category: "Logs",
        description: "Lists the server's log files, newest first",
        template: "List log files",
        inputs: {},
        output: { type: "object", label: "Log Files" },
        quick: false,
        icon: "description",
        run: async (ctx: ServiceContext<GameServerState>) => {
            return listLogFiles(ctx);
        },
    }),

    defineAction({
        id: ACTION_IDS.readLogFile,
        name: "Read Log File",
        category: "Logs",
        description: "Reads a server log file (tail for plain logs, full for archives)",
        template: "Read log file {name}",
        inputs: {
            name: { type: "string", label: "File Name", required: true },
        },
        output: { type: "object", label: "Log" },
        quick: false,
        icon: "description",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { name: string },
        ) => {
            if (!inputs?.name) throw new Error("Log file name is required");
            return readLogFile(ctx, inputs.name);
        },
    }),

    // game rules: the service owns the console and the config, so the UI
    // never writes gamerule commands itself — offline edits persist and
    // re-apply at next boot instead of looking applied and vanishing
    defineAction({
        id: ACTION_IDS.queryGamerules,
        name: "List Game Rules",
        category: "Game Rules",
        description: "Reads the current game rule values from the running server",
        template: "List game rules",
        inputs: {},
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "list_alt_check",
        run: async (ctx: ServiceContext<GameServerState>) => {
            const names = gameruleNameOptions(ctx.state.serverVersion).map(
                (option) => option.value,
            );
            return queryGamerules(ctx, names);
        },
    }),

    defineAction({
        id: ACTION_IDS.applyRuntimeProperties,
        name: "Apply Runtime Properties",
        category: "Server",
        description: "Applies runtime server.properties values (difficulty, gamemode) to the running server, or queues them for the next start",
        internal: true,
        template: "Apply runtime server properties",
        inputs: {
            values: { type: "object", label: "Values" },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "tune",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { values?: Record<string, string> },
        ) => {
            applyRuntimeProperties(
                ctx,
                inputs?.values && typeof inputs.values === "object" ? inputs.values : {},
            );
            return true;
        },
    }),
];

// The player filter is a dropdown of who this server has seen, plus (any);
// republishDynamicActions re-registers these two when that list changes. The
// event payload is the username itself, so the match reads the payload root.
function playerFilterInput(playerNames: string[]) {
    return {
        type: "player",
        label: "Player",
        allowEmpty: true,
        emptyLabel: "(any)",
        options: playerNames.map((name) => ({ label: name, value: name })),
    };
}

export function playerJoinedTrigger(playerNames: string[]): ActionDefinition {
    return defineAction({
        id: TRIGGER_IDS.playerJoined,
        name: "When Player Joins",
        category: "Events",
        description:
            "Fires when a player connects and joins the game world; leave Player as (any) to fire for every join",
        template: "When player {player} joins the server",
        writtenOut: "When player {player} joins the server",
        inputs: { player: playerFilterInput(playerNames) },
        match: { field: "$", input: "player" },
        output: {
            type: "player",
            label: "Username",
            description: "Username of the connected player",
        },
        icon: "person_add",
    });
}

export function playerLeftTrigger(playerNames: string[]): ActionDefinition {
    return defineAction({
        id: TRIGGER_IDS.playerLeft,
        name: "When Player Leaves",
        category: "Events",
        description:
            "Fires when a player disconnects from the server; leave Player as (any) to fire for every leave",
        template: "When player {player} leaves the server",
        writtenOut: "When player {player} leaves the server",
        inputs: { player: playerFilterInput(playerNames) },
        match: { field: "$", input: "player" },
        output: {
            type: "player",
            label: "Username",
            description: "Username of the disconnected player",
        },
        icon: "logout",
    });
}

// event actions fire as events and start flows; they are not callable
export const panelEventActions: ActionDefinition[] = [
    defineAction({
        id: TRIGGER_IDS.chatMessage,
        name: "When Chat Message Sent",
        category: "Events",
        description:
            "Fires when a player sends a chat message; leave Message as (any) to fire for every message",
        template: "When chat message {message} is sent",
        writtenOut: "When chat message {message} is sent",
        inputs: {
            message: {
                type: "string",
                label: "Message",
                allowEmpty: true,
                emptyLabel: "(any)",
                placeholder: "(any)",
            },
        },
        // the trigger payload is the chat object; filter on what the player said
        match: { field: "content", input: "message" },
        output: {
            type: "message",
            label: "message",
            description: "The received chat message object",
        },
        icon: "chat",
    }),

    playerJoinedTrigger([]),

    playerLeftTrigger([]),

    defineAction({
        id: TRIGGER_IDS.serverStarted,
        name: "When Server Starts",
        category: "Events",
        description: "Fires when the server successfully finishes booting",
        template: "When the server starts",
        writtenOut: "When the server starts",
        output: {
            type: "boolean",
            label: "Is Online",
        },
        icon: "play_arrow",
    }),

    defineAction({
        id: TRIGGER_IDS.serverStopped,
        name: "When Server Stops",
        category: "Events",
        description: "Fires when the server process shuts down or stops",
        template: "When the server stops",
        writtenOut: "When the server stops",
        output: {
            type: "boolean",
            label: "Is Offline",
        },
        icon: "stop",
    }),
];
