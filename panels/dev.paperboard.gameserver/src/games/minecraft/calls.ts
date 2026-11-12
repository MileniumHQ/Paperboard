import { minecraftSoftware } from "./index";
import { sharedCalls, type ServerCalls } from "../../service/calls";
import { files as fileApi, type ServiceContext } from "../../service/api";
import { sendServerCommand } from "../../service/lifecycle";
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
import { listInstalledPlugins, deletePlugin, uninstallAllPlugins } from "../../service/plugins";
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
import { currentPlayerNames, listRoster, setPlayerFlag, type PlayerFlag } from "../../service/playerLists";
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
import { CALLS, PANEL_ID } from "../../service/contract";
import { isServerSoftware } from "../../software/catalog";
import { INSTALL_OWNED_CONFIG_KEYS } from "../../software/installRecord";
import { providerFor } from "./providers";
import { isSupportedMcVersion, MIN_SUPPORTED_MC_VERSION, versionSupports } from "../../lib/versionProfile";
import { gamerulesFor } from "../../core/gamerules";

const loaderDeps = { serverDir: () => fileApi.getPath("", PANEL_ID) };

// how Floodgate names Bedrock players here; null when it is not installed
const bedrockNaming = (ctx: ServiceContext<GameServerState>) =>
    readBedrockNaming(minecraftSoftware(ctx.state.serverSoftware), loaderDeps);

// What the calls and the blocks of a Minecraft server both run.

/** Kicks or bans a player, with the reason they see when one is given. */
export async function punishPlayer(ctx: ServiceContext<GameServerState>, verb: "kick" | "ban", player: unknown, reason?: unknown): Promise<void> {
    const name = assertPlayerName(player);
    const why = reason ? assertSingleLine(String(reason).trim(), `${verb} reason`) : "";
    await sendServerCommand(ctx, why ? `${verb} ${name} ${why}` : `${verb} ${name}`);
}

/** Pardons or kills a player. */
export async function playerCommand(ctx: ServiceContext<GameServerState>, verb: "pardon" | "kill", player: unknown): Promise<void> {
    await sendServerCommand(ctx, `${verb} ${assertPlayerName(player)}`);
}

/** Makes a player an operator or whitelisted, or takes it back; edits the lists' files while offline. */
export async function flagPlayer(ctx: ServiceContext<GameServerState>, flag: PlayerFlag, player: unknown, on: boolean, uuid?: string): Promise<void> {
    await setPlayerFlag(ctx, (cmd) => sendServerCommand(ctx, cmd), await bedrockNaming(ctx), flag, player, on, uuid);
}

/** Makes a world the one the server starts with; a new name is made on the next start. */
export async function activateWorld(ctx: ServiceContext<GameServerState>, levelName: unknown, seed?: string, createOnly = false): Promise<SetActiveWorldResult> {
    if (!levelName || typeof levelName !== "string") throw new Error("World name is required");
    const result = await setActiveWorld(ctx, levelName, seed, createOnly);
    return result;
}

/** Moves a world's folders to the trash. */
export async function removeWorld(ctx: ServiceContext<GameServerState>, levelName: unknown): Promise<void> {
    if (!levelName || typeof levelName !== "string") throw new Error("World name is required");
    await deleteActiveWorldDirs(ctx, levelName);
}

/** Moves the active world's folders to the trash; false when that failed (the service log says why). */
export async function resetWorld(ctx: ServiceContext<GameServerState>): Promise<boolean> {
    const result = await resetWorldFiles(ctx);
    return result;
}

/** Moves one plugin's jar to the trash. */
export async function removePlugin(ctx: ServiceContext<GameServerState>, filename: unknown): Promise<void> {
    if (!filename || typeof filename !== "string") throw new Error("Filename is required");
    await deletePlugin(ctx, filename);
}

