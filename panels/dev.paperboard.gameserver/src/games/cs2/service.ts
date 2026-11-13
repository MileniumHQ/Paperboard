import fs from "node:fs/promises";
import path from "node:path";
import { processApi } from "../../service/api";
import { emitTrigger, serverLocal } from "../../service/scope";
import { initialServerState } from "../../service/initialState";
import { appendCapped } from "../../service/types";
import { CALLS, TRIGGER_IDS } from "../../service/contract";
import { validateOptions } from "../options";
import { installedBuild, steamClientLibrary } from "../steam/steamcmd";
import { steamInstall, steamInstallCalls, steamUpdateStatus, type SteamInstallSpec } from "../steam/installAction";
import type { GameService } from "../serviceTypes";
import {
    ConsoleBuffer, assertHost, exists, linkFolder, pushChat, readSettings, redact, report,
    serverRoot, serverSecret, settingPort, settled, singleLine, updateSettings, writePrivate, type Context,
} from "../serviceKit";
import { sourceCalls, type SourceMetrics } from "../source";
import { cvarValue, mapName, optionValue } from "../source/config";
import { consoleLine, logBody, parseLogLine, steamId, isSteamId, type SourceLogEvent } from "../source/log";
import { noStats, SourceRoster, type SourceStats } from "../source/roster";
import type { SourceOnline } from "../source/service";
import { cs2, CS2, MODES, type Cs2Mode } from "./index";
import { activatedMap, consoleSaid, isErrorLine, parseStatusPlayers, STATUS_END, STATUS_PLAYERS, withoutPositions } from "./console";

const PROC = `${CS2.id}-server`;
const ids = sourceCalls(CS2.id);
const options = CS2.options;
const STDBUF = ["/usr/bin/stdbuf", "/bin/stdbuf"];
/** maps the server ships that are no place to play: menu backdrops and tools */
const NOT_PLAYABLE = /_vanity$|^lobby_mapveto$|^graphics_settings$/;
/** how long stats gather before they are written to the roster */
const STATS_FLUSH_MS = 15_000;

const local = serverLocal(() => ({
    busy: false,
    roster: null as SourceRoster | null,
    online: new Map<number, SourceOnline>(),
    /** the server has said its map is running */
    active: false,
    /** the player rows of a `status` answer being printed; null outside one */
    status: null as string[] | null,
    secrets: [] as string[],
    console: new ConsoleBuffer(isErrorLine),
    unsaved: new Map<string, Partial<SourceStats>>(),
    counted: new Map<number, number>(),
    statsTimer: null as ReturnType<typeof setTimeout> | null,
}));

// Layout: install/ is SteamCMD's folder, left out of backups; Paperboard's
// players, bans, logs and the user's own server.cfg sit beside it.
const installDir = async () => path.join(await serverRoot(), "install");
const gameDir = async () => path.join(await installDir(), CS2.gameDir);
const cfgDir = async () => path.join(await gameDir(), "cfg");
const secretsFile = async () => path.join(await cfgDir(), "paperboard_secrets.cfg");
const joinPassword = serverSecret(CS2.id, "join-password");
const loginToken = serverSecret(CS2.id, "login-token");
const vaulted = [["password", joinPassword], ["token", loginToken]] as const;

function roster() { const r = local().roster; if (!r) throw new Error("Counter-Strike 2's player list is not ready"); return r; }
const online = (ctx: Context) => settled(ctx, CS2.name);
/** One console command, written to the server's input. */
const send = (command: string) => processApi.write(PROC, `${singleLine(command, "Command")}\n`);

export function modeOf(saved: Record<string, unknown>) {
    const chosen = String(optionValue(options.find((o) => o.id === "gamemode")!, saved));
    if (!Object.hasOwn(MODES, chosen)) throw new Error(`Counter-Strike 2 has no game mode "${chosen}"`);
    return MODES[chosen as Cs2Mode];
}

