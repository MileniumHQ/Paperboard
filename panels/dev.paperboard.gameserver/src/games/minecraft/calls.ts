import type { Server } from "../../service/server";
import { minecraftSoftware } from "./index";
import { sharedCalls, type ServerCalls } from "../../service/calls";
import type { GameContractCalls } from "../serviceTypes";
import { files as fileApi, errorMessage } from "../../service/api";
import { sendServerCommand } from "../../service/lifecycle";
import { waitForLine } from "./saving";
import {
    queryOnlinePlayers,
    queryPlayerStats,
    queryPlayerPositions,
    forgetPlayerData,
    deletePlayerData,
    usernameFromUuid,
} from "../../service/players";
import {
    clearActiveIssue,
    killConflictingProcess,
    resetWorldFiles,
} from "../../service/diagnostics";
import { listInstalledPlugins, deletePlugin, recordPluginInstalls, uninstallAllPlugins, previewPluginInstall, installPluginVersion, pluginTarget, livePluginInstallDeps } from "../../service/plugins";
import {
    listWorldDirs,
    listWorlds,
    setActiveWorld,
    deleteActiveWorldDirs,
    type SetActiveWorldResult,
} from "../../service/worlds";
import { updatePanelConfig } from "./config";
import { listMapRegions, renderMapTile } from "../../service/map";
import { discardWorldTransfer, exportWorld, importWorld } from "../../service/worldTransfer";
import type { MapDimension } from "../../core/map";
import { listPlayerStats } from "../../service/playerStats";
import { currentPlayerNames, isBanned, listRoster, setPlayerFlag, type PlayerFlag } from "../../service/playerLists";
import { getHeadDataUrl } from "../../service/skins";
import { queryGamerules, setGamerule } from "../../service/gamerules";
import { readGameOptions, writeGameOptions } from "./gameOptions";
import { installServerSoftware, isInstallRunning, withInstallLock } from "./softwareInstall";
import { settleInterruptedWork } from "../../service/recovery";
import { readLoaderSettings, writeLoaderSetting } from "../../service/loaderSettings";
import { locateAddonConfig } from "../../service/addonConfig";
import { findCrossplayJars, prepareCrossplay, readBedrockNaming, readCrossplay, settleBedrockTransport, writeCrossplaySetting } from "../../service/crossplay";
import { claimBedrockPorts } from "../../service/ports";
import { livePortDeps } from "../../service/portDeps";
import { readServerIcon, removeServerIcon, setServerIcon } from "../../service/serverIcon";
import { liveInstallDeps } from "../../service/softwareInstallDeps";
import { installDatapack, listDatapacks, listDatapackVersions, removeDatapack } from "../../service/datapacks";
import { liveDatapackDeps } from "../../service/datapackDeps";
import {
    listResourcePackVersions,
    readResourcePack,
    removeResourcePack,
    selectCustomResourcePack,
    selectModrinthResourcePack,
} from "../../service/resourcepack";
import { liveResourcePackDeps } from "../../service/resourcepackDeps";
import { installModpack, listModpackVersions, readModpack, removeModpack } from "../../service/modpacks";
import { discardUpload, uploadDatapacks, uploadModpack, uploadPlugins } from "../../service/addonUploads";
import { liveUploadDeps } from "../../service/addonUploadDeps";
import { liveModpackDeps } from "../../service/modpackDeps";
import { assertPlayerName, assertSingleLine } from "../../core/players";
import type { GameServerState } from "../../service/types";
import { PANEL_ID } from "../../service/contract";
import { isServerSoftware } from "../../software/catalog";
import { INSTALL_OWNED_CONFIG_KEYS } from "../../software/installRecord";
import { providerFor } from "./providers";
import { isSupportedMcVersion, MIN_SUPPORTED_MC_VERSION, versionSupports } from "../../lib/versionProfile";
import { gamerulesFor } from "../../core/gamerules";

const loaderDeps = { serverDir: () => fileApi.getPath("", PANEL_ID) };

// how Floodgate names Bedrock players here; null when it is not installed
const bedrockNaming = (ctx: Server) =>
    readBedrockNaming(minecraftSoftware(ctx.state.serverSoftware), loaderDeps);

// What the calls and the blocks of a Minecraft server both run.