/** Installs a server software for a Minecraft version over the stopped server. */
export async function installVersion(ctx: ServiceContext<GameServerState>, rawSoftware: unknown, rawVersion: unknown) {
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

export const minecraftCalls: ServerCalls = {
    ...sharedCalls,
    [CALLS.setActiveWorld]: (ctx: ServiceContext<GameServerState>, inputs: { levelName: string; seed?: string; createOnly?: boolean }) =>
        activateWorld(ctx, inputs?.levelName, inputs?.seed, inputs?.createOnly === true),
    [CALLS.setGamerule]: (ctx: ServiceContext<GameServerState>, inputs: { name?: string; value?: string }) => {
        if (!inputs?.name || !inputs?.value) throw new Error("Game rule name and value are required");
        return setGamerule(ctx, inputs.name, inputs.value);
    },
    [CALLS.deleteWorld]: async (ctx: ServiceContext<GameServerState>, inputs: { levelName: string }) => {
        await removeWorld(ctx, inputs?.levelName);
        return true;
    },
    [CALLS.deletePlugin]: async (ctx: ServiceContext<GameServerState>, inputs: { filename: string }) => {
        await removePlugin(ctx, inputs?.filename);
        return true;
    },
    [CALLS.kickPlayer]: async (
        ctx: ServiceContext<GameServerState>,
        inputs: { player: string; reason?: string },
    ) => {
        await punishPlayer(ctx, "kick", inputs?.player, inputs?.reason);
        return true;
    },
    [CALLS.banPlayer]: async (
        ctx: ServiceContext<GameServerState>,
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
    [CALLS.opPlayer]: async (ctx: ServiceContext<GameServerState>, inputs: { player: string; uuid?: string }) => {
        // uuid is an optional input for the panel's own roster
        await flagPlayer(ctx, "op", inputs?.player, true, inputs?.uuid);
        return true;
    },
    [CALLS.deopPlayer]: async (ctx: ServiceContext<GameServerState>, inputs: { player: string; uuid?: string }) => {
        // uuid is an optional input for the panel's own roster
        await flagPlayer(ctx, "op", inputs?.player, false, inputs?.uuid);
        return true;
    },
    [CALLS.whitelistPlayer]: async (ctx: ServiceContext<GameServerState>, inputs: { player: string; uuid?: string }) => {
        // uuid is an optional input for the panel's own roster
        await flagPlayer(ctx, "whitelist", inputs?.player, true, inputs?.uuid);
        return true;
    },
    [CALLS.unwhitelistPlayer]: async (ctx: ServiceContext<GameServerState>, inputs: { player: string; uuid?: string }) => {
        // uuid is an optional input for the panel's own roster
        await flagPlayer(ctx, "whitelist", inputs?.player, false, inputs?.uuid);
        return true;
    },
    [CALLS.pardonPlayer]: async (ctx: ServiceContext<GameServerState>, inputs: { player: string }) => {
        await playerCommand(ctx, "pardon", inputs?.player);
        return true;
    },
    [CALLS.killPlayer]: async (ctx: ServiceContext<GameServerState>, inputs: { player: string }) => {
        await playerCommand(ctx, "kill", inputs?.player);
        return true;
    },
    // service-boundary calls: the panel UI calls every one of these
    // through serverBridge.call(CALLS.*). They are registered here, so a
    // missing one is a contract-test failure, not a silent no-op.
    [CALLS.killConflictingProcess]: async (
        ctx: ServiceContext<GameServerState>,
        inputs: { port?: string },
    ) => {
        // the boolean is the real outcome: a failed kill is a false,
        // never a laundered true
        return killConflictingProcess(ctx, inputs?.port);
    },
    [CALLS.resetWorldFiles]: async (ctx: ServiceContext<GameServerState>) => {
        return resetWorld(ctx);
    },
    [CALLS.clearActiveIssue]: async (ctx: ServiceContext<GameServerState>) => {
        clearActiveIssue(ctx);
        return true;
    },
    [CALLS.retryRecovery]: async (ctx: ServiceContext<GameServerState>) => {
        if (isInstallRunning()) throw new Error("An install is running; retry when it finishes.");
        const settled = await settleInterruptedWork(ctx);
        if (!settled) throw new Error(ctx.state.recoveryBlock ?? "The interrupted work could not be cleaned up.");
        return true;
    },
    [CALLS.updatePanelConfig]: async (
        ctx: ServiceContext<GameServerState>,
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
    [CALLS.listWorldDirs]: async () => {
        return listWorldDirs();
    },
    [CALLS.exportWorld]: async (ctx, inputs) => exportWorld(ctx, inputs?.levelName),
    [CALLS.importWorld]: async (_ctx, inputs) => importWorld(inputs?.file, inputs?.levelName),
    [CALLS.discardWorldTransfer]: async (_ctx, inputs) => {
        await discardWorldTransfer(inputs?.file);
        return true;
    },
    [CALLS.listWorlds]: async () => {
        return listWorlds();
    },
    [CALLS.installServerVersion]: async (
        ctx: ServiceContext<GameServerState>,
        inputs: { software: string; version: string },
    ) => {
        return installVersion(ctx, inputs?.software, inputs?.version);
    },
    // fetched here, not in the panel page: upstream indexes such as
    // files.minecraftforge.net send no CORS headers, and the service
    // already owns every other call to these hosts
    [CALLS.listSoftwareVersions]: async (_ctx: ServiceContext<GameServerState>, inputs: { software?: string }) => {
        const software = inputs?.software;
        if (!isServerSoftware(software)) {
            throw new Error(`Unknown server software: ${JSON.stringify(software)}`);
        }
        return providerFor(software).listVersions();
    },
    [CALLS.readLoaderSettings]: async (ctx: ServiceContext<GameServerState>) =>
        readLoaderSettings(minecraftSoftware(ctx.state.serverSoftware), loaderDeps),
    [CALLS.writeLoaderSetting]: async (ctx: ServiceContext<GameServerState>, inputs: { id?: string; value?: string }) => {
        if (isInstallRunning()) {
            throw new Error("A server install is running; change loader settings once it finishes.");
        }
        return writeLoaderSetting(minecraftSoftware(ctx.state.serverSoftware), inputs?.id, inputs?.value, loaderDeps);
    },
    [CALLS.readCrossplay]: async (ctx: ServiceContext<GameServerState>) => {
        const software = minecraftSoftware(ctx.state.serverSoftware);
        // a Geyser set up before Paperboard let RakNet clients in shows,
        // and gets on its next start, the setup it would get today
        if (!isInstallRunning() && (await findCrossplayJars(software, loaderDeps)).geyser) {
            await settleBedrockTransport(software, loaderDeps);
        }
        return readCrossplay(software, loaderDeps);
    },
    [CALLS.writeCrossplaySetting]: async (ctx: ServiceContext<GameServerState>, inputs: { id?: string; value?: string }) => {
        if (isInstallRunning()) {
            throw new Error("A server install is running; change crossplay settings once it finishes.");
        }
        return writeCrossplaySetting(minecraftSoftware(ctx.state.serverSoftware), inputs?.id, inputs?.value, loaderDeps);
    },
    [CALLS.prepareCrossplay]: async (ctx: ServiceContext<GameServerState>) => {
        if (isInstallRunning()) {
            throw new Error("A server install is running; turn crossplay on once it finishes.");
        }
        await prepareCrossplay(minecraftSoftware(ctx.state.serverSoftware), loaderDeps);
        await claimBedrockPorts(minecraftSoftware(ctx.state.serverSoftware), false, livePortDeps());
        return readCrossplay(minecraftSoftware(ctx.state.serverSoftware), loaderDeps);
    },
    [CALLS.readServerIcon]: async () => readServerIcon(loaderDeps),
    [CALLS.setServerIcon]: async (_ctx, inputs) => setServerIcon(inputs?.png, loaderDeps),
    [CALLS.removeServerIcon]: async () => {
        await removeServerIcon(loaderDeps);
        return true;
    },
    [CALLS.locateAddonConfig]: async (ctx: ServiceContext<GameServerState>, inputs: { filename?: string }) =>
        locateAddonConfig(inputs?.filename, minecraftSoftware(ctx.state.serverSoftware), loaderDeps),
    [CALLS.listMapRegions]: async (ctx: ServiceContext<GameServerState>) => {
        return listMapRegions(ctx);
    },
    [CALLS.renderMapTile]: async (
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
    [CALLS.listInstalledPlugins]: async (ctx: ServiceContext<GameServerState>) => {
        return listInstalledPlugins(ctx);
    },
    [CALLS.uninstallAllPlugins]: async (ctx: ServiceContext<GameServerState>) => {
        return uninstallAllPlugins(ctx);
    },
    [CALLS.listDatapacks]: async (ctx: ServiceContext<GameServerState>) => listDatapacks(liveDatapackDeps(ctx)),
    [CALLS.listDatapackVersions]: async (ctx: ServiceContext<GameServerState>, inputs: { projectId?: string }) =>
        listDatapackVersions(inputs?.projectId, ctx.state.serverVersion, liveDatapackDeps(ctx)),
    [CALLS.installDatapack]: async (ctx: ServiceContext<GameServerState>, inputs: { projectId?: string; versionId?: string }) => {
        if (!versionSupports(ctx.state.serverVersion, "datapacks")) {
            throw new Error("Datapacks need Minecraft 1.13 or newer.");
        }
        return installDatapack(
            { projectId: inputs?.projectId, versionId: inputs?.versionId },
            ctx.state.serverVersion,
            liveDatapackDeps(ctx),
        );
    },
    [CALLS.removeDatapack]: async (ctx: ServiceContext<GameServerState>, inputs: { name?: string }) => {
        await removeDatapack(inputs?.name, liveDatapackDeps(ctx));
        return true;
    },
    [CALLS.readResourcePack]: async (ctx: ServiceContext<GameServerState>) => readResourcePack(liveResourcePackDeps(ctx)),
    [CALLS.listResourcePackVersions]: async (ctx: ServiceContext<GameServerState>, inputs: { projectId?: string }) =>
        listResourcePackVersions(inputs?.projectId, ctx.state.serverVersion, liveResourcePackDeps(ctx)),
    [CALLS.selectResourcePack]: async (
        ctx: ServiceContext<GameServerState>,
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
    [CALLS.removeResourcePack]: async (ctx: ServiceContext<GameServerState>) => {
        await removeResourcePack(liveResourcePackDeps(ctx));
        return true;
    },
    [CALLS.readModpack]: async (ctx: ServiceContext<GameServerState>) => ({ modpack: await readModpack(liveModpackDeps(ctx)) }),
    [CALLS.listModpackVersions]: async (ctx: ServiceContext<GameServerState>, inputs: { projectId?: string }) =>
        listModpackVersions(inputs?.projectId, minecraftSoftware(ctx.state.serverSoftware), liveModpackDeps(ctx)),
    [CALLS.installModpack]: async (ctx: ServiceContext<GameServerState>, inputs: { projectId?: string; versionId?: string }) => {
        // checked and claimed with no await between: a start cannot slip in
        if (ctx.state.serverStatus !== "offline") {
            throw new Error("Stop the server before installing a modpack");
        }
        const outcome = await withInstallLock(() =>
            installModpack(
                { projectId: inputs?.projectId, versionId: inputs?.versionId },
                minecraftSoftware(ctx.state.serverSoftware),
                liveModpackDeps(ctx),
            ),
        );
        return outcome;
    },
    [CALLS.removeModpack]: async (ctx: ServiceContext<GameServerState>) => {
        if (ctx.state.serverStatus !== "offline") {
            throw new Error("Stop the server before removing the modpack");
        }
        return withInstallLock(() => removeModpack(liveModpackDeps(ctx)));
    },
    [CALLS.uploadPlugins]: async (ctx: ServiceContext<GameServerState>, inputs: { stage?: string }) =>
        withInstallLock(() => uploadPlugins(inputs?.stage, minecraftSoftware(ctx.state.serverSoftware), liveUploadDeps(ctx))),
    [CALLS.uploadDatapacks]: async (ctx: ServiceContext<GameServerState>, inputs: { stage?: string }) => {
        if (!versionSupports(ctx.state.serverVersion, "datapacks")) {
            throw new Error("Datapacks need Minecraft 1.13 or newer.");
        }
        return withInstallLock(() => uploadDatapacks(inputs?.stage, liveUploadDeps(ctx)));
    },
    [CALLS.uploadModpack]: async (ctx: ServiceContext<GameServerState>, inputs: { stage?: string }) => {
        if (ctx.state.serverStatus !== "offline") {
            throw new Error("Stop the server before installing a modpack");
        }
        const outcome = await withInstallLock(() => uploadModpack(inputs?.stage, minecraftSoftware(ctx.state.serverSoftware), liveModpackDeps(ctx)));
        return outcome;
    },
    [CALLS.discardAddonUpload]: async (ctx: ServiceContext<GameServerState>, inputs: { stage?: string }) => {
        await discardUpload(inputs?.stage, liveUploadDeps(ctx));
        return true;
    },
    [CALLS.deletePlayerData]: async (
        ctx: ServiceContext<GameServerState>,
        // uuid stays an optional input for the panel's own player
        // list; flow authors only ever name a player
        inputs: { player: string; uuid?: string },
    ) => {
        await deletePlayerData(ctx, inputs?.player, inputs?.uuid);
        return true;
    },
    [CALLS.getPlayerSkin]: async (
        ctx: ServiceContext<GameServerState>,
        inputs: { player?: string; uuid?: string; size?: number },
    ) => {
        return getHeadDataUrl({
            name: inputs?.player,
            uuid: inputs?.uuid,
            size: inputs?.size,
            naming: () => bedrockNaming(ctx),
        });
    },
    [CALLS.forgetPlayerData]: async (
        ctx: ServiceContext<GameServerState>,
        inputs: { player: string },
    ) => {
        forgetPlayerData(ctx, inputs?.player);
        return true;
    },
    [CALLS.queryPlayerStats]: async (
        ctx: ServiceContext<GameServerState>,
        inputs: { player: string },
    ) => {
        queryPlayerStats(ctx, inputs?.player);
        return true;
    },
    [CALLS.queryOnlinePlayers]: async (ctx: ServiceContext<GameServerState>) => {
        queryOnlinePlayers(ctx);
        return true;
    },
    [CALLS.queryPlayerPositions]: async (ctx: ServiceContext<GameServerState>) => {
        queryPlayerPositions(ctx);
        return true;
    },
    [CALLS.listRoster]: async () => listRoster(),
    [CALLS.currentPlayerNames]: async (ctx: ServiceContext<GameServerState>, inputs: { uuids?: unknown }) =>
        currentPlayerNames(inputs?.uuids, await bedrockNaming(ctx)),
    [CALLS.readBedrockNaming]: async (ctx: ServiceContext<GameServerState>) => bedrockNaming(ctx),
    [CALLS.listPlayerStats]: async (ctx: ServiceContext<GameServerState>) => {
        return listPlayerStats(ctx);
    },
    // game rules: the service owns the console and the config, so the UI
    // never writes gamerule commands itself — offline edits persist and
    // re-apply at next boot instead of looking applied and vanishing
    [CALLS.queryGamerules]: async (ctx: ServiceContext<GameServerState>) => {
        const names = gameruleNameOptions(ctx.state.serverVersion).map(
            (option) => option.value,
        );
        return queryGamerules(ctx, names);
    },
    [CALLS.readGameOptions]: (ctx: ServiceContext<GameServerState>) => readGameOptions(ctx),
    [CALLS.writeGameOptions]: (ctx: ServiceContext<GameServerState>, inputs: { patch?: unknown }) => writeGameOptions(ctx, inputs?.patch),
};

