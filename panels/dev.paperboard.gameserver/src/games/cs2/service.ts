import type { Server } from "../../service/server";
import fs from "node:fs/promises";
import path from "node:path";
import { errorCode } from "../../service/api";
import { initialServerState } from "../../service/initialState";
import { appendCapped } from "../../service/types";
import { validateOptions } from "../options";
import { installedBuild, steamClientLibrary } from "../steam/steamcmd";
import { steamInstall, steamInstallCalls, steamUpdateStatus, type SteamInstallSpec } from "../steam/installAction";
import type { GameService } from "../serviceTypes";
import {
    ConsoleBuffer, assertHost, exists, linkFolder, pushChat, redact, report, serverSecret, settingPort, settled, singleLine, writePrivate,
} from "../serviceKit";
import { SOURCE_CALLS, type SourceMetrics } from "../source";
import { cvarValue, mapName, optionValue } from "../source/config";
import { consoleLine, logBody, parseLogLine, steamId, isSteamId } from "../source/log";
import { SourceRoster } from "../source/roster";
import { playerBlocks, SourcePlayers } from "../source/people";
import { installMapPicture } from "../source/installPictures";
import { cs2, CS2, MODES, type Cs2Mode } from "./index";
import { activatedMap, consoleSaid, isErrorLine, parseStatusPlayers, STATUS_END, STATUS_PLAYERS, withoutPositions } from "./console";

const PROC = `${CS2.id}-server`;
const ids = SOURCE_CALLS;
const options = CS2.options;
const STDBUF = ["/usr/bin/stdbuf", "/bin/stdbuf"];
/** maps the server ships that are no place to play: menu backdrops and tools */
const NOT_PLAYABLE = /_vanity$|^lobby_mapveto$|^graphics_settings$/;

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
        if (errorCode(err) === "ENOENT") throw new Error("No maps folder; install the game in Updates first");
        throw err;
    }
    return entries.filter((e) => e.endsWith(".vpk")).map((e) => e.slice(0, -4)).filter((name) => !NOT_PLAYABLE.test(name)).sort();
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