// The server writes banned-players.json as it takes a ban or a pardon, then
// says so: "Banned Steve: reason" and "Unbanned Steve" (1.12 adds "player").
// A refusal is a line of its own, which the call fails with. A plugin may
// say it in words of its own, so the list it wrote is the record: watched
// while the line is awaited, and read once more when none came.
const BAN_ANSWER_MS = 15_000;
const BAN_LIST_POLL_MS = 250;
const BAN_REFUSED = /Nothing changed|That player does not exist|Unknown player|No player was found|Could not (un)?ban/i;

async function banCommand(ctx: Server, verb: "ban" | "pardon", name: string, command: string): Promise<void> {
    const done = new RegExp(`\\b${verb === "ban" ? "Banned" : "Unbanned"} (player )?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const recorded = async () => (await isBanned(name)) === (verb === "ban");
    // a list that already shows it can only be refused, and the refusal says why
    const watchList = !(await recorded());
    const answer = waitForLine((line) => done.test(line) || BAN_REFUSED.test(line), BAN_ANSWER_MS, verb === "ban" ? `the ban of ${name}` : `the pardon of ${name}`);
    try {
        await sendServerCommand(ctx, command);
    } catch (err) {
        answer.cancel();
        throw err;
    }
    let answered = false;
    const said = answer.done.finally(() => (answered = true));
    while (watchList && !answered) {
        if (await recorded()) {
            answer.cancel();
            return;
        }
        // quiet: said's failure is read below, where it is awaited
        await Promise.race([said.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, BAN_LIST_POLL_MS))]);
    }
    let line: string;
    try {
        line = await said;
    } catch (err) {
        if (await recorded()) return;
        throw new Error(`${errorMessage(err)}, and the ban list ${verb === "ban" ? "does not have" : "still has"} ${name}`);
    }
    if (!done.test(line)) throw new Error(`The server refused: ${line.replace(/^\[[^\]]*\]\s*(\[[^\]]*\]:?\s*)?/, "")}`);
}

/** Kicks or bans a player, with the reason they see when one is given; a ban resolves once the server has recorded it. */
export async function punishPlayer(ctx: Server, verb: "kick" | "ban", player: unknown, reason?: unknown): Promise<void> {
    const name = assertPlayerName(player);
    const why = reason ? assertSingleLine(String(reason).trim(), `${verb} reason`) : "";
    const command = why ? `${verb} ${name} ${why}` : `${verb} ${name}`;
    if (verb === "ban") await banCommand(ctx, "ban", name, command);
    else await sendServerCommand(ctx, command);
}

/** Pardons or kills a player; a pardon resolves once the server has recorded it. */
export async function playerCommand(ctx: Server, verb: "pardon" | "kill", player: unknown): Promise<void> {
    const name = assertPlayerName(player);
    if (verb === "pardon") await banCommand(ctx, "pardon", name, `pardon ${name}`);
    else await sendServerCommand(ctx, `kill ${name}`);
}

/** Makes a player an operator or whitelisted, or takes it back; edits the lists' files while offline. */
export async function flagPlayer(ctx: Server, flag: PlayerFlag, player: unknown, on: boolean, uuid?: string): Promise<void> {
    await setPlayerFlag(ctx, (cmd) => sendServerCommand(ctx, cmd), await bedrockNaming(ctx), flag, player, on, uuid);
}

/** Makes a world the one the server starts with; a new name is made on the next start. */
export async function activateWorld(ctx: Server, levelName: unknown, seed?: string, createOnly = false): Promise<SetActiveWorldResult> {
    if (!levelName || typeof levelName !== "string") throw new Error("World name is required");
    const result = await setActiveWorld(ctx, levelName, seed, createOnly);
    return result;
}

/** Moves a world's folders to the trash. */
export async function removeWorld(ctx: Server, levelName: unknown): Promise<void> {
    if (!levelName || typeof levelName !== "string") throw new Error("World name is required");
    await deleteActiveWorldDirs(ctx, levelName);
}

/** Moves one plugin's jar to the trash. */
export async function removePlugin(ctx: Server, filename: unknown): Promise<void> {
    if (!filename || typeof filename !== "string") throw new Error("Filename is required");
    await deletePlugin(ctx, filename);
}

/** Installs a server software for a Minecraft version over the stopped server. */
export async function installVersion(ctx: Server, rawSoftware: unknown, rawVersion: unknown) {
    if (!isServerSoftware(rawSoftware)) {
        throw new Error(`Unknown server software: ${JSON.stringify(rawSoftware)}`);
    }
    const version = assertSingleLine(rawVersion, "version", 64);
    if (!isSupportedMcVersion(version)) {
        throw new Error(
            `Minecraft ${version} is below Paperboard's minimum supported version (${MIN_SUPPORTED_MC_VERSION}).`,
        );
    }
    // the owner enforces offline, not just the button
    if (ctx.state.serverStatus !== "offline") {
        throw new Error("Stop the server before switching versions");
    }
    const outcome = await installServerSoftware(ctx, rawSoftware, version, liveInstallDeps(ctx));
    return outcome;
}

