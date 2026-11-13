import fs from "node:fs/promises";
import path from "node:path";
import { randomInt } from "node:crypto";
import { emitTrigger, serverLocal } from "../../service/scope";
import { initialServerState } from "../../service/initialState";
import { appendCapped } from "../../service/types";
import { CALLS, TRIGGER_IDS } from "../../service/contract";
import { validateOptions } from "../options";
import { installedBuild } from "../steam/steamcmd";
import { steamInstall, steamInstallCalls, steamUpdateStatus, type SteamInstallSpec } from "../steam/installAction";
import type { GameService } from "../serviceTypes";
import {
    ConsoleBuffer, assertHost, exclusive, exists, fileStamp, linkFolder, offlineBackup, pushChat, readSettings, redact, report,
    resumeAfterBackup, serverRoot, serverSecret, settingPort, settled, singleLine, updateSettings, waitUntil, type Context,
} from "../serviceKit";
import { trashDirName } from "../../service/trash";
import { rust, options, RUST_APP_ID, type RustMapView, type RustOption } from "./index";
import { parseInfo, parsePlayers, RustRcon, RustRconSilent, type RustChat, type RustInfo, type RustPlayer } from "./webrcon";
import { parseBanList, parseBansCfg, RustRoster, steamId, type RustBan } from "./roster";
import { renderScale, worldPicture } from "./mapPicture";

const GAME = "rust";
const PROC = "rust-server";
const DEFAULT_PORT = 28015;
const DEFAULT_QUERY_PORT = 28017;
const DEFAULT_RCON_PORT = 28016;
const DEFAULT_APP_PORT = 28082;
/** the folder under server/ that holds this server's map, saves and lists */
const IDENTITY = "paperboard";
const POLL_MS = 5_000;
/** the line the server prints once its map is loaded and players can join */
const STARTED = "Server startup complete";
const BANS_NEED_SERVER = "Start the server to ban or unban players; Rust keeps its own ban list";

const local = serverLocal(() => ({
    busy: false,
    rcon: null as RustRcon | null,
    roster: null as RustRoster | null,
    poll: null as ReturnType<typeof setInterval> | null,
    online: [] as RustPlayer[],
    // the first answer after reattaching lists who was already there; they did not just join
    baseline: false,
    pollError: "",
    /** the server has printed that it finished starting */
    started: false,
    secrets: [] as string[],
    console: new ConsoleBuffer((line) => /^(Error|Exception|\w*Exception:)|\bfailed\b/i.test(line)),
}));

// Layout: install/ is SteamCMD's folder and is left out of backups; the game
// writes its map, saves and lists to install/server, which links to server/
// beside it so they are backed up and survive an update.
const installDir = async () => path.join(await serverRoot(), "install");
const dataDir = async () => path.join(await serverRoot(), "server");
const identityDir = async () => path.join(await dataDir(), IDENTITY);
const linkData = async () => linkFolder(path.join(await installDir(), "server"), await dataDir());
const rconPassword = serverSecret(GAME, "rcon-password");

/**
 * A value as one command-line argument. Rust reads an argument that begins
 * with + or - as the next setting's name, and ends a value at a quote.
 */
export function argValue(value: unknown, label: string): string {
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    const text = singleLine(value, label);
    if (text.includes('"')) throw new Error(`${label} can't hold quotes`);
    if (/^\s*[+-]/.test(text)) throw new Error(`${label} can't begin with + or -`);
    return text;
}
/** The same value in a console command, where text is quoted. */
const consoleValue = (value: unknown, label: string) => (typeof value === "string" ? `"${argValue(value, label)}"` : argValue(value, label));

/** What Rust's remote console takes for a password, which travels in its address. */
export function rconPasswordRule(value: unknown): string {
    if (typeof value !== "string" || (value !== "" && !/^[A-Za-z0-9_-]{8,64}$/.test(value))) throw new Error("RCON password must be 8 to 64 letters, digits, - and _. Rust turns its remote console off for a shorter one.");
    return value;
}

const optionValue = (option: RustOption, saved: Record<string, unknown>) => (Object.hasOwn(saved, option.id) ? saved[option.id] : "default" in option ? option.default : undefined);

/** The saved settings, with a seed of the server's own the first time: every new server gets its own map. */
async function settings(): Promise<Record<string, unknown>> {
    const saved = await readSettings();
    return typeof saved.seed === "number" ? saved : updateSettings({ seed: randomInt(1, 2147483647) });
}