/** The maps the server can start on: the .vpk files in its maps folder that are places to play. */
export async function installedMaps(game: string): Promise<string[]> {
    let entries: string[];
    try { entries = await fs.readdir(path.join(game, "maps")); }
    catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error("No maps folder; install the game in Updates first");
        throw err;
    }
    return entries.filter((e) => e.endsWith(".vpk")).map((e) => e.slice(0, -4)).filter((name) => !NOT_PLAYABLE.test(name)).sort();
}
const mapAvailable = async (map: string) => (await installedMaps(await gameDir())).includes(map);

async function loadOptions(ctx: Context) {
    const saved = await readSettings();
    const values: Record<string, unknown> = {};
    for (const option of options) {
        if (option.kind === "secret") continue;
        const value = optionValue(option, saved);
        if (value !== undefined) values[option.id] = value;
    }
    for (const [id, secret] of vaulted) values[id] = await secret.found();
    ctx.setState({ serverSoftware: CS2.id, serverVersion: saved.build ? `Build ${saved.build}` : "", serverPort: String(values.port ?? CS2.defaultPort), gameSettings: values });
}

/**
 * The settings the server runs. server.cfg turns the game log on; the game
 * runs the mode's own config after it, which would undo any gameplay setting
 * there, so those go in `gamemode_<mode>_server.cfg`, which the game runs
 * last. A server.cfg the user keeps in the server folder follows as
 * paperboard_user.cfg, so it has the last word.
 */
export function configFiles(saved: Record<string, unknown>, user: boolean): Record<string, string> {
    const header = "// Written by Paperboard at each start. Edit Options, or server.cfg in the server folder.";
    const lines = [header];
    for (const option of options) {
        if (!option.cvar) continue;
        const value = optionValue(option, saved);
        if (value !== undefined) lines.push(`${option.cvar} ${cvarValue(value, option.label)}`);
    }
    if (user) lines.push("exec paperboard_user.cfg");
    return {
        "server.cfg": `${[header, "log on", "sv_logecho 1"].join("\n")}\n`,
        [`gamemode_${modeOf(saved).cfg}_server.cfg`]: `${lines.join("\n")}\n`,
    };
}
async function writeConfigs() {
    const dir = await cfgDir();
    await fs.mkdir(dir, { recursive: true });
    const user = path.join(await serverRoot(), "server.cfg");
    const hasUser = await exists(user);
    if (hasUser) await fs.copyFile(user, path.join(dir, "paperboard_user.cfg"));
    else await fs.rm(path.join(dir, "paperboard_user.cfg"), { force: true });
    for (const [name, text] of Object.entries(configFiles(await readSettings(), hasUser))) await fs.writeFile(path.join(dir, name), text);
}
const removeSecrets = async () => fs.rm(await secretsFile(), { force: true });
const linkLogs = async () => linkFolder(path.join(await gameDir(), "logs"), path.join(await serverRoot(), "logs"));

function setOnline(ctx: Context) {
    const humans = [...local().online.values()].filter((p) => p.steamId !== "BOT" && p.name);
    ctx.setState((prev) => ({
        onlinePlayers: humans.map((p) => p.name),
        seenPlayers: humans.reduce((seen, p) => (seen.includes(p.name) ? seen : appendCapped(seen, p.name)), prev.seenPlayers),
    }));
}