/** The name the server's player files give a UUID. */
export async function playerForUuid(uuid: unknown): Promise<string> {
    if (!uuid || typeof uuid !== "string") throw new Error("UUID is required");
    const name = await usernameFromUuid(uuid);
    if (!name) throw new Error(`No username on file for UUID ${uuid}`);
    return name;
}

// option list for a gamerule's name input: every rule the server's version
// knows, so a block can never send a rule the server has never heard of
export function gameruleNameOptions(version: string): { label: string; value: string }[] {
    return gamerulesFor(version).map((rule) => ({ label: rule.name, value: rule.name }));
}

/** A Minecraft server's modpack: what the page's Modpacks tab asks, through the panel's contract. */
export const modpackCalls: Pick<GameContractCalls, "readModpack" | "listModpackVersions" | "installModpack" | "removeModpack"> = {
    readModpack: async (_input, ctx) => ({ modpack: await readModpack(liveModpackDeps(ctx)) }),
    listModpackVersions: ({ projectId }, ctx) => listModpackVersions(projectId, minecraftSoftware(ctx.state.serverSoftware), liveModpackDeps(ctx)),
    installModpack: async ({ projectId, versionId }, ctx) => {
        // checked and claimed with no await between: a start cannot slip in
        if (ctx.state.serverStatus !== "offline") {
            throw new Error("Stop the server before installing a modpack");
        }
        return withInstallLock(() => installModpack({ projectId, versionId }, minecraftSoftware(ctx.state.serverSoftware), liveModpackDeps(ctx)));
    },
    removeModpack: async (_input, ctx) => {
        if (ctx.state.serverStatus !== "offline") {
            throw new Error("Stop the server before removing the modpack");
        }
        return withInstallLock(() => removeModpack(liveModpackDeps(ctx)));
    },
};