const displayVersion = (saved: Record<string, unknown>) => (saved.version ? String(saved.version) : saved.build ? `Build ${saved.build}` : "");

async function loadOptions(ctx: Context) {
    const saved = await settings();
    const values: Record<string, unknown> = {};
    for (const option of options) {
        if (option.kind === "secret") continue;
        const value = optionValue(option, saved);
        if (value !== undefined) values[option.id] = value;
    }
    values.rconPassword = await rconPassword.found();
    ctx.setState({ serverSoftware: "rust", serverVersion: displayVersion(saved), serverPort: String(saved.port ?? DEFAULT_PORT), gameSettings: values });
}

function rcon(): RustRcon {
    const client = local().rcon;
    if (!client) throw new Error("Rust is not running");
    return client;
}
function roster() { const r = local().roster; if (!r) throw new Error("Rust's player list is not ready"); return r; }
const info = async (): Promise<RustInfo> => parseInfo(await rcon().exec("serverinfo"));

/** A chat line the server pushed: a player's, or one said from the console. */
function observeChat(ctx: Context, chat: RustChat) {
    if (chat.UserId === "0") { pushChat(ctx, { event: "server", content: chat.Message, text: `<Server> ${chat.Message}` }); return; }
    const text = chat.Channel === 1 ? `(Team) ${chat.Message}` : chat.Message;
    emitTrigger(ctx, TRIGGER_IDS.chatMessage, pushChat(ctx, { sender: chat.Username, content: text, text: `<${chat.Username}> ${text}` }));
}

/** Connects the remote console a start or a reattach uses, with the chat it pushes going to the server's chat. */
function connect(ctx: Context, port: number, password: string) {
    local().rcon?.close();
    const client = new RustRcon(port, password);
    client.onChat = (chat) => observeChat(ctx, chat);
    client.onProblem = (err) => report(ctx, "Rust's remote console", err);
    local().rcon = client;
    local().secrets = [password];
}

/** Asks the server who is online; joins and leaves are the difference from the last answer. */
async function pollPlayers(ctx: Context) {
    if (ctx.state.serverStatus !== "online") return;
    let players: RustPlayer[];
    try { players = parsePlayers(await rcon().exec("playerlist")); }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // one notice in the console per failure, not one every few seconds
        if (message !== local().pollError && ctx.state.serverStatus === "online") report(ctx, "Could not list Rust's players", err);
        else console.debug(`[rust] players poll failed again: ${message}`);
        local().pollError = message;
        return;
    }
    local().pollError = "";
    const before = new Map(local().online.map((p) => [p.steamId, p]));
    const now = new Map(players.map((p) => [p.steamId, p]));
    local().online = players;
    ctx.setState((prev) => ({
        onlinePlayers: players.map((p) => p.name),
        seenPlayers: players.reduce((seen, p) => (seen.includes(p.name) ? seen : appendCapped(seen, p.name)), prev.seenPlayers),
    }));
    if (local().baseline) local().baseline = false;
    else {
        for (const [id, p] of now) if (!before.has(id)) {
            pushChat(ctx, { event: "join", sender: p.name, text: `${p.name} joined the game` });
            emitTrigger(ctx, TRIGGER_IDS.playerJoined, p.name);
        }
        for (const [id, p] of before) if (!now.has(id)) {
            pushChat(ctx, { event: "leave", sender: p.name, text: `${p.name} left the game` });
            emitTrigger(ctx, TRIGGER_IDS.playerLeft, p.name);
        }
    }
    roster().remember(players).catch((err) => report(ctx, "Could not record Rust's players", err));
}
function startPolling(ctx: Context) {
    if (local().poll) return;
    local().poll = setInterval(() => {
        if (ctx.state.serverStatus === "offline") { stopPolling(); return; }
        void pollPlayers(ctx);
    }, POLL_MS);
    void pollPlayers(ctx);
}
function stopPolling() {
    if (local().poll) clearInterval(local().poll!);
    local().poll = null;
    local().online = [];
    local().pollError = "";
    local().baseline = false;
}

/** The newest save's stamp; null until Rust first writes one. A map's saves are `<map>.<size>.<seed>.<version>.sav`. */
export async function saveStamp(): Promise<string | null> {
    const dir = await identityDir();
    if (!(await exists(dir))) return null;
    let newest: { file: string; at: bigint } | null = null;
    for (const name of await fs.readdir(dir)) {
        if (!name.endsWith(".sav")) continue;
        const at = (await fs.stat(path.join(dir, name), { bigint: true })).mtimeNs;
        if (!newest || at > newest.at) newest = { file: name, at };
    }
    return newest ? `${newest.file}:${await fileStamp(path.join(dir, newest.file), "Rust's save")}` : null;
}