/** One server's part of the game: its process, console, settings files and players are its own. */
export function cs2Service(ctx: Server): GameService {
    const local = {
        busy: false,
        roster: null as SourceRoster | null,
        /** the server has said its map is running */
        active: false,
        /** the player rows of a `status` answer being printed; null outside one */
        status: null as string[] | null,
        secrets: [] as string[],
        console: new ConsoleBuffer(isErrorLine),
    };

    // Layout: install/ is SteamCMD's folder, left out of backups; Paperboard's
    // players, bans, logs and the user's own server.cfg sit beside it.
    const installDir = async () => path.join(await ctx.root(), "install");
    const gameDir = async () => path.join(await installDir(), CS2.gameDir);
    const cfgDir = async () => path.join(await gameDir(), "cfg");
    const secretsFile = async () => path.join(await cfgDir(), "paperboard_secrets.cfg");
    const joinPassword = serverSecret(ctx, CS2.id, "join-password");
    const loginToken = serverSecret(ctx, CS2.id, "login-token");
    const vaulted = [["password", joinPassword], ["token", loginToken]] as const;

    function roster() { const r = local.roster; if (!r) throw new Error("Counter-Strike 2's player list is not ready"); return r; }
    const online = () => settled(ctx, CS2.name);
    /** One console command, written to the server's input. */
    const send = (command: string) => ctx.process.write(PROC, `${singleLine(command, "Command")}\n`);

    const mapAvailable = async (map: string) => (await installedMaps(await gameDir())).includes(map);

    async function loadOptions() {
        const saved = ctx.settings;
        const values: Record<string, unknown> = {};
        for (const option of options) {
            if (option.kind === "secret") continue;
            const value = optionValue(option, saved);
            if (value !== undefined) values[option.id] = value;
        }
        for (const [id, secret] of vaulted) values[id] = await secret.found();
        ctx.setState({ serverSoftware: CS2.id, serverVersion: saved.build ? `Build ${saved.build}` : "", serverPort: String(values.port ?? CS2.defaultPort), gameSettings: values });
    }

    async function writeConfigs() {
        const dir = await cfgDir();
        await fs.mkdir(dir, { recursive: true });
        const user = path.join(await ctx.root(), "server.cfg");
        const hasUser = await exists(user);
        if (hasUser) await fs.copyFile(user, path.join(dir, "paperboard_user.cfg"));
        else await fs.rm(path.join(dir, "paperboard_user.cfg"), { force: true });
        for (const [name, text] of Object.entries(configFiles(ctx.settings, hasUser))) await fs.writeFile(path.join(dir, name), text);
    }
    const removeSecrets = async () => fs.rm(await secretsFile(), { force: true });
    const linkLogs = async () => linkFolder(path.join(await gameDir(), "logs"), path.join(await ctx.root(), "logs"));

    const players = new SourcePlayers({
        server: ctx, roster, isPlayer: (id) => isSteamId(id),
        /**
         * A banned player is put out the moment they connect. Counter-Strike 2's own
         * `banid` prints nothing and lists nothing, so whether it holds can't be
         * seen; Paperboard's list is what bans.
         */
        async joined(player) {
            if (!(await roster().bans()).some((ban) => ban.steamId === player.steamId)) return;
            await send(`kickid ${player.userId} Banned from this server`);
            ctx.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type: "warn", content: `[Paperboard] ${player.name} is banned and was put out as they joined.` }) }));
        },
    });

    /** A `status` answer's player rows: who is on by the server's own count, for a server Paperboard found running or just started. */
    async function applyStatus(rows: readonly string[]) {
        const now = Date.now();
        // status names no Steam id: a person's is known once the game log names them
        await players.present(parseStatusPlayers(rows).map((p) => ({ userId: p.userId, name: p.name, steamId: p.bot ? "BOT" : "", since: now })));
    }

    const steam: SteamInstallSpec = {
        game: cs2, appId: CS2.appId,
        installDir, flag: () => local, loadOptions,
        async afterInstall() { await linkLogs(); await writeConfigs(); },
    };
    const install = steamInstall(ctx, steam);

    return {
        primaryProcessId: PROC, processIds: [PROC],
        backupExclude: ["install"],
        updateStatus: () => steamUpdateStatus(steam),
        installUpdate: install,
        initialState: () => ({ ...initialServerState(), serverSoftware: CS2.id, serverPort: String(CS2.defaultPort), serverMotd: "" }),
        blocks: () => playerBlocks({ server: ctx, roster, players }),
        calls: async () => { const { sharedCalls } = await import("../../service/calls"); return { ...sharedCalls,
            readGameOptions: async (ctx) => { await loadOptions(); return ctx.state.gameSettings; },
            writeGameOptions: async (ctx, { patch }) => {
                if (local.busy) throw new Error("Wait for the Counter-Strike 2 operation to finish");
                if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Options patch is required");
                const next = validateOptions(options, CS2.name, patch, ctx.settings);
                if (Object.hasOwn(patch, "map") && !(await mapAvailable(mapName(patch.map)))) throw new Error(`${patch.map} is not installed`);
                // refuse what a console line can't hold before anything is saved
                for (const option of options) if (Object.hasOwn(patch, option.id) && (option.cvar || option.kind === "secret") && patch[option.id] !== "") cvarValue(patch[option.id], option.label);
                const live: string[] = [];
                for (const option of options) {
                    if (!Object.hasOwn(patch, option.id) || option.restartRequired) continue;
                    if (option.cvar) live.push(`${option.cvar} ${cvarValue(patch[option.id], option.label)}`);
                    if (option.id === "password") live.push(`sv_password ${cvarValue(patch.password, option.label)}`);
                }
                for (const [id, secret] of vaulted) if (Object.hasOwn(patch, id)) await secret.set(String(patch[id]));
                await ctx.updateSettings(next);
                if (ctx.state.serverStatus === "online") {
                    if (Object.hasOwn(patch, "password")) local.secrets = [...local.secrets, String(patch.password)].filter(Boolean);
                    for (const line of live) await send(line);
                }
                if (await exists(await installDir())) await writeConfigs();
                await loadOptions();
                return ctx.state.gameSettings;
            },
            ...steamInstallCalls(steam, install),
            [ids.metrics]: async (): Promise<SourceMetrics> => ({ bots: [...players.online.values()].filter((p) => p.steamId === "BOT").length }),
            [ids.players]: async () => {
                await players.saveStats();
                // no SourceMod here: the Players tab has no admin list to show
                return { seen: await roster().seen(), bans: await roster().bans(), online: [...players.online.values()], admins: null };
            },
            [ids.kick]: async (ctx, { userId }) => {
                if (!online()) throw new Error("Counter-Strike 2 is not running");
                const player = players.online.get(userId);
                if (!player) throw new Error("That player is not online");
                await send(`kickid ${player.userId} Kicked by the server admin`);
                return true;
            },
            [ids.ban]: async (ctx, { steamId: raw }) => {
                const id = steamId(raw);
                await roster().ban(id);
                if (online()) for (const player of players.online.values()) if (player.steamId === id) await send(`kickid ${player.userId} Banned from this server`);
                return true;
            },
            [ids.unban]: async (_ctx, { steamId: raw }) => {
                await roster().unban(steamId(raw));
                return true;
            },
            [ids.maps]: async () => installedMaps(await gameDir()),
            [ids.mapPicture]: async (_ctx, { map }) => installMapPicture(await gameDir(), CS2.installPictures!, String(map ?? "")),
            [ids.changeMap]: async (ctx, { map: raw }) => {
                const map = mapName(raw);
                if (!(await mapAvailable(map))) throw new Error(`${map} is not installed`);
                const running = online();
                await ctx.updateSettings({ map });
                if (running) await send(`changelevel ${map}`);
                await loadOptions();
                return { now: running };
            },
        }; },
        loadOptions,
        async initialize(running) {
            local.roster = new SourceRoster(await ctx.root());
            if (running) {
                // reattaching to a running server: it is asked who is on, and its passwords are hidden again
                local.active = true;
                local.secrets = [await joinPassword.value(), await loginToken.value()].filter(Boolean);
                ctx.setState({ maxPlayers: Number(optionValue(options.find((o) => o.id === "maxplayers")!, ctx.settings)) });
                await send("status").catch((err) => report(ctx, "Could not ask Counter-Strike 2 who is on", err));
            } else await removeSecrets().catch((err) => report(ctx, "Could not remove Counter-Strike 2's start passwords", err));
        },
        async beforeRemove() { if (local.busy) throw new Error("Wait for Counter-Strike 2's current operation"); },
        async dispose() {
            players.dispose();
            local.console.dispose();
        },
        async prepareLaunch() {
            assertHost(cs2);
            const saved = ctx.settings;
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
            const home = path.join(await ctx.root(), "profile");
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
            local.secrets = [join, token].filter(Boolean);
            players.online.clear();
            local.active = false;
            local.status = null;
            const internet = optionValue(options.find((o) => o.id === "internet")!, saved) !== false;
            const args = [
                "-dedicated", "-console", "-ip", "0.0.0.0", "-port", String(ctx.runPort("game", Number(saved.port ?? CS2.defaultPort))),
                "-maxplayers", String(Number(optionValue(options.find((o) => o.id === "maxplayers")!, saved))),
                "+game_type", String(mode.type), "+game_mode", String(mode.mode), "+sv_lan", internet ? "0" : "1",
                "+exec", "paperboard_secrets.cfg", "+map", map,
            ];
            return {
                message: `Starting Counter-Strike 2${saved.build ? ` build ${saved.build}` : ""}…`,
                command: { executable: stdbuf, args: ["-oL", "-eL", executable, ...args], cwd: path.dirname(executable), env: { HOME: home, XDG_DATA_HOME: home, LD_LIBRARY_PATH: path.join(install, binary.libraryDir) } },
            };
        },
        async afterStop() {
            await players.saveStats().catch((err) => report(ctx, "Could not save players' stats", err));
            await removeSecrets();
        },
        isMutating: () => local.busy,
        // the server's own line says when its map is running; a 70 GB game on a slow disk takes its time
        readiness: { timeoutMs: 600_000, async probe() {
            if (!local.active) return false;
            ctx.setState({ maxPlayers: Number(optionValue(options.find((o) => o.id === "maxplayers")!, ctx.settings)) });
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
        sendChat: (message) => send(`say ${singleLine(message, "Message")}`),
        observeLine(raw) {
            const line = redact(raw.replace(/\r/g, ""), local.secrets);
            if (!line.trim()) return;
            const map = activatedMap(line);
            if (map) { local.active = true; ctx.setState({ serverLevel: map }); }
            // a status answer's player rows are read between its two markers
            if (line.trim() === STATUS_PLAYERS) local.status = [];
            else if (local.status && line.trim() === STATUS_END) {
                applyStatus(local.status).catch((err) => report(ctx, "Could not read who is on Counter-Strike 2", err));
                local.status = null;
            }
            else if (local.status) local.status!.push(line);
            const body = logBody(line);
            if (body !== null) {
                const said = consoleSaid(body);
                if (said !== null) pushChat(ctx, { event: "server", content: said, text: `<Server> ${said}` });
                else {
                    const event = parseLogLine(withoutPositions(line));
                    if (event) players.observe(event);
                }
            }
            local.console.push(ctx, consoleLine(line));
        },
        async assertFileAccess(file, write) {
            if (typeof file !== "string") throw new Error("Choose a file");
            if (file.endsWith("paperboard_secrets.cfg")) throw new Error("That file holds Counter-Strike 2's passwords while it starts");
            if (write && (file === "install" || file.startsWith("install/"))) throw new Error("Installed Counter-Strike 2 files are managed by Updates. Put your own settings in server.cfg in the server folder.");
            if (write && local.busy) throw new Error("Wait for the Counter-Strike 2 operation to finish");
        },
        portNames: ["game"],
        async *ports() {
            yield settingPort({ name: "game", label: CS2.name, protocol: "tcp+udp", key: "port", fallback: CS2.defaultPort }, ctx.settings);
        },
        // the server keeps no world; its files copy as it runs
        backup: { mode: "quiesce", before: async () => {}, recover: async () => {}, withConsistentData: (work) => work() },
    };
}