export const minecraftCalls: ServerCalls = {
    ...sharedCalls,
    setActiveWorld: (ctx: Server, inputs: { levelName: string; seed?: string; createOnly?: boolean }) =>
        activateWorld(ctx, inputs?.levelName, inputs?.seed, inputs?.createOnly === true),
    setGamerule: (ctx: Server, inputs: { name?: string; value?: string }) => {
        if (!inputs?.name || !inputs?.value) throw new Error("Game rule name and value are required");
        return setGamerule(ctx, inputs.name, inputs.value);
    },
    deleteWorld: async (ctx: Server, inputs: { levelName: string }) => {
        await removeWorld(ctx, inputs?.levelName);
        return true;
    },
    deletePlugin: async (ctx: Server, inputs: { filename: string }) => {
        await removePlugin(ctx, inputs?.filename);
        return true;
    },
    kickPlayer: async (
        ctx: Server,
        inputs: { player: string; reason?: string },
    ) => {
        await punishPlayer(ctx, "kick", inputs?.player, inputs?.reason);
        return true;
    },
    banPlayer: async (
        ctx: Server,
        inputs: { player: string; reason?: string },
    ) => {
        await punishPlayer(ctx, "ban", inputs?.player, inputs?.reason);
        return true;
    },
    // player-flag calls: every one validates at this boundary — the UI
    // may never compose console commands from raw player names. Validated
    // kick/ban above set the pattern; op/deop/whitelist/pardon/kill follow it.
    // Op and whitelist also work while the server is stopped: setPlayerFlag
    // edits ops.json / whitelist.json then.
    opPlayer: async (ctx: Server, inputs: { player: string; uuid?: string }) => {
        // uuid is an optional input for the panel's own roster
        await flagPlayer(ctx, "op", inputs?.player, true, inputs?.uuid);
        return true;
    },
    deopPlayer: async (ctx: Server, inputs: { player: string; uuid?: string }) => {
        // uuid is an optional input for the panel's own roster
        await flagPlayer(ctx, "op", inputs?.player, false, inputs?.uuid);
        return true;
    },
    whitelistPlayer: async (ctx: Server, inputs: { player: string; uuid?: string }) => {
        // uuid is an optional input for the panel's own roster
        await flagPlayer(ctx, "whitelist", inputs?.player, true, inputs?.uuid);
        return true;
    },
    unwhitelistPlayer: async (ctx: Server, inputs: { player: string; uuid?: string }) => {
        // uuid is an optional input for the panel's own roster
        await flagPlayer(ctx, "whitelist", inputs?.player, false, inputs?.uuid);
        return true;
    },
    pardonPlayer: async (ctx: Server, inputs: { player: string }) => {
        await playerCommand(ctx, "pardon", inputs?.player);
        return true;
    },
    killPlayer: async (ctx: Server, inputs: { player: string }) => {
        await playerCommand(ctx, "kill", inputs?.player);
        return true;
    },
    // every call on the panel's contract is answered here, so a missing
    // one is a contract-test failure, not a silent no-op
    killConflictingProcess: async (
        ctx: Server,
        inputs: { port?: string },
    ) => {
        // a failed kill throws why
        await killConflictingProcess(ctx, inputs?.port);
    },
    resetWorldFiles: (ctx: Server) => resetWorldFiles(ctx),
    clearActiveIssue: async (ctx: Server) => {
        clearActiveIssue(ctx);
        return true;
    },
    retryRecovery: async (ctx: Server) => {
        if (isInstallRunning()) throw new Error("An install is running; retry when it finishes.");
        const settled = await settleInterruptedWork(ctx);
        if (!settled) throw new Error(ctx.state.recoveryBlock ?? "The interrupted work could not be cleaned up.");
        return true;
    },
    updatePanelConfig: async (
        ctx: Server,
        inputs: { patch?: Record<string, unknown> },
    ) => {
        const patch = inputs?.patch ?? {};
        // what is installed is written by install-server-version alone:
        // a patch claiming another software or launch would make the
        // panel launch and later delete files it never installed
        for (const key of INSTALL_OWNED_CONFIG_KEYS) {
            if (Object.prototype.hasOwnProperty.call(patch, key)) {
                throw new Error(`"${key}" is set by installing a server version, not by a config patch`);
            }
        }
        await updatePanelConfig(ctx, patch);
        return true;
    },
    listWorldDirs: async () => {
        return listWorldDirs();
    },
    exportWorld: async (ctx, inputs) => exportWorld(ctx, inputs?.levelName),
    importWorld: async (_ctx, inputs) => importWorld(inputs?.file, inputs?.levelName),
    discardWorldTransfer: async (_ctx, inputs) => {
        await discardWorldTransfer(inputs?.file);
        return true;
    },
    listWorlds: async () => {
        return listWorlds();
    },
    installServerVersion: async (
        ctx: Server,
        inputs: { software: string; version: string },
    ) => {
        return installVersion(ctx, inputs?.software, inputs?.version);
    },
    // fetched here, not in the panel page: upstream indexes such as
    // files.minecraftforge.net send no CORS headers, and the service
    // already owns every other call to these hosts
    listSoftwareVersions: async (_ctx: Server, inputs: { software?: string }) => {
        const software = inputs?.software;
        if (!isServerSoftware(software)) {
            throw new Error(`Unknown server software: ${JSON.stringify(software)}`);
        }
        return providerFor(software).listVersions();
    },
    readLoaderSettings: async (ctx: Server) =>
        readLoaderSettings(minecraftSoftware(ctx.state.serverSoftware), loaderDeps),
    writeLoaderSetting: async (ctx: Server, inputs: { id?: string; value?: string }) => {
        if (isInstallRunning()) {
            throw new Error("A server install is running; change loader settings once it finishes.");
        }
        return writeLoaderSetting(minecraftSoftware(ctx.state.serverSoftware), inputs?.id, inputs?.value, loaderDeps);
    },
    readCrossplay: async (ctx: Server) => {
        const software = minecraftSoftware(ctx.state.serverSoftware);
        // a Geyser set up before Paperboard let RakNet clients in shows,
        // and gets on its next start, the setup it would get today
        if (!isInstallRunning() && (await findCrossplayJars(software, loaderDeps)).geyser) {
            await settleBedrockTransport(software, loaderDeps);
        }
        return readCrossplay(software, loaderDeps);
    },
    writeCrossplaySetting: async (ctx: Server, inputs: { id?: string; value?: string }) => {
        if (isInstallRunning()) {
            throw new Error("A server install is running; change crossplay settings once it finishes.");
        }
        return writeCrossplaySetting(minecraftSoftware(ctx.state.serverSoftware), inputs?.id, inputs?.value, loaderDeps);
    },
    prepareCrossplay: async (ctx: Server) => {
        if (isInstallRunning()) {
            throw new Error("A server install is running; turn crossplay on once it finishes.");
        }
        await prepareCrossplay(minecraftSoftware(ctx.state.serverSoftware), loaderDeps);
        await claimBedrockPorts(minecraftSoftware(ctx.state.serverSoftware), false, livePortDeps());
        return readCrossplay(minecraftSoftware(ctx.state.serverSoftware), loaderDeps);
    },
    readServerIcon: async () => readServerIcon(loaderDeps),
    setServerIcon: async (_ctx, inputs) => setServerIcon(inputs?.png, loaderDeps),
    removeServerIcon: async () => {
        await removeServerIcon(loaderDeps);
        return true;
    },
    locateAddonConfig: async (ctx: Server, inputs: { filename?: string }) =>
        locateAddonConfig(inputs?.filename, minecraftSoftware(ctx.state.serverSoftware), loaderDeps),
    listMapRegions: async (ctx: Server) => {
        return listMapRegions(ctx);
    },
    renderMapTile: async (
        ctx: Server,
        inputs: { dimension: string; rx: number; rz: number; since?: number },
    ) => {
        return renderMapTile(
            ctx,
            inputs?.dimension as MapDimension,
            Number(inputs?.rx),
            Number(inputs?.rz),
            typeof inputs?.since === "number" ? inputs.since : undefined,
        );
    },
    listInstalledPlugins: async (ctx: Server) => {
        return listInstalledPlugins(ctx);
    },
    recordPluginInstalls: async (_ctx: Server, inputs: { set?: unknown; remove?: unknown }) => {
        await recordPluginInstalls(inputs);
        return true;
    },
    previewPluginInstall: (ctx: Server, inputs: Parameters<typeof previewPluginInstall>[0]) =>
        previewPluginInstall(inputs ?? {}, pluginTarget(ctx.state), livePluginInstallDeps),
    installPluginVersion: (ctx: Server, inputs: Parameters<typeof installPluginVersion>[0]) =>
        installPluginVersion(inputs ?? {}, pluginTarget(ctx.state), livePluginInstallDeps),
    uninstallAllPlugins: async (ctx: Server) => {
        return uninstallAllPlugins(ctx);
    },
    listDatapacks: async (ctx: Server) => listDatapacks(liveDatapackDeps(ctx)),
    listDatapackVersions: async (ctx: Server, inputs: { projectId?: string }) =>
        listDatapackVersions(inputs?.projectId, ctx.state.serverVersion, liveDatapackDeps(ctx)),
    installDatapack: async (ctx: Server, inputs: { projectId?: string; versionId?: string }) => {
        if (!versionSupports(ctx.state.serverVersion, "datapacks")) {
            throw new Error("Datapacks need Minecraft 1.13 or newer.");
        }
        return installDatapack(
            { projectId: inputs?.projectId, versionId: inputs?.versionId },
            ctx.state.serverVersion,
            liveDatapackDeps(ctx),
        );
    },
    removeDatapack: async (ctx: Server, inputs: { name?: string }) => {
        await removeDatapack(inputs?.name, liveDatapackDeps(ctx));
        return true;
    },
    readResourcePack: async (ctx: Server) => readResourcePack(liveResourcePackDeps(ctx)),
    listResourcePackVersions: async (ctx: Server, inputs: { projectId?: string }) =>
        listResourcePackVersions(inputs?.projectId, ctx.state.serverVersion, liveResourcePackDeps(ctx)),
    selectResourcePack: async (
        ctx: Server,
        inputs: { projectId?: string; versionId?: string; url?: string },
    ) => {
        const deps = liveResourcePackDeps(ctx);
        if (inputs?.projectId && inputs?.url) throw new Error("Choose a Modrinth pack or a URL, not both");
        if (inputs?.url) return selectCustomResourcePack({ url: inputs.url }, deps);
        return selectModrinthResourcePack(
            { projectId: inputs?.projectId, versionId: inputs?.versionId },
            ctx.state.serverVersion,
            deps,
        );
    },
    removeResourcePack: async (ctx: Server) => {
        await removeResourcePack(liveResourcePackDeps(ctx));
        return true;
    },
    // the contract's calls, here too for the panel's blocks
    readModpack: (ctx: Server) => modpackCalls.readModpack(undefined, ctx),
    listModpackVersions: (ctx: Server, inputs: { projectId: string }) => modpackCalls.listModpackVersions(inputs, ctx),
    installModpack: (ctx: Server, inputs: { projectId: string; versionId: string }) => modpackCalls.installModpack(inputs, ctx),
    removeModpack: (ctx: Server) => modpackCalls.removeModpack(undefined, ctx),
    uploadPlugins: async (ctx: Server, inputs: { stage?: string }) =>
        withInstallLock(() => uploadPlugins(inputs?.stage, minecraftSoftware(ctx.state.serverSoftware), liveUploadDeps(ctx))),
    uploadDatapacks: async (ctx: Server, inputs: { stage?: string }) => {
        if (!versionSupports(ctx.state.serverVersion, "datapacks")) {
            throw new Error("Datapacks need Minecraft 1.13 or newer.");
        }
        return withInstallLock(() => uploadDatapacks(inputs?.stage, liveUploadDeps(ctx)));
    },
    uploadModpack: async (ctx: Server, inputs: { stage?: string }) => {
        if (ctx.state.serverStatus !== "offline") {
            throw new Error("Stop the server before installing a modpack");
        }
        const outcome = await withInstallLock(() => uploadModpack(inputs?.stage, minecraftSoftware(ctx.state.serverSoftware), liveModpackDeps(ctx)));
        return outcome;
    },
    discardAddonUpload: async (ctx: Server, inputs: { stage?: string }) => {
        await discardUpload(inputs?.stage, liveUploadDeps(ctx));
        return true;
    },
    deletePlayerData: async (
        ctx: Server,
        // uuid stays an optional input for the panel's own player
        // list; flow authors only ever name a player
        inputs: { player: string; uuid?: string },
    ) => {
        await deletePlayerData(ctx, inputs?.player, inputs?.uuid);
        return true;
    },
    getPlayerSkin: async (
        ctx: Server,
        inputs: { player?: string; uuid?: string; size?: number },
    ) => {
        return getHeadDataUrl({
            name: inputs?.player,
            uuid: inputs?.uuid,
            size: inputs?.size,
            naming: () => bedrockNaming(ctx),
        });
    },
    forgetPlayerData: async (
        ctx: Server,
        inputs: { player: string },
    ) => {
        forgetPlayerData(ctx, inputs?.player);
        return true;
    },
    queryPlayerStats: async (
        ctx: Server,
        inputs: { player: string },
    ) => {
        queryPlayerStats(ctx, inputs?.player);
        return true;
    },
    queryOnlinePlayers: async (ctx: Server) => {
        queryOnlinePlayers(ctx);
        return true;
    },
    queryPlayerPositions: async (ctx: Server) => {
        queryPlayerPositions(ctx);
        return true;
    },
    listRoster: async () => listRoster(),
    currentPlayerNames: async (ctx: Server, inputs: { uuids?: unknown }) =>
        currentPlayerNames(ctx, inputs?.uuids, await bedrockNaming(ctx)),
    readBedrockNaming: async (ctx: Server) => bedrockNaming(ctx),
    listPlayerStats: async (ctx: Server) => {
        return listPlayerStats(ctx);
    },
    // game rules: the service owns the console and the config, so the UI
    // never writes gamerule commands itself — offline edits persist and
    // re-apply at next boot instead of looking applied and vanishing
    queryGamerules: async (ctx: Server) => {
        const names = gameruleNameOptions(ctx.state.serverVersion).map(
            (option) => option.value,
        );
        return queryGamerules(ctx, names);
    },
    readGameOptions: (ctx: Server) => readGameOptions(ctx),
    writeGameOptions: (ctx: Server, inputs: { patch?: unknown }) => writeGameOptions(ctx, inputs?.patch),
};