/** Saves over the remote console and waits for the save file to change; an answer alone is not a save. */
export async function save(ctx: Context) {
    if (ctx.state.serverStatus !== "online") throw new Error("Start Rust before saving");
    const before = await saveStamp();
    await rcon().exec("server.save", { until: (message) => message.startsWith("Saving complete"), timeoutMs: 120_000 });
    await waitUntil(async () => { const now = await saveStamp(); return now !== null && now !== before; }, 60_000, "Rust to write its save");
}

/**
 * What a wipe takes away. The map and everything placed on it: the map
 * itself and its saves (`proceduralmap.<size>.<seed>.…`), where players were
 * and what they carried (`player.states`, `player.deaths`) and what they drew
 * and wrote on signs (`sv.files`). `blueprints` adds what players have
 * learned to craft (`player.blueprints`). Each database comes with the
 * `-wal` and `-shm` files SQLite keeps beside it.
 */
export function wipedFiles(names: readonly string[], blueprints: boolean): string[] {
    const prefixes = ["proceduralmap.", "player.states.", "player.deaths.", "sv.files.", ...(blueprints ? ["player.blueprints."] : [])];
    return names.filter((name) => prefixes.some((prefix) => name.startsWith(prefix))).sort();
}

async function mapView(): Promise<RustMapView> {
    const saved = await settings();
    const dir = await identityDir();
    const names = (await exists(dir)) ? await fs.readdir(dir) : [];
    const size = Number(optionValue(options.find((o) => o.id === "worldsize")!, saved));
    return {
        size, seed: Number(saved.seed),
        made: names.some((name) => name.startsWith(`proceduralmap.${size}.${saved.seed}.`)),
        blueprints: names.some((name) => name.startsWith("player.blueprints.")),
    };
}

/** The map's picture, kept beside the map's own files (proceduralmap.<size>.<seed>.…), so a wipe takes it with them. */
const pictureName = (size: number, seed: number) => `proceduralmap.${size}.${seed}.png`;
const pictureUrl = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;
const RENDERED = "Saved map render to:";

/** The picture of the map the settings name, or null when the server hasn't drawn it. */
async function mapPicture(): Promise<string | null> {
    const { size, seed } = await mapView();
    const png = await fs.readFile(path.join(await identityDir(), pictureName(size, seed))).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return null;
        throw err;
    });
    return png && pictureUrl(png);
}

// one drawing at a time per server: the Map tab asks again when it opens again
const drawing = new Map<string, Promise<string>>();

/**
 * Has the running server draw its map, from above, and keeps the world part
 * of it (see mapPicture.ts). Rust names the render after the map it is on,
 * which is the one kept: the settings may already name the next.
 */
async function drawMap(ctx: Context): Promise<string> {
    if (ctx.state.serverStatus !== "online") throw new Error("Start Rust to draw its map");
    const root = await serverRoot();
    const pending = drawing.get(root) ?? (async () => {
        const { size } = await mapView();
        const reply = await rcon().exec(`world.rendermap ${renderScale(size)}`, {
            until: (message) => message.startsWith(RENDERED) || message.startsWith("Failed to render"),
            timeoutMs: 300_000,
        });
        const line = reply.split("\n").find((l) => l.startsWith(RENDERED));
        if (!line) throw new Error(`Rust couldn't draw its map: ${reply.trim()}`);
        const render = path.resolve(await installDir(), line.slice(RENDERED.length).trim());
        const drawn = /map_(\d+)_(\d+)\.png$/.exec(render);
        if (!drawn || path.dirname(render) !== (await installDir())) throw new Error(`Rust saved its map somewhere unexpected: ${render}`);
        try {
            const png = await worldPicture(await fs.readFile(render));
            await fs.mkdir(await identityDir(), { recursive: true });
            await fs.writeFile(path.join(await identityDir(), pictureName(Number(drawn[1]), Number(drawn[2]))), png);
            return pictureUrl(png);
        } finally {
            await fs.rm(render, { force: true });
        }
    })().finally(() => drawing.delete(root));
    drawing.set(root, pending);
    return pending;
}

/**
 * Wipes a stopped server: the map's files (and the blueprints, when asked)
 * move to a trash folder in the server folder, never deleted, and the server
 * gets a new seed, so its next start makes a new map.
 */