function unsaved(id: string): Partial<SourceStats> {
    const stats = local().unsaved.get(id) ?? {};
    local().unsaved.set(id, stats);
    return stats;
}
function countPlaytime(player: SourceOnline, now = Date.now()) {
    const from = local().counted.get(player.userId) ?? now;
    local().counted.set(player.userId, now);
    if (!isSteamId(player.steamId) || now <= from) return;
    player.stats.playtime += now - from;
    unsaved(player.steamId).playtime = (unsaved(player.steamId).playtime ?? 0) + now - from;
}
async function saveStats() {
    if (local().statsTimer) clearTimeout(local().statsTimer!);
    local().statsTimer = null;
    const now = Date.now();
    for (const player of local().online.values()) countPlaytime(player, now);
    const stats = local().unsaved;
    local().unsaved = new Map();
    await roster().addStats(stats);
}
function bump(ctx: Context, userId: number, key: "kills" | "deaths" | "assists") {
    const player = local().online.get(userId);
    if (!player) return;
    player.stats[key] += 1;
    if (!isSteamId(player.steamId)) return;
    unsaved(player.steamId)[key] = (unsaved(player.steamId)[key] ?? 0) + 1;
    if (!local().statsTimer) local().statsTimer = setTimeout(() => {
        local().statsTimer = null;
        saveStats().catch((err) => report(ctx, "Could not save players' stats", err));
    }, STATS_FLUSH_MS);
}

/**
 * A banned player is put out the moment they connect. Counter-Strike 2's own
 * `banid` prints nothing and lists nothing, so whether it holds can't be
 * seen; Paperboard's list is what bans.
 */
async function enforceBan(ctx: Context, player: { userId: number; steamId: string; name: string }) {
    if (!(await roster().bans()).some((ban) => ban.steamId === player.steamId)) return;
    await send(`kickid ${player.userId} Banned from this server`);
    ctx.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type: "warn", content: `[Paperboard] ${player.name} is banned and was put out as they joined.` }) }));
}

function observeEvent(ctx: Context, event: SourceLogEvent) {
    const players = local().online;
    switch (event.kind) {
        case "connected": {
            const p = event.player;
            const now = Date.now();
            players.set(p.userId, { userId: p.userId, name: p.name, steamId: p.steamId, team: p.team, since: now, stats: noStats() });
            local().counted.set(p.userId, now);
            setOnline(ctx);
            if (isSteamId(p.steamId)) {
                pushChat(ctx, { event: "join", sender: p.name, text: `${p.name} joined the game` });
                emitTrigger(ctx, TRIGGER_IDS.playerJoined, p.name);
                roster().remember(p.steamId, p.name).catch((err) => report(ctx, `Could not record ${p.name}`, err));
                enforceBan(ctx, p).catch((err) => report(ctx, `Could not put the banned player ${p.name} out`, err));
            }
            return;
        }
        case "disconnected": {
            const p = event.player;
            const known = players.get(p.userId);
            if (known) countPlaytime(known);
            players.delete(p.userId);
            local().counted.delete(p.userId);
            setOnline(ctx);
            const name = p.name || known?.name || "";
            if (isSteamId(p.steamId) && name) {
                pushChat(ctx, { event: "leave", sender: name, text: `${name} left the game` });
                emitTrigger(ctx, TRIGGER_IDS.playerLeft, name);
                roster().remember(p.steamId, name).catch((err) => report(ctx, `Could not record ${name} leaving`, err));
                saveStats().catch((err) => report(ctx, `Could not save ${name}'s stats`, err));
            }
            return;
        }
        case "kill":
            if (event.player.userId !== event.victim.userId) bump(ctx, event.player.userId, "kills");
            bump(ctx, event.victim.userId, "deaths");
            return;
        case "suicide": bump(ctx, event.player.userId, "deaths"); return;
        case "assist": bump(ctx, event.player.userId, "assists"); return;
        case "say": {
            const p = event.player;
            if (p.steamId === "BOT") return;
            const text = event.team ? `(Team) ${event.text}` : event.text;
            emitTrigger(ctx, TRIGGER_IDS.chatMessage, pushChat(ctx, { sender: p.name, content: text, text: `<${p.name}> ${text}` }));
            return;
        }
        default: return;
    }
}

