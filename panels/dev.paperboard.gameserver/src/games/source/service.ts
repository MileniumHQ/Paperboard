import fs from "node:fs/promises";
import path from "node:path";
import { packages as packageApi, processApi } from "../../service/api";
import { serverLocal } from "../../service/scope";
import { initialServerState } from "../../service/initialState";
import { appendCapped } from "../../service/types";
import { ACTION_IDS, TRIGGER_IDS } from "../../service/contract";
import { validateOptions } from "../options";
import { installedBuild, steamClientLibrary } from "../steam/steamcmd";
import { steamInstall, steamInstallActions, steamUpdateStatus, type SteamInstallSpec } from "../steam/installAction";
import {
    ConsoleBuffer, assertHost, exists, gameAction, isLinked, linkFolder, pushChat, readSettings, redact, report,
    serverRoot, serverSecret, settingPort, settled, singleLine, unlinkFolder, updateSettings, writePrivate, type Context,
} from "../serviceKit";
import type { GameDefinition } from "../types";
import type { GameService } from "../serviceTypes";
import { addonStageDir } from "../../core/addonUpload";
import { SOURCEMOD_PACKAGES, sourceActions, type SourceGameSpec, type SourceMapCycle, type SourceModView } from "./index";
import { pluginFile, SourceMod, SOURCEMOD_MISSING } from "./sourcemod";
import { cvarValue, mapName, optionValue, secretsCfg, serverCfg } from "./config";
import { cfgMapCycleFile, checkRotation, DEFAULT_MAPCYCLE, findMap, installedMaps, mapCycleFile, PAPERBOARD_MAPCYCLE, readServerCycle } from "./mapcycle";
import { mapPictures } from "./mapPictures";
import { playModes } from "./modes";
import { consoleLine, isErrorLine, linePlayer, parseLogLine, parseStatus, steamId, type SourceLogEvent } from "./log";
import { SourceRcon, RconError, RconNoAnswer } from "./rcon";
import { bannedUserCfg, noStats, SourceRoster, type SourceStats } from "./roster";

/** A player on the running server, by the server's user id for their connection. */
export interface SourceOnline {
    userId: number;
    name: string;
    /** "[U:1:…]", or "BOT" */
    steamId: string;
    team: string;
    /** "medic", once they have picked a class */
    role?: string;
    since: number;
    /** what they have done since they joined */
    stats: SourceStats;
}

const DEFAULT_CLIENT_PORT = 27005;
const STDBUF = ["/usr/bin/stdbuf", "/bin/stdbuf"];
/** how long stats gather before they are written to the roster */
const STATS_FLUSH_MS = 15_000;

/** A `status` row's connected time ("01:02", "1:02:03") in milliseconds. */
export function connectedMs(text: string): number {
    const parts = text.split(":").map(Number);
    if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) return 0;
    return parts.reduce((total, n) => total * 60 + n, 0) * 1000;
}