async function wipe(blueprints: boolean): Promise<RustMapView> {
    const dir = await identityDir();
    const names = (await exists(dir)) ? await fs.readdir(dir) : [];
    const files = wipedFiles(names, blueprints);
    if (files.length > 0) {
        const trash = path.join(await serverRoot(), trashDirName(), "server", IDENTITY);
        await fs.mkdir(trash, { recursive: true });
        for (const file of files) await fs.rename(path.join(dir, file), path.join(trash, file));
    }
    await updateSettings({ seed: randomInt(1, 2147483647) });
    return mapView();
}

/** The bans: the running server's own list, or the file it keeps them in while it is stopped. */
async function bans(ctx: Context): Promise<RustBan[]> {
    if (ctx.state.serverStatus === "online") return parseBanList(await rcon().exec("banlistex"));
    const file = path.join(await identityDir(), "cfg", "bans.cfg");
    return (await exists(file)) ? parseBansCfg(await fs.readFile(file, "utf8")) : [];
}

const steam: SteamInstallSpec = {
    game: rust, appId: RUST_APP_ID, ids: { info: "rust-info", latest: "rust-latest", install: "rust-install" },
    installDir, flag: local, loadOptions,
    afterInstall: linkData,
};

export const rustService: GameService = {
    primaryProcessId: PROC, processIds: [PROC],
    backupExclude: ["install"],
    updateStatus: () => steamUpdateStatus(steam),
    installUpdate: steamInstall(steam),
    initialState: () => ({ ...initialServerState(), serverSoftware: "rust", serverPort: String(DEFAULT_PORT), serverMotd: "" }),
    blocks: async (ctx) => {
        const { mergeBlocks, onlyIdNamed, playerEvents, rosterBlocks, runGameCall } = await import("../../service/blocks");
        // Rust kicks and bans by Steam id: a block's player name is looked up
        // among the players online, then the ones the server has seen
        const known = async () => [...local().online, ...await roster().seen()];
        const nameOf = (p: { name: string }) => p.name;
        const idOf = (p: { steamId: string }) => p.steamId;
        return mergeBlocks({ events: playerEvents() }, rosterBlocks({
            kick: (name) => runGameCall(ctx, "rust-kick", { steamId: onlyIdNamed(name, local().online, nameOf, idOf, "online") }),
            ban: async (name) => runGameCall(ctx, "rust-ban", { steamId: onlyIdNamed(name, await known(), nameOf, idOf, "on this server") }),
            unban: async (name) => {
                const banned = await bans(ctx);
                // listed by their Steam id when the ban holds no name
                const byId = banned.find((ban) => ban.steamId === name);
                return runGameCall(ctx, "rust-unban", { steamId: byId ? byId.steamId : onlyIdNamed(name, banned, nameOf, idOf, "banned") });
            },
            banned: async () => (await bans(ctx)).map((ban) => ban.name || ban.steamId),
        }));
    },
    calls: async () => { const { sharedCalls } = await import("../../service/calls"); return { ...sharedCalls,
        [CALLS.readGameOptions]: async (ctx) => { await loadOptions(ctx); return ctx.state.gameSettings; },
        [CALLS.writeGameOptions]: async (ctx, { patch }) => {
            if (local().busy) throw new Error("Wait for the Rust operation to finish");
            if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Options patch is required");
            const next = validateOptions(options, "Rust", patch, await settings());
            // refuse what a command line can't hold before anything is saved
            const live: string[] = [];
            for (const option of options) {
                if (!option.convar || !Object.hasOwn(patch, option.id)) continue;
                const value = consoleValue(patch[option.id], option.label);
                if (!option.restartRequired) live.push(`${option.convar} ${value}`);
            }
            if (Object.hasOwn(patch, "rconPassword")) await rconPassword.set(rconPasswordRule(patch.rconPassword));
            await updateSettings(next);
            if (ctx.state.serverStatus === "online") for (const line of live) await rcon().exec(line);
            await loadOptions(ctx);
            return ctx.state.gameSettings;
        },
        ...steamInstallCalls(steam),
        ["rust-metrics"]: () => info(),
        ["rust-map"]: () => mapView(),
        ["rust-map-picture"]: () => mapPicture(),
        ["rust-map-draw"]: (ctx) => drawMap(ctx),
        ["rust-wipe"]: (ctx, { blueprints }) => exclusive(ctx, local(), "Rust", async () => {
            if (typeof blueprints !== "boolean") throw new Error("Choose whether blueprints are wiped too");
            const view = await wipe(blueprints);
            await loadOptions(ctx);
            return view;
        }),
        ["rust-players"]: async (ctx) => ({ seen: await roster().seen(), bans: await bans(ctx), online: local().online }),
        ["rust-kick"]: async (ctx, { steamId: raw }) => {
            const id = steamId(raw);
            if (!settled(ctx, "Rust") || !local().online.some((p) => p.steamId === id)) throw new Error("That player is not online");
            const reply = await rcon().exec(`kick ${id} "Kicked by the server admin"`);
            if (/not found/i.test(reply)) throw new Error(`Rust did not find that player: ${reply.trim()}`);
            await pollPlayers(ctx);
            return true;
        },
        ["rust-ban"]: async (ctx, { steamId: raw }) => {
            const id = steamId(raw);
            if (!settled(ctx, "Rust")) throw new Error(BANS_NEED_SERVER);
            const name = [...local().online, ...await roster().seen()].find((p) => p.steamId === id)?.name ?? id;
            const reply = await rcon().exec(`banid ${id} "${name.replace(/["\r\n\0]/g, "")}" "Banned by the server admin"`);
            if (!/^Banned User/i.test(reply)) throw new Error(`Rust did not ban that player: ${reply.trim() || "it gave no reason"}`);
            // the ban list is only written to its file when the server is told to, or stops
            await rcon().exec("server.writecfg");
            if (local().online.some((p) => p.steamId === id)) await rcon().exec(`kick ${id} "Banned by the server admin"`);
            await pollPlayers(ctx);
            return true;
        },
        ["rust-unban"]: async (ctx, { steamId: raw }) => {
            const id = steamId(raw);
            if (!settled(ctx, "Rust")) throw new Error(BANS_NEED_SERVER);
            const reply = await rcon().exec(`unban ${id}`);
            if (!/^Unbanned User/i.test(reply)) throw new Error(`Rust did not unban that player: ${reply.trim() || "it gave no reason"}`);
            await rcon().exec("server.writecfg");
            return true;
        },
    }; },
    loadOptions,
    async initialize(ctx, running) {
        local().roster = new RustRoster(await serverRoot());
        if (running) {
            // reattaching to a running server: talk to it with the password it started with
            const saved = await readSettings();
            const password = await rconPassword.value();
            if (!password) throw new Error("Rust is running without the RCON password Paperboard set; stop it from the computer and start it again here");
            connect(ctx, Number(saved.rconPort ?? DEFAULT_RCON_PORT), password);
            local().started = true;
            local().baseline = true;
            startPolling(ctx);
            void info()
                .then((answer) => ctx.setState({ maxPlayers: answer.MaxPlayers }))
                .catch((err) => report(ctx, "Could not read Rust's player limit", err));
        }
        await resumeAfterBackup(ctx, GAME, running);
    },
    async beforeRemove() { if (local().busy) throw new Error("Wait for Rust's current operation"); },
    async dispose() {
        stopPolling();
        local().rcon?.close();
        local().rcon = null;
        local().console.dispose();
    },
    async prepareLaunch(ctx) {
        assertHost(rust);
        const saved = await settings();
        const install = await installDir();
        if (!(await installedBuild(RUST_APP_ID, install))) throw new Error("Install Rust in Updates first");
        const windows = process.platform === "win32";
        const executable = path.join(install, windows ? "RustDedicated.exe" : "RustDedicated");
        await fs.access(executable, windows ? fs.constants.F_OK : fs.constants.X_OK);
        await linkData();
        const password = await rconPassword.ensure();
        const rconPort = Number(saved.rconPort ?? DEFAULT_RCON_PORT);
        connect(ctx, rconPort, password);
        local().started = false;
        stopPolling();

        const args = [
            "-batchmode", "-nographics", "-logfile", "-",
            "+server.ip", "0.0.0.0", "+server.port", String(Number(saved.port ?? DEFAULT_PORT)), "+server.queryport", String(Number(saved.queryPort ?? DEFAULT_QUERY_PORT)),
            // the remote console answers this computer only
            "+rcon.ip", "127.0.0.1", "+rcon.port", String(rconPort), "+rcon.web", "1", "+rcon.password", password,
            "+app.port", String(Number(saved.appPort ?? DEFAULT_APP_PORT)),
            "+server.identity", IDENTITY, "+server.level", "Procedural Map",
        ];
        for (const option of options) {
            if (!option.convar) continue;
            const value = optionValue(option, saved);
            // an empty value has no argument to be: the server keeps its own default
            if (value === undefined || value === "") continue;
            args.push(`+${option.convar}`, argValue(value, option.label));
        }
        // Linux: the game's own files stay out of the user's home folder, and its libraries are
        // beside it; it ships Steam's client library itself
        const env: Record<string, string> = {};
        if (!windows) {
            const home = path.join(await serverRoot(), "profile");
            await fs.mkdir(home, { recursive: true });
            const plugins = path.join(install, "RustDedicated_Data", "Plugins");
            Object.assign(env, { HOME: home, XDG_DATA_HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), LD_LIBRARY_PATH: [plugins, path.join(plugins, "x86_64")].join(":") });
        }
        return {
            message: `Starting Rust${saved.version ? ` ${saved.version}` : ""}…`,
            command: { executable, args, cwd: install, env },
        };
    },
    isMutating: () => local().busy,
    // a big map takes many minutes to make on its first start; the console shows it working
    readiness: { timeoutMs: 1_800_000, async probe(ctx) {
        // the remote console answers long before the map is loaded: the server's own line says when
        if (!local().started) return false;
        const answer = await info();
        ctx.setState({ maxPlayers: answer.MaxPlayers, serverVersion: answer.Protocol });
        if ((await readSettings()).version !== answer.Protocol) await updateSettings({ version: answer.Protocol });
        startPolling(ctx);
        return true;
    } },
    saveWorld: save,
    stopTimeoutMs: 120_000, stopEntry: "quit",
    async stop() {
        // Rust saves, then quits; the connection closes before any answer
        try { await rcon().exec("quit", { until: () => false, timeoutMs: 120_000 }); }
        catch (err) { if (!(err instanceof Error && err.message === "Rust closed its remote console")) throw err; }
    },
    commandLine(command) {
        if (/[\r\n\0]/.test(command)) throw new Error("A command must be a single line");
        if (/^\s*(?:global\.)?(?:quit|restart)\b|^\s*rcon\.password\b/i.test(command)) throw new Error("Paperboard manages the RCON password and stops the server; use Options, Stop and Restart");
        return command.trim();
    },
    async sendCommand(ctx, command) {
        // the answer comes back over the remote console, not through the server's own output
        let reply: string;
        try { reply = await rcon().exec(command, { timeoutMs: 5_000 }); }
        catch (err) {
            if (!(err instanceof RustRconSilent)) throw err;
            throw new Error(`${err.message}. Rust answers nothing to a command it doesn't know.`);
        }
        for (const line of reply.split(/\r?\n/)) if (line.trim()) local().console.push(ctx, redact(line, local().secrets));
    },
    async sendChat(_ctx, message) {
        // the server pushes the line back as chat, which is what the chat shows
        await rcon().exec(`say ${singleLine(message, "Message")}`);
    },
    observeLine(ctx, raw) {
        // Unity writes cursor codes into its output; the command line the server prints holds the RCON password
        const line = redact(raw.replace(/\r/g, "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""), local().secrets);
        if (!line.trim()) return;
        if (line.trim() === STARTED) local().started = true;
        local().console.push(ctx, line);
    },
    async assertFileAccess(ctx, file, write) {
        if (typeof file !== "string") throw new Error("Choose a file");
        if (write && (file === "install" || file.startsWith("install/"))) throw new Error("Installed Rust files are managed by Updates");
        if (write && (local().busy || ctx.state.serverStatus !== "offline")) throw new Error("Stop Rust before editing its files");
    },
    portNames: ["rust", "rust-query", "rust-rcon", "rust-app"],
    async *ports(ctx) {
        const saved = await readSettings();
        yield settingPort({ name: "rust", label: "Rust", protocol: "udp", key: "port", fallback: DEFAULT_PORT, onWrite: (port) => ctx.setState({ serverPort: String(port) }) }, saved);
        yield settingPort({ name: "rust-query", label: "Rust server browser", protocol: "udp", key: "queryPort", fallback: DEFAULT_QUERY_PORT }, saved);
        yield settingPort({ name: "rust-rcon", label: "Rust remote console", protocol: "tcp", key: "rconPort", fallback: DEFAULT_RCON_PORT }, saved);
        yield settingPort({ name: "rust-app", label: "Rust+ app", protocol: "tcp", key: "appPort", fallback: DEFAULT_APP_PORT }, saved);
    },
    backup: offlineBackup({
        gameId: GAME, name: "Rust", processId: PROC, flag: local,
        announce: async () => { await rcon().exec("say The server is stopping for a backup and will be back shortly."); },
        save, clean: async () => {},
    }),
};