/** A `status` answer's player rows: who is on by the server's own count, for a server Paperboard found running or just started. */
function applyStatus(ctx: Context, rows: readonly string[]) {
    const listed = parseStatusPlayers(rows);
    const players = local().online;
    const now = Date.now();
    for (const id of [...players.keys()]) if (!listed.some((p) => p.userId === id)) { players.delete(id); local().counted.delete(id); }
    for (const p of listed) {
        // status names no Steam id: a person's is known once the game log names them
        if (!players.has(p.userId)) players.set(p.userId, { userId: p.userId, name: p.name, steamId: p.bot ? "BOT" : "", team: "", since: now, stats: noStats() });
        if (!local().counted.has(p.userId)) local().counted.set(p.userId, now);
    }
    setOnline(ctx);
}

const steam: SteamInstallSpec = {
    game: cs2, appId: CS2.appId, ids: { info: ids.info, latest: ids.latest, install: ids.install },
    installDir, flag: local, loadOptions,
    async afterInstall() { await linkLogs(); await writeConfigs(); },
};

export const cs2Service: GameService = {
    primaryProcessId: PROC, processIds: [PROC],
    backupExclude: ["install"],
    updateStatus: () => steamUpdateStatus(steam),
    installUpdate: steamInstall(steam),
    initialState: () => ({ ...initialServerState(), serverSoftware: CS2.id, serverPort: String(CS2.defaultPort), serverMotd: "" }),
    blocks: async (ctx) => {
        const { mergeBlocks, onlyIdNamed, playerEvents, rosterBlocks, runGameCall } = await import("../../service/blocks");
        const people = () => [...local().online.values()].filter((p) => p.steamId !== "BOT");
        const nameOf = (p: { name: string }) => p.name;
        const steamOf = (p: { steamId: string }) => p.steamId;
        return mergeBlocks({ events: playerEvents() }, rosterBlocks({
            kick: (name) => runGameCall(ctx, ids.kick, { userId: onlyIdNamed(name, [...local().online.values()], nameOf, (p) => String(p.userId), "online") }),
            ban: async (name) => runGameCall(ctx, ids.ban, { steamId: onlyIdNamed(name, [...people(), ...await roster().seen()], nameOf, steamOf, "on this server") }),
            unban: async (name) => {
                const bans = await roster().bans();
                const byId = bans.find((ban) => ban.steamId === name);
                return runGameCall(ctx, ids.unban, { steamId: byId ? byId.steamId : onlyIdNamed(name, bans, nameOf, steamOf, "banned") });
            },
            banned: async () => (await roster().bans()).map((ban) => ban.name || ban.steamId),
        }));
    },
    calls: async () => { const { sharedCalls } = await import("../../service/calls"); return { ...sharedCalls,
        [CALLS.readGameOptions]: async (ctx) => { await loadOptions(ctx); return ctx.state.gameSettings; },
        [CALLS.writeGameOptions]: async (ctx, { patch }) => {
            if (local().busy) throw new Error("Wait for the Counter-Strike 2 operation to finish");
            if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Options patch is required");
            const next = validateOptions(options, CS2.name, patch, await readSettings());
            if (Object.hasOwn(patch, "map") && !(await mapAvailable(mapName(patch.map)))) throw new Error(`${patch.map} is not installed`);
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
                for (const line of live) await send(line);
            }
            if (await exists(await installDir())) await writeConfigs();
            await loadOptions(ctx);
            return ctx.state.gameSettings;
        },
        ...steamInstallCalls(steam),
        [ids.metrics]: async (): Promise<SourceMetrics> => ({ bots: [...local().online.values()].filter((p) => p.steamId === "BOT").length }),
        [ids.players]: async () => {
            await saveStats();
            // no SourceMod here: the Players tab has no admin list to show
            return { seen: await roster().seen(), bans: await roster().bans(), online: [...local().online.values()], admins: null };
        },
        [ids.kick]: async (ctx, { userId }) => {
            if (!online(ctx)) throw new Error("Counter-Strike 2 is not running");
            const player = local().online.get(Number(userId));
            if (!player) throw new Error("That player is not online");
            await send(`kickid ${player.userId} Kicked by the server admin`);
            return true;
        },
        [ids.ban]: async (ctx, { steamId: raw }) => {
            const id = steamId(raw);
            await roster().ban(id);
            if (online(ctx)) for (const player of local().online.values()) if (player.steamId === id) await send(`kickid ${player.userId} Banned from this server`);
            return true;
        },
        [ids.unban]: async (_ctx, { steamId: raw }) => {
            await roster().unban(steamId(raw));
            return true;
        },
        [ids.maps]: async () => installedMaps(await gameDir()),
        [ids.changeMap]: async (ctx, { map: raw }) => {
            const map = mapName(raw);
            if (!(await mapAvailable(map))) throw new Error(`${map} is not installed`);
            const running = online(ctx);
            await updateSettings({ map });
            if (running) await send(`changelevel ${map}`);
            await loadOptions(ctx);
            return { now: running };
        },
    }; },
    loadOptions,
    async initialize(ctx, running) {
        local().roster = new SourceRoster(await serverRoot());
        if (running) {
            // reattaching to a running server: it is asked who is on, and its passwords are hidden again
            local().active = true;
            local().secrets = [await joinPassword.value(), await loginToken.value()].filter(Boolean);
            ctx.setState({ maxPlayers: Number(optionValue(options.find((o) => o.id === "maxplayers")!, await readSettings())) });
            await send("status").catch((err) => report(ctx, "Could not ask Counter-Strike 2 who is on", err));
        } else await removeSecrets().catch((err) => report(ctx, "Could not remove Counter-Strike 2's start passwords", err));
    },
    async beforeRemove() { if (local().busy) throw new Error("Wait for Counter-Strike 2's current operation"); },
    async dispose() {
        if (local().statsTimer) clearTimeout(local().statsTimer!);
        local().statsTimer = null;
        local().unsaved.clear();
        local().counted.clear();
        local().online.clear();
        local().console.dispose();
    },
    async prepareLaunch() {
        assertHost(cs2);
        const saved = await readSettings();
        const install = await installDir();
        if (!(await installedBuild(CS2.appId, install))) throw new Error("Install Counter-Strike 2 in Updates first");
        const binary = CS2.binaries.linux!;
        const executable = path.join(install, binary.executable);
        await fs.access(executable, fs.constants.X_OK);
        const map = mapName(optionValue(options.find((o) => o.id === "map")!, saved));
        if (!(await mapAvailable(map))) throw new Error(`The starting map ${map} is not installed; choose another on the Overview`);
        const mode = modeOf(saved);
        // the server holds its output in a buffer when it isn't a terminal, and loads Steam's client library from ~/.steam/sdk64
        const stdbuf = (await Promise.all(STDBUF.map(async (p) => ((await exists(p)) ? p : null)))).find(Boolean);
        if (!stdbuf) throw new Error("Counter-Strike 2's console needs stdbuf from coreutils, which this computer doesn't have");
        const home = path.join(await serverRoot(), "profile");
        const sdk = path.join(home, ".steam", "sdk64");
        await fs.mkdir(sdk, { recursive: true });
        await fs.copyFile(await steamClientLibrary(), path.join(sdk, "steamclient.so"));

        const join = await joinPassword.value();
        const token = await loginToken.value();
        await linkLogs();
        await writeConfigs();
        const secrets = [`sv_password ${cvarValue(join, "Join password")}`];
        if (token) secrets.push(`sv_setsteamaccount ${cvarValue(token, "Game server login token")}`);
        await writePrivate(await secretsFile(), `${secrets.join("\n")}\n`);
        local().secrets = [join, token].filter(Boolean);
        local().online.clear();
        local().active = false;
        local().status = null;
        const internet = optionValue(options.find((o) => o.id === "internet")!, saved) !== false;
        const args = [
            "-dedicated", "-console", "-ip", "0.0.0.0", "-port", String(Number(saved.port ?? CS2.defaultPort)),
            "-maxplayers", String(Number(optionValue(options.find((o) => o.id === "maxplayers")!, saved))),
            "+game_type", String(mode.type), "+game_mode", String(mode.mode), "+sv_lan", internet ? "0" : "1",
            "+exec", "paperboard_secrets.cfg", "+map", map,
        ];
        return {
            message: `Starting Counter-Strike 2${saved.build ? ` build ${saved.build}` : ""}…`,
            command: { executable: stdbuf, args: ["-oL", "-eL", executable, ...args], cwd: path.dirname(executable), env: { HOME: home, XDG_DATA_HOME: home, LD_LIBRARY_PATH: path.join(install, binary.libraryDir) } },
        };
    },
    async afterStop(ctx) {
        await saveStats().catch((err) => report(ctx, "Could not save players' stats", err));
        await removeSecrets();
    },
    isMutating: () => local().busy,
    // the server's own line says when its map is running; a 70 GB game on a slow disk takes its time
    readiness: { timeoutMs: 600_000, async probe(ctx) {
        if (!local().active) return false;
        ctx.setState({ maxPlayers: Number(optionValue(options.find((o) => o.id === "maxplayers")!, await readSettings())) });
        await removeSecrets();
        await send("status");
        return true;
    } },
    async saveWorld() { throw new Error("Counter-Strike 2 keeps no world to save"); },
    stopTimeoutMs: 30_000, stopEntry: "quit",
    stop: () => send("quit"),
    commandLine(command) {
        const line = singleLine(command, "Command").trim();
        if (/^(quit|exit|rcon_password|sv_setsteamaccount)\b/i.test(line)) throw new Error("Paperboard keeps the server's passwords and stops it; use Options and Stop");
        return `${line}\n`;
    },
    sendChat: (_ctx, message) => send(`say ${singleLine(message, "Message")}`),
    observeLine(ctx, raw) {
        const line = redact(raw.replace(/\r/g, ""), local().secrets);
        if (!line.trim()) return;
        const map = activatedMap(line);
        if (map) { local().active = true; ctx.setState({ serverLevel: map }); }
        // a status answer's player rows are read between its two markers
        if (line.trim() === STATUS_PLAYERS) local().status = [];
        else if (local().status && line.trim() === STATUS_END) { applyStatus(ctx, local().status!); local().status = null; }
        else if (local().status) local().status!.push(line);
        const body = logBody(line);
        if (body !== null) {
            const said = consoleSaid(body);
            if (said !== null) pushChat(ctx, { event: "server", content: said, text: `<Server> ${said}` });
            else {
                const event = parseLogLine(withoutPositions(line));
                if (event) observeEvent(ctx, event);
            }
        }
        local().console.push(ctx, consoleLine(line));
    },
    async assertFileAccess(_ctx, file, write) {
        if (typeof file !== "string") throw new Error("Choose a file");
        if (file.endsWith("paperboard_secrets.cfg")) throw new Error("That file holds Counter-Strike 2's passwords while it starts");
        if (write && (file === "install" || file.startsWith("install/"))) throw new Error("Installed Counter-Strike 2 files are managed by Updates. Put your own settings in server.cfg in the server folder.");
        if (write && local().busy) throw new Error("Wait for the Counter-Strike 2 operation to finish");
    },
    portNames: ["game"],
    async *ports(ctx) {
        yield settingPort({ name: "game", label: CS2.name, protocol: "tcp+udp", key: "port", fallback: CS2.defaultPort, onWrite: (port) => ctx.setState({ serverPort: String(port) }) }, await readSettings());
    },
    // the server keeps no world; its files copy as it runs
    backup: { mode: "quiesce", before: async () => {}, recover: async () => {}, withConsistentData: async (_ctx, work) => work() },
};