export function sourceService(spec: SourceGameSpec, game: GameDefinition): GameService {
    const ids = sourceActions(spec.id);
    const PROC = `${spec.id}-server`;
    const options = spec.options;

    const local = serverLocal(() => ({
        busy: false,
        rcon: null as SourceRcon | null,
        roster: null as SourceRoster | null,
        online: new Map<number, SourceOnline>(),
        secrets: [] as string[],
        console: new ConsoleBuffer(isErrorLine),
        /** stats not yet in the roster, by Steam id */
        unsaved: new Map<string, Partial<SourceStats>>(),
        /** when each online player's time was last added to their playtime, by user id */
        counted: new Map<number, number>(),
        statsTimer: null as ReturnType<typeof setTimeout> | null,
        /** SourceMod loaded with the running server */
        modsActive: false,
        modsBusy: false,
    }));

    // Layout: install/ is SteamCMD's folder, left out of backups; Paperboard's
    // players, bans, logs and the user's own server.cfg sit beside it.
    const root = serverRoot;
    const installDir = async () => path.join(await root(), "install");
    const gameDir = async () => path.join(await installDir(), spec.gameDir);
    const cfgDir = async () => path.join(await gameDir(), "cfg");
    const settings = readSettings;

    const joinPassword = serverSecret(spec.id, "join-password");
    const rconPassword = serverSecret(spec.id, "rcon-password");
    const loginToken = serverSecret(spec.id, "login-token");
    /** Options kept in the vault, by option id. */
    const vaulted = [["password", joinPassword], ["rconPassword", rconPassword], ["token", loginToken]] as const;
    function rcon(): SourceRcon {
        const client = local().rcon;
        if (!client) throw new Error(`${spec.name} is not running`);
        return client;
    }
    function roster() { const r = local().roster; if (!r) throw new Error(`${spec.name}'s player list is not ready`); return r; }

    async function loadOptions(ctx: Context) {
        const saved = await settings();
        const values: Record<string, unknown> = {};
        for (const option of options) {
            if (option.kind === "secret") continue;
            const value = optionValue(option, saved);
            if (value !== undefined) values[option.id] = value;
        }
        for (const [id, secret] of vaulted) values[id] = await secret.found();
        ctx.setState({ serverSoftware: spec.id, serverVersion: saved.build ? `Build ${saved.build}` : "", serverPort: String(values.port ?? spec.defaultPort), gameSettings: values });
    }

    /** Writes server.cfg and banned_user.cfg into the install from the panel's settings and ban list. */
    async function writeConfigs() {
        const dir = await cfgDir();
        await fs.mkdir(dir, { recursive: true });
        const user = path.join(await root(), "server.cfg");
        const hasUser = await exists(user);
        if (hasUser) await fs.copyFile(user, path.join(dir, "paperboard_user.cfg"));
        else await fs.rm(path.join(dir, "paperboard_user.cfg"), { force: true });
        const saved = await settings();
        await fs.writeFile(path.join(dir, "server.cfg"), serverCfg(options, saved, hasUser));
        await fs.writeFile(path.join(dir, "banned_user.cfg"), bannedUserCfg(await roster().bans()));
        if (Array.isArray(saved.mapCycle)) await fs.writeFile(path.join(dir, PAPERBOARD_MAPCYCLE), mapCycleFile(saved.mapCycle as string[]));
        else await fs.rm(path.join(dir, PAPERBOARD_MAPCYCLE), { force: true });
    }
    /** What a server.cfg in the server folder sets mapcyclefile to; it has the last word over the rotation set here. */
    async function userMapCycleFile(): Promise<string | null> {
        const user = path.join(await root(), "server.cfg");
        return (await exists(user)) ? cfgMapCycleFile(await fs.readFile(user, "utf8")) : null;
    }
    async function mapCycleView(): Promise<SourceMapCycle> {
        const game = await gameDir();
        const installed = await installedMaps(game);
        const saved = (await settings()).mapCycle;
        const overriddenBy = await userMapCycleFile();
        if (Array.isArray(saved)) return { maps: saved as string[], custom: true, file: `cfg/${PAPERBOARD_MAPCYCLE}`, installed, overriddenBy };
        const read = await readServerCycle(game, overriddenBy ?? DEFAULT_MAPCYCLE);
        return { maps: read?.maps ?? [], custom: false, file: read?.file ?? null, installed, overriddenBy };
    }
    /** Refuses a rotation set here while the user's own server.cfg picks the map cycle file, which the server follows over it. */
    async function refuseOverriddenCycle() {
        const overriddenBy = await userMapCycleFile();
        if (overriddenBy) throw new Error(`server.cfg in the server folder sets mapcyclefile to ${overriddenBy}, which the server follows over this page. Remove that line to set the rotation here.`);
    }
    /** Saves the rotation (null: the game's own map cycle) with anything saved beside it, and gives it to a running server. */
    async function setRotation(ctx: Context, rotation: string[] | null, also: Record<string, unknown> = {}) {
        await updateSettings({ ...also, mapCycle: rotation });
        if (await exists(await installDir())) await writeConfigs();
        // a running server reads the cycle file again when it changes, and the variable once
        if (online(ctx)) await rcon().exec(`mapcyclefile ${rotation ? PAPERBOARD_MAPCYCLE : DEFAULT_MAPCYCLE}`);
    }
    const secretsFile = async () => path.join(await cfgDir(), "paperboard_secrets.cfg");
    async function removeSecrets() { await fs.rm(await secretsFile(), { force: true }); }

    /** Points the game's logs folder at logs/ in the server folder, where Logs reads them and backups keep them. */
    async function linkLogs() {
        await linkFolder(path.join(await gameDir(), "logs"), path.join(await root(), "logs"));
    }

    // SourceMod: its folders live in the server folder and are linked into
    // the game's while it is on (games/source/sourcemod.ts)
    const mods = async () => new SourceMod(await root());
    const modsOn = async () => !!spec.sourcemod && (await settings()).sourcemod === true;
    function supportsMods() { if (!spec.sourcemod) throw new Error(`SourceMod does not run on ${spec.name}`); }
    async function modsView(ctx: Context): Promise<SourceModView> {
        supportsMods();
        const on = await modsOn();
        return { on, active: local().modsActive && ctx.state.serverStatus === "online", ...(await (await mods()).view(on)) };
    }
    async function modChange(ctx: Context, work: (sm: SourceMod) => Promise<void>): Promise<SourceModView> {
        supportsMods();
        if (local().modsBusy) throw new Error("Wait for the current SourceMod change to finish");
        local().modsBusy = true;
        try { await work(await mods()); } finally { local().modsBusy = false; }
        return modsView(ctx);
    }
    /** A console command for SourceMod on the running server, when it loaded there. */
    async function smLive(ctx: Context, command: string): Promise<string | null> {
        if (!local().modsActive || ctx.state.serverStatus !== "online") return null;
        return rcon().exec(command);
    }
    async function loadPlugin(ctx: Context, file: string) {
        const reply = await smLive(ctx, `sm plugins load ${file}`);
        if (reply !== null && !/Loaded plugin|already loaded/i.test(reply)) throw new Error(`SourceMod did not load ${file}: ${reply.replace(/^\[SM\]\s*/, "").trim()}`);
    }
    /** Links SourceMod's folders into the game's while it is on, and takes them out while it is off. */
    async function placeMods() {
        const links = [path.join(await gameDir(), "addons"), path.join(await cfgDir(), "sourcemod")] as const;
        if (!(await modsOn())) {
            for (const link of links) await unlinkFolder(link);
            return false;
        }
        const sm = await mods();
        if (!(await sm.installed())) throw new Error(SOURCEMOD_MISSING);
        await linkFolder(links[0], sm.addons);
        await linkFolder(links[1], sm.cfg);
        return true;
    }

    function linuxBinary() { const binary = spec.binaries.linux; if (!binary) throw new Error(`${spec.name} has no Linux server`); return binary; }
    /** System libraries the server needs that these folders and the computer lack, as ldd reports them. */
    async function missingLibraries(install: string, folders: readonly string[]): Promise<string[]> {
        const libraries = path.join(install, linuxBinary().libraryDir);
        const targets = [path.join(install, linuxBinary().executable), ...(await fs.readdir(libraries)).filter((f) => f.endsWith(".so")).map((f) => path.join(libraries, f))];
        let output = "";
        const result = await processApi.run({ command: "ldd", args: targets, env: { LD_LIBRARY_PATH: folders.join(":") }, onStdout: (data) => { output += data; } });
        if (result.exitCode !== 0 && !output) throw new Error(`Could not check ${spec.name}'s libraries: ldd exited with ${result.exitCode}`);
        const missing = new Set<string>();
        for (const line of output.split("\n")) {
            const name = /^\s*(\S+) => not found/.exec(line)?.[1];
            if (name && !name.endsWith("_srv.so")) missing.add(name);
        }
        return [...missing].sort();
    }

    /** The folders the server loads libraries from: its own, then Origami's for what the computer lacks. */
    async function libraryPath(install: string): Promise<string[]> {
        const folders = [path.join(install, linuxBinary().libraryDir)];
        const missing = await missingLibraries(install, folders);
        const supplied = missing.filter((name) => spec.libraryPackages?.[name]);
        if (supplied.length === 0) return checked(missing, folders);
        for (const name of supplied) {
            const { id } = spec.libraryPackages![name]!;
            if (!(await packageApi.isInstalled(id))) await packageApi.download(id);
            folders.push(path.join(await packageApi.getPath(id), "bin"));
        }
        return checked(await missingLibraries(install, folders), folders);
    }
    function checked(missing: string[], folders: string[]): string[] {
        if (missing.length > 0) throw new Error(`${spec.name}'s server needs ${missing.join(", ")}, which this computer doesn't have. Install ${missing.length === 1 ? "it" : "them"} with your system's package manager, then start again.`);
        return folders;
    }

    function setOnline(ctx: Context) {
        const humans = [...local().online.values()].filter((p) => p.steamId !== "BOT" && p.name);
        ctx.setState((prev) => ({
            onlinePlayers: humans.map((p) => p.name),
            seenPlayers: humans.reduce((seen, p) => (seen.includes(p.name) ? seen : appendCapped(seen, p.name)), prev.seenPlayers),
        }));
    }
    const isPlayer = (id: string) => /^\[U:1:\d+\]$/.test(id);

    function observeEvent(ctx: Context, event: SourceLogEvent) {
        const online = local().online;
        switch (event.kind) {
            case "map": ctx.setState({ serverLevel: event.map }); return;
            case "connected": {
                const p = event.player;
                const now = Date.now();
                online.set(p.userId, { userId: p.userId, name: p.name, steamId: p.steamId, team: p.team, since: now, stats: noStats() });
                local().counted.set(p.userId, now);
                setOnline(ctx);
                if (isPlayer(p.steamId)) {
                    pushChat(ctx, { event: "join", sender: p.name, text: `${p.name} joined the game` });
                    ctx.emitTrigger(TRIGGER_IDS.playerJoined, p.name);
                    roster().remember(p.steamId, p.name).catch((err) => report(ctx, `Could not record ${p.name}`, err));
                }
                return;
            }
            case "disconnected": {
                const p = event.player;
                const known = online.get(p.userId);
                if (known) countPlaytime(known);
                online.delete(p.userId);
                local().counted.delete(p.userId);
                setOnline(ctx);
                const name = p.name || known?.name || "";
                if (isPlayer(p.steamId) && name) {
                    pushChat(ctx, { event: "leave", sender: name, text: `${name} left the game` });
                    ctx.emitTrigger(TRIGGER_IDS.playerLeft, name);
                    roster().remember(p.steamId, name).catch((err) => report(ctx, `Could not record ${name} leaving`, err));
                    saveStats().catch((err) => report(ctx, `Could not save ${name}'s stats`, err));
                }
                return;
            }
            case "renamed": {
                const known = online.get(event.player.userId);
                if (known) { known.name = event.name; setOnline(ctx); }
                if (isPlayer(event.player.steamId)) roster().remember(event.player.steamId, event.name).catch((err) => report(ctx, `Could not record ${event.name}`, err));
                return;
            }
            case "entered": return;
            case "team": {
                const known = online.get(event.player.userId);
                if (known) known.team = event.team;
                return;
            }
            case "role": {
                const known = online.get(event.player.userId);
                if (known) known.role = event.role;
                return;
            }
            // a kill by the world or a sentry's owner names the victim as both
            case "kill":
                if (event.player.userId !== event.victim.userId) bump(ctx, event.player.userId, "kills");
                bump(ctx, event.victim.userId, "deaths");
                return;
            case "suicide": bump(ctx, event.player.userId, "deaths"); return;
            case "assist": bump(ctx, event.player.userId, "assists"); return;
            case "domination": bump(ctx, event.player.userId, "dominations"); return;
            case "say": {
                const p = event.player;
                if (p.steamId === "Console") { pushChat(ctx, { event: "server", content: event.text, text: `<Server> ${event.text}` }); return; }
                if (p.steamId === "BOT") return;
                const text = event.team ? `(Team) ${event.text}` : event.text;
                ctx.emitTrigger(TRIGGER_IDS.chatMessage, pushChat(ctx, { sender: p.name, content: text, text: `<${p.name}> ${text}` }));
                return;
            }
        }
    }

    /** Counts one stat for an online player; a person's goes to the roster soon after. */
    function bump(ctx: Context, userId: number, key: Exclude<keyof SourceStats, "playtime">) {
        const player = local().online.get(userId);
        if (!player) return;
        player.stats[key] += 1;
        if (!isPlayer(player.steamId)) return;
        unsaved(player.steamId)[key] = (unsaved(player.steamId)[key] ?? 0) + 1;
        if (!local().statsTimer) local().statsTimer = setTimeout(() => {
            local().statsTimer = null;
            saveStats().catch((err) => report(ctx, "Could not save players' stats", err));
        }, STATS_FLUSH_MS);
    }
    function unsaved(steamId: string): Partial<SourceStats> {
        const stats = local().unsaved.get(steamId) ?? {};
        local().unsaved.set(steamId, stats);
        return stats;
    }
    /** Adds the time since it was last counted to a person's playtime. */
    function countPlaytime(player: SourceOnline, now = Date.now()) {
        const from = local().counted.get(player.userId) ?? now;
        local().counted.set(player.userId, now);
        if (!isPlayer(player.steamId) || now <= from) return;
        player.stats.playtime += now - from;
        unsaved(player.steamId).playtime = (unsaved(player.steamId).playtime ?? 0) + now - from;
    }
    /** Writes what has gathered, with everyone's time on so far, to the roster. */
    async function saveStats() {
        if (local().statsTimer) clearTimeout(local().statsTimer!);
        local().statsTimer = null;
        const now = Date.now();
        for (const player of local().online.values()) countPlaytime(player, now);
        const stats = local().unsaved;
        local().unsaved = new Map();
        await roster().addStats(stats);
    }

    /** Learns who is on, which map and the player cap from `status`: on start and when reattaching. */
    async function readStatus(ctx: Context) {
        const status = parseStatus(await rcon().exec("status"));
        const online = local().online;
        const now = Date.now();
        const before = new Map(online);
        online.clear();
        for (const p of status.players) {
            const known = before.get(p.userId);
            online.set(p.userId, known?.steamId === p.steamId ? known : { userId: p.userId, name: p.name, steamId: p.steamId, team: "", since: now - connectedMs(p.connected), stats: noStats() });
            if (!local().counted.has(p.userId)) local().counted.set(p.userId, now);
            if (isPlayer(p.steamId) && !known) await roster().remember(p.steamId, p.name);
        }
        for (const id of [...local().counted.keys()]) if (!online.has(id)) local().counted.delete(id);
        ctx.setState({ maxPlayers: status.maxPlayers, serverLevel: status.map });
        const saved = await settings();
        if (status.version && saved.version !== status.version) await updateSettings({ version: status.version });
        setOnline(ctx);
    }

    const online = (ctx: Context) => settled(ctx, spec.name);
    const action = gameAction;
    const steam: SteamInstallSpec = {
        game, appId: spec.appId, ids: { info: ids.info, latest: ids.latest, install: ids.install },
        installDir, flag: local, loadOptions,
        async afterInstall() { await linkLogs(); await writeConfigs(); },
    };

    return {
        primaryProcessId: PROC, processIds: [PROC],
        backupExclude: ["install"],
        updateStatus: () => steamUpdateStatus(steam),
        installUpdate: steamInstall(steam),
        initialState: () => ({ ...initialServerState(), serverSoftware: spec.id, serverPort: String(spec.defaultPort), serverMotd: "" }),
        actions: async () => { const { sharedActions, backupAction } = await import("../../service/actions"); return [...sharedActions, backupAction,
            action(ACTION_IDS.readGameOptions, "Read options", async (ctx) => { await loadOptions(ctx); return ctx.state.gameSettings; }),
            action(ACTION_IDS.writeGameOptions, "Save options", async (ctx, { patch }) => {
                if (local().busy) throw new Error(`Wait for the ${spec.name} operation to finish`);
                if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Options patch is required");
                const next = validateOptions(options, spec.name, patch, await settings());
                // the starting map is chosen from the installed ones; the Overview offers only those
                if (Object.hasOwn(patch, "map") && !(await findMap(await gameDir(), mapName(patch.map)))) throw new Error(`${patch.map} is not installed`);
                // refuse what a console line can't hold before anything is saved
                for (const option of options) if (Object.hasOwn(patch, option.id) && (option.cvar || option.kind === "secret") && patch[option.id] !== "") cvarValue(patch[option.id], option.label);
                const live: string[] = [];
                for (const option of options) {
                    if (!Object.hasOwn(patch, option.id) || option.restartRequired) continue;
                    if (option.cvar) live.push(`${option.cvar} ${cvarValue(patch[option.id], option.label)}`);
                    if (option.id === "password") live.push(`sv_password ${cvarValue(patch.password, option.label)}`);
                }
                for (const [id, secret] of vaulted) if (Object.hasOwn(patch, id)) await secret.set(patch[id]);
                await updateSettings(next);
                if (ctx.state.serverStatus === "online") {
                    if (Object.hasOwn(patch, "password")) local().secrets = [...local().secrets, String(patch.password)].filter(Boolean);
                    for (const line of live) await rcon().exec(line);
                }
                if (await exists(await installDir())) await writeConfigs();
                await loadOptions(ctx);
                return ctx.state.gameSettings;
            }),
            ...steamInstallActions(steam),
            action(ids.players, `${spec.name} players`, async () => {
                await saveStats();
                return { seen: await roster().seen(), bans: await roster().bans(), online: [...local().online.values()], admins: (await modsOn()) ? await (await mods()).admins() : null };
            }),
            action(ids.kick, "Kick player", async (ctx, { userId }) => {
                if (!online(ctx)) throw new Error(`${spec.name} is not running`);
                const player = local().online.get(Number(userId));
                if (!player) throw new Error("That player is not online");
                const reply = await rcon().exec(`kickid ${player.userId} Kicked by the server admin`);
                if (/not found/.test(reply)) throw new Error(`${spec.name} did not find that player: ${reply.trim()}`);
                return true;
            }),
            action(ids.ban, "Ban player", async (ctx, { steamId: raw }) => {
                const id = steamId(raw);
                await roster().ban(id);
                if (online(ctx)) await rcon().exec(`banid 0 ${id} kick`);
                if (await exists(await installDir())) await writeConfigs();
                return true;
            }),
            action(ids.unban, "Unban player", async (ctx, { steamId: raw }) => {
                const id = steamId(raw);
                await roster().unban(id);
                if (online(ctx)) await rcon().exec(`removeid ${id}`);
                if (await exists(await installDir())) await writeConfigs();
                return true;
            }),
            action(ids.sourcemod, "SourceMod", (ctx) => modsView(ctx)),
            action(ids.sourcemodSet, "Turn SourceMod on or off", (ctx, { on }) => modChange(ctx, async (sm) => {
                if (typeof on !== "boolean") throw new Error("Choose on or off");
                if (on && !(await sm.installed())) {
                    const [metamod, sourcemod] = await Promise.all(SOURCEMOD_PACKAGES.map(async ({ id }) => {
                        if (!(await packageApi.isInstalled(id))) await packageApi.download(id);
                        return path.join(await packageApi.getPath(id), "bin");
                    }));
                    await sm.install(metamod!, sourcemod!);
                }
                await updateSettings({ sourcemod: on });
                // a running server keeps what it started with until it restarts
                if (ctx.state.serverStatus === "offline") await placeMods();
            })),
            action(ids.plugin, "Turn a plugin on or off", (ctx, { file, on }) => modChange(ctx, async (sm) => {
                if (typeof on !== "boolean") throw new Error("Choose on or off");
                const name = pluginFile(file);
                if (!(await sm.setEnabled(name, on))) return;
                if (on) await loadPlugin(ctx, name);
                else await smLive(ctx, `sm plugins unload ${name}`);
            })),
            action(ids.pluginRemove, "Remove a plugin", (ctx, { file }) => modChange(ctx, async (sm) => {
                const name = pluginFile(file);
                await smLive(ctx, `sm plugins unload ${name}`);
                await sm.remove(name);
            })),
            action(ids.pluginUpload, "Add uploaded plugins", async (ctx, { stage }) => {
                const dir = path.join(await root(), addonStageDir(stage));
                let added: string[] = [];
                try {
                    const view = await modChange(ctx, async (sm) => {
                        if (!(await modsOn())) throw new Error("Turn SourceMod on before adding plugins");
                        added = await sm.upload(dir);
                        const enabled = new Set((await sm.list()).filter((p) => p.enabled).map((p) => p.file));
                        // a plugin of the same name that was running is replaced by the new one
                        for (const name of added) {
                            await smLive(ctx, `sm plugins unload ${name}`);
                            if (enabled.has(name)) await loadPlugin(ctx, name);
                        }
                    });
                    return { added, view };
                } finally { await fs.rm(dir, { recursive: true, force: true }); }
            }),
            action(ACTION_IDS.discardAddonUpload, "Discard upload", async (_ctx, { stage }) => { await fs.rm(path.join(await root(), addonStageDir(stage)), { recursive: true, force: true }); return true; }),
            action(ids.admin, "Make a player a SourceMod admin", (ctx, { steamId: raw, admin }) => modChange(ctx, async (sm) => {
                if (typeof admin !== "boolean") throw new Error("Choose admin or not");
                if (!(await modsOn())) throw new Error("Turn SourceMod on in Mods first");
                const id = steamId(raw);
                if (!isPlayer(id)) throw new Error("Only a Steam player can be an admin");
                await sm.setAdmin(id, admin);
                await smLive(ctx, "sm_reloadadmins");
            })),
            action(ids.maps, `${spec.name} maps`, async () => installedMaps(await gameDir())),
            action(ids.mapPictures, `${spec.name} map pictures`, async () => {
                if (!spec.mapPictures) throw new Error(`${spec.name} has no source of map pictures`);
                return mapPictures(spec.mapPictures);
            }),
            action(ids.mapCycle, `${spec.name} map rotation`, () => mapCycleView()),
            action(ids.mapCycleSet, "Set the map rotation", async (ctx, { maps }) => {
                if (local().busy) throw new Error(`Wait for the ${spec.name} operation to finish`);
                await refuseOverriddenCycle();
                // null hands the rotation back to the game's map cycle file
                await setRotation(ctx, maps === null ? null : checkRotation(maps, await installedMaps(await gameDir())));
                return mapCycleView();
            }),
            // setup's last choice: how the server plays. A mode makes its installed maps the rotation, the chosen map first
            // and the one the server starts on; no mode leaves the rotation to the game's map cycle
            action(ids.play, "Set how the server plays", async (ctx, { mode, map: raw }) => {
                if (local().busy) throw new Error(`Wait for the ${spec.name} operation to finish`);
                const installed = await installedMaps(await gameDir());
                const map = mapName(raw);
                if (!installed.includes(map)) throw new Error(`${map} is not installed`);
                let rotation: string[] | null = null;
                if (mode !== null) {
                    const chosen = playModes(spec, installed).find((m) => m.prefix === mode);
                    if (!chosen) throw new Error(`${spec.name} has no installed maps for that mode`);
                    if (!chosen.maps.includes(map)) throw new Error(`${map} is not a ${chosen.name} map`);
                    rotation = checkRotation([map, ...chosen.maps.filter((m) => m !== map)], installed);
                }
                if (rotation) await refuseOverriddenCycle();
                await setRotation(ctx, rotation, { map });
                await loadOptions(ctx);
                return mapCycleView();
            }),
            action(ids.changeMap, "Change map", async (ctx, { map: raw }) => {
                const map = mapName(raw);
                if (!(await findMap(await gameDir(), map))) throw new Error(`${map} is not installed`);
                const running = online(ctx);
                await updateSettings({ map });
                if (running) await rcon().exec(`changelevel ${map}`);
                await loadOptions(ctx);
                return { now: running };
            }),
        ]; },
        loadOptions,
        async initialize(ctx, running) {
            local().roster = new SourceRoster(await root());
            if (running) {
                // reattaching to a running server: talk to it with the password it started with
                const saved = await settings();
                const password = await rconPassword.value();
                if (!password) throw new Error(`${spec.name} is running without the RCON password Paperboard set; stop it from the computer and start it again here`);
                local().rcon = new SourceRcon(Number(saved.port ?? spec.defaultPort), password, spec.name);
                local().secrets = [password, await joinPassword.value(), await loginToken.value()].filter(Boolean);
                // the links are what the server started with: placeMods makes them only at a start
                local().modsActive = (await modsOn()) && (await isLinked(path.join(await gameDir(), "addons")));
                await readStatus(ctx).catch((err) => report(ctx, `Could not read who is on ${spec.name}`, err));
            } else await removeSecrets().catch((err) => report(ctx, `Could not remove ${spec.name}'s start passwords`, err));
        },
        async beforeRemove() { if (local().busy) throw new Error(`Wait for ${spec.name}'s current operation`); },
        async dispose() {
            if (local().statsTimer) clearTimeout(local().statsTimer!);
            local().statsTimer = null;
            local().unsaved.clear();
            local().counted.clear();
            local().rcon?.close();
            local().rcon = null;
            local().online.clear();
            local().modsActive = false;
            local().console.dispose();
        },
        async prepareLaunch() {
            assertHost(game);
            const saved = await settings();
            const install = await installDir();
            if (!(await installedBuild(spec.appId, install))) throw new Error(`Install ${spec.name} in Updates first`);
            const windows = process.platform === "win32";
            const binary = spec.binaries[windows ? "win32" : "linux"]!;
            const executable = path.join(install, binary.executable);
            await fs.access(executable, windows ? fs.constants.F_OK : fs.constants.X_OK);
            const map = mapName(optionValue(options.find((o) => o.id === "map")!, saved));
            if (!(await findMap(await gameDir(), map))) throw new Error(`The starting map ${map} is not installed; choose another on the Overview`);

            // Linux: Source holds its console output in a buffer when it isn't a terminal,
            // links libraries the computer may lack, and loads Steam's client library from ~/.steam/sdk64
            let linux: { stdbuf: string; env: Record<string, string> } | null = null;
            if (!windows) {
                const stdbuf = (await Promise.all(STDBUF.map(async (p) => ((await exists(p)) ? p : null)))).find(Boolean);
                if (!stdbuf) throw new Error(`${spec.name}'s console needs stdbuf from coreutils, which this computer doesn't have`);
                const libraries = await libraryPath(install);
                const home = path.join(await root(), "profile");
                const sdk = path.join(home, ".steam", "sdk64");
                await fs.mkdir(sdk, { recursive: true });
                await fs.copyFile(await steamClientLibrary(), path.join(sdk, "steamclient.so"));
                linux = { stdbuf, env: { HOME: home, XDG_DATA_HOME: home, LD_LIBRARY_PATH: libraries.join(":") } };
            }

            const rconSecret = await rconPassword.ensure();
            const join = await joinPassword.value();
            const token = await loginToken.value();
            await linkLogs();
            const modsActive = await placeMods();
            await writeConfigs();
            await writePrivate(await secretsFile(), secretsCfg({ rcon: rconSecret, join, token }));

            const port = Number(saved.port ?? spec.defaultPort);
            local().rcon?.close();
            local().rcon = new SourceRcon(port, rconSecret, spec.name);
            local().secrets = [rconSecret, join, token].filter(Boolean);
            local().online.clear();
            local().modsActive = modsActive;
            const internet = optionValue(options.find((o) => o.id === "internet")!, saved) !== false;
            const args = ["-game", spec.gameDir, "-console", "-ip", "0.0.0.0", "-port", String(port), "+clientport", String(Number(saved.clientPort ?? DEFAULT_CLIENT_PORT)), "-nohltv", "+maxplayers", String(Number(optionValue(options.find((o) => o.id === "maxplayers")!, saved))), "+sv_lan", internet ? "0" : "1", "+exec", "paperboard_secrets.cfg", "+map", map];
            return {
                message: `Starting ${spec.name}${saved.build ? ` build ${saved.build}` : ""}…`,
                command: linux
                    ? { executable: linux.stdbuf, args: ["-oL", "-eL", executable, ...args], cwd: install, env: linux.env }
                    // Windows: -console reads a real console and quits on a pipe; Paperboard talks over RCON
                    : { executable, args, cwd: install, env: {}, consoleInput: true },
            };
        },
        isMutating: () => local().busy,
        readiness: { timeoutMs: 300_000, async probe(ctx) {
            try { await readStatus(ctx); }
            catch (err) {
                // RCON listens once the map has loaded, and a reply lost to a
                // scanner's banned RCON attempt is asked for again
                if (err instanceof RconNoAnswer) return false;
                throw err;
            }
            await removeSecrets();
            return true;
        } },
        async saveWorld() { throw new Error(`${spec.name} keeps no world to save`); },
        stopTimeoutMs: 30_000, stopEntry: "quit",
        async stop(ctx) {
            // the server logs no one leaving as it quits
            await saveStats().catch((err) => report(ctx, "Could not save players' stats", err));
            try { await rcon().exec("quit"); }
            catch (err) {
                // the server closes the connection as it quits
                if (!(err instanceof RconError && /closed the RCON connection/.test(err.message))) throw err;
            }
        },
        commandLine(command) {
            if (/[\r\n\0]/.test(command)) throw new Error("A command must be a single line");
            if (/^\s*(rcon_password|quit|exit)\b/i.test(command)) throw new Error("Paperboard manages the RCON password; use Options for it and Stop to quit");
            return command.trim();
        },
        async sendCommand(_ctx, command) {
            // the server prints the reply to its console, which the console view shows
            await rcon().exec(command);
        },
        async sendChat(_ctx, message) {
            await rcon().exec(`say ${singleLine(message, "Message")}`);
        },
        observeLine(ctx, raw) {
            const line = redact(raw.replace(/\r/g, ""), local().secrets);
            // every line about a player names their team, kills and objectives too; status doesn't
            const subject = linePlayer(line);
            const known = subject?.team && subject.team !== "Unassigned" ? local().online.get(subject.userId) : undefined;
            if (known) known.team = subject!.team;
            const event = parseLogLine(line);
            if (event) observeEvent(ctx, event);
            if (!line.trim()) return;
            local().console.push(ctx, consoleLine(line));
        },
        async assertFileAccess(_ctx, file, write) {
            if (typeof file !== "string") throw new Error("Choose a file");
            if (file.endsWith("paperboard_secrets.cfg")) throw new Error(`That file holds ${spec.name}'s passwords while it starts`);
            if (write && (file === "install" || file.startsWith("install/"))) throw new Error(`Installed ${spec.name} files are managed by Updates. Put your own settings in server.cfg in the server folder.`);
            if (write && local().busy) throw new Error(`Wait for the ${spec.name} operation to finish`);
        },
        // short: the registry prefixes them with the server id and caps them at 32 characters
        portNames: ["game", "client"],
        async *ports(ctx) {
            const saved = await settings();
            yield settingPort({ name: "game", label: spec.name, protocol: "tcp+udp", key: "port", fallback: spec.defaultPort, onWrite: (port) => ctx.setState({ serverPort: String(port) }) }, saved);
            yield settingPort({ name: "client", label: `${spec.name} client`, protocol: "udp", key: "clientPort", fallback: DEFAULT_CLIENT_PORT }, saved);
        },
        backup: { mode: "quiesce", before: async () => {}, recover: async () => {}, withConsistentData: async (_ctx, work) => work() },
    };
}
