import type { Server } from "../../service/server";
import fs from "node:fs/promises";
import path from "node:path";
import { randomInt } from "node:crypto";
import { initialServerState } from "../../service/initialState";
import { TRIGGER_IDS } from "../../service/contract";
import { validateOptions } from "../options";
import { installedBuild } from "../steam/steamcmd";
import { steamInstall, steamInstallCalls, steamUpdateStatus, type SteamInstallSpec } from "../steam/installAction";
import type { GameService } from "../serviceTypes";
import {
    assertHost, exclusive, exists, fileStamp, linkFolder, offlineBackup, playerPoller, pushChat, redact, report,
    serverSecret, settingPort, settled, singleLine, unlessMissing, waitUntil,
} from "../serviceKit";
import { trashDirName } from "../../service/trash";
import { rust, options, RUST_APP_ID, type RustMapView, type RustOption, type RustWipeResult } from "./index";
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
/** the line the server prints once its map is loaded and players can join */
const STARTED = "Server startup complete";
const BANS_NEED_SERVER = "Start the server to ban or unban players; Rust keeps its own ban list";

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

const displayVersion = (saved: Record<string, unknown>) => (saved.version ? String(saved.version) : saved.build ? `Build ${saved.build}` : "");

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

/** A console line Rust writes for a failure. */
const isError = (line: string) => /^(Error|Exception|\w*Exception:)|\bfailed\b/i.test(line);

/** One server's part of the game: its process, console, settings files and players are its own. */
export function rustService(ctx: Server): GameService {
    const local = {
        busy: false,
        rcon: null as RustRcon | null,
        roster: null as RustRoster | null,
        /** the server has printed that it finished starting */
        started: false,
        secrets: [] as string[],
    };

    // Layout: install/ is SteamCMD's folder and is left out of backups; the game
    // writes its map, saves and lists to install/server, which links to server/
    // beside it so they are backed up and survive an update.
    const installDir = async () => path.join(await ctx.root(), "install");
    const dataDir = async () => path.join(await ctx.root(), "server");
    const identityDir = async () => path.join(await dataDir(), IDENTITY);
    const linkData = async () => linkFolder(path.join(await installDir(), "server"), await dataDir());
    const rconPassword = serverSecret(ctx, GAME, "rcon-password");

    /** The saved settings, with a seed of the server's own the first time: every new server gets its own map. */
    async function seeded(): Promise<Record<string, unknown>> {
        const saved = ctx.settings;
        return typeof saved.seed === "number" ? saved : ctx.updateSettings({ seed: randomInt(1, 2147483647) });
    }

    async function loadOptions() {
        const saved = await seeded();
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
        const client = local.rcon;
        if (!client) throw new Error("Rust is not running");
        return client;
    }
    function roster() { const r = local.roster; if (!r) throw new Error("Rust's player list is not ready"); return r; }
    const info = async (): Promise<RustInfo> => parseInfo(await rcon().exec("serverinfo"));

    /** A chat line the server pushed: a player's, or one said from the console. */
    function observeChat(chat: RustChat) {
        if (chat.UserId === "0") { pushChat(ctx, { event: "server", content: chat.Message, text: `<Server> ${chat.Message}` }); return; }
        const text = chat.Channel === 1 ? `(Team) ${chat.Message}` : chat.Message;
        ctx.trigger(TRIGGER_IDS.chatMessage, pushChat(ctx, { sender: chat.Username, content: text, text: `<${chat.Username}> ${text}` }));
    }

    /** Connects the remote console a start or a reattach uses, with the chat it pushes going to the server's chat. */
    function connect(port: number, password: string) {
        local.rcon?.close();
        const client = new RustRcon(port, password);
        client.onChat = (chat) => observeChat(chat);
        client.onProblem = (err) => report(ctx, "Rust's remote console", err);
        local.rcon = client;
        local.secrets = [password];
    }

    const players = playerPoller(ctx, {
        game: "Rust",
        id: (p: RustPlayer) => p.steamId,
        list: async () => parsePlayers(await rcon().exec("playerlist")),
        remember: (list) => roster().remember(list),
    });

    /** The newest save's stamp; null until Rust first writes one. A map's saves are `<map>.<size>.<seed>.<version>.sav`. */
    async function saveStamp(): Promise<string | null> {
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
    async function save() {
        if (ctx.state.serverStatus !== "online") throw new Error("Start Rust before saving");
        const before = await saveStamp();
        await rcon().exec("server.save", { until: (message) => message.startsWith("Saving complete"), timeoutMs: 120_000 });
        await waitUntil(async () => { const now = await saveStamp(); return now !== null && now !== before; }, 60_000, "Rust to write its save");
    }

    async function mapView(): Promise<RustMapView> {
        const saved = await seeded();
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
        const png = await unlessMissing(fs.readFile(path.join(await identityDir(), pictureName(size, seed))), null);
        return png && pictureUrl(png);
    }

    // one drawing at a time per server: the Map tab asks again when it opens again
    const drawing = new Map<string, Promise<string>>();

    /**
     * Has the running server draw its map, from above, and keeps the world part
     * of it (see mapPicture.ts). Rust names the render after the map it is on,
     * which is the one kept: the settings may already name the next.
     */
    async function drawMap(): Promise<string> {
        if (ctx.state.serverStatus !== "online") throw new Error("Start Rust to draw its map");
        const root = await ctx.root();
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
    async function wipe(blueprints: boolean): Promise<RustWipeResult> {
        const dir = await identityDir();
        const names = (await exists(dir)) ? await fs.readdir(dir) : [];
        const files = wipedFiles(names, blueprints);
        // any map moved, not only the one the settings name: a size or seed changed since it was made
        const trashed = files.some((name) => name.startsWith("proceduralmap."));
        if (files.length > 0) {
            const trash = path.join(await ctx.root(), trashDirName(), "server", IDENTITY);
            await fs.mkdir(trash, { recursive: true });
            for (const file of files) await fs.rename(path.join(dir, file), path.join(trash, file));
        }
        await ctx.updateSettings({ seed: randomInt(1, 2147483647) });
        return { ...(await mapView()), trashed };
    }

    /** The bans: the running server's own list, or the file it keeps them in while it is stopped. */
    async function bans(): Promise<RustBan[]> {
        if (ctx.state.serverStatus === "online") return parseBanList(await rcon().exec("banlistex"));
        const file = path.join(await identityDir(), "cfg", "bans.cfg");
        return (await exists(file)) ? parseBansCfg(await fs.readFile(file, "utf8")) : [];
    }

    const steam: SteamInstallSpec = {
        game: rust, appId: RUST_APP_ID,
        installDir, flag: () => local, loadOptions,
        afterInstall: linkData,
    };
    const install = steamInstall(ctx, steam);

    return {
        primaryProcessId: PROC, processIds: [PROC],
        backupExclude: ["install"],
        updateStatus: () => steamUpdateStatus(steam),
        installUpdate: install,
        initialState: () => ({ ...initialServerState(), serverSoftware: "rust", serverPort: String(DEFAULT_PORT), serverMotd: "" }),
        blocks: async () => {
            const { mergeBlocks, onlyIdNamed, playerEvents, rosterBlocks, runGameCall } = await import("../../service/blocks");
            // Rust kicks and bans by Steam id: a block's player name is looked up
            // among the players online, then the ones the server has seen
            const known = async () => [...players.online(), ...await roster().seen()];
            const nameOf = (p: { name: string }) => p.name;
            const idOf = (p: { steamId: string }) => p.steamId;
            return mergeBlocks({ events: playerEvents() }, rosterBlocks({
                kick: (name) => runGameCall(ctx, "rustKick", { steamId: onlyIdNamed(name, players.online(), nameOf, idOf, "online") }),
                ban: async (name) => runGameCall(ctx, "rustBan", { steamId: onlyIdNamed(name, await known(), nameOf, idOf, "on this server") }),
                unban: async (name) => {
                    const banned = await bans();
                    // listed by their Steam id when the ban holds no name
                    const byId = banned.find((ban) => ban.steamId === name);
                    return runGameCall(ctx, "rustUnban", { steamId: byId ? byId.steamId : onlyIdNamed(name, banned, nameOf, idOf, "banned") });
                },
                banned: async () => (await bans()).map((ban) => ban.name || ban.steamId),
            }));
        },
        calls: async () => { const { sharedCalls } = await import("../../service/calls"); return { ...sharedCalls,
            readGameOptions: async (ctx) => { await loadOptions(); return ctx.state.gameSettings; },
            writeGameOptions: async (ctx, { patch }) => {
                if (local.busy) throw new Error("Wait for the Rust operation to finish");
                if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Options patch is required");
                const next = validateOptions(options, "Rust", patch, await seeded());
                // refuse what a command line can't hold before anything is saved
                const live: string[] = [];
                for (const option of options) {
                    if (!option.convar || !Object.hasOwn(patch, option.id)) continue;
                    const value = consoleValue(patch[option.id], option.label);
                    if (!option.restartRequired) live.push(`${option.convar} ${value}`);
                }
                if (Object.hasOwn(patch, "rconPassword")) await rconPassword.set(rconPasswordRule(patch.rconPassword));
                await ctx.updateSettings(next);
                if (ctx.state.serverStatus === "online") for (const line of live) await rcon().exec(line);
                await loadOptions();
                return ctx.state.gameSettings;
            },
            ...steamInstallCalls(steam, install),
            rustMetrics: () => info(),
            rustMap: () => mapView(),
            rustMapPicture: () => mapPicture(),
            rustMapDraw: (ctx) => drawMap(),
            rustWipe: (ctx, { blueprints }) => exclusive(ctx, local, "Rust", async () => {
                if (typeof blueprints !== "boolean") throw new Error("Choose whether blueprints are wiped too");
                const view = await wipe(blueprints);
                await loadOptions();
                return view;
            }),
            rustPlayers: async (ctx) => ({ seen: await roster().seen(), bans: await bans(), online: [...players.online()] }),
            rustKick: async (ctx, { steamId: raw }) => {
                const id = steamId(raw);
                if (!settled(ctx, "Rust") || !players.online().some((p) => p.steamId === id)) throw new Error("That player is not online");
                const reply = await rcon().exec(`kick ${id} "Kicked by the server admin"`);
                if (/not found/i.test(reply)) throw new Error(`Rust did not find that player: ${reply.trim()}`);
                await players.poll();
                return true;
            },
            rustBan: async (ctx, { steamId: raw }) => {
                const id = steamId(raw);
                if (!settled(ctx, "Rust")) throw new Error(BANS_NEED_SERVER);
                const name = [...players.online(), ...await roster().seen()].find((p) => p.steamId === id)?.name ?? id;
                const reply = await rcon().exec(`banid ${id} "${name.replace(/["\r\n\0]/g, "")}" "Banned by the server admin"`);
                if (!/^Banned User/i.test(reply)) throw new Error(`Rust did not ban that player: ${reply.trim() || "it gave no reason"}`);
                // the ban list is only written to its file when the server is told to, or stops
                await rcon().exec("server.writecfg");
                if (players.online().some((p) => p.steamId === id)) await rcon().exec(`kick ${id} "Banned by the server admin"`);
                await players.poll();
                return true;
            },
            rustUnban: async (ctx, { steamId: raw }) => {
                const id = steamId(raw);
                if (!settled(ctx, "Rust")) throw new Error(BANS_NEED_SERVER);
                const reply = await rcon().exec(`unban ${id}`);
                if (!/^Unbanned User/i.test(reply)) throw new Error(`Rust did not unban that player: ${reply.trim() || "it gave no reason"}`);
                await rcon().exec("server.writecfg");
                return true;
            },
        }; },
        loadOptions,
        async initialize(running) {
            local.roster = new RustRoster(await ctx.root());
            if (running) {
                // reattaching to a running server: talk to it with the password it started with
                const saved = ctx.settings;
                const password = await rconPassword.value();
                if (!password) throw new Error("Rust is running without the RCON password Paperboard set; stop it from the computer and start it again here");
                connect(ctx.runPort("rust-rcon", Number(saved.rconPort ?? DEFAULT_RCON_PORT)), password);
                local.started = true;
                players.start(true);
                void info()
                    .then((answer) => ctx.setState({ maxPlayers: answer.MaxPlayers }))
                    .catch((err) => report(ctx, "Could not read Rust's player limit", err));
            }
        },
        async beforeRemove() { if (local.busy) throw new Error("Wait for Rust's current operation"); },
        async dispose() {
            players.stop();
            local.rcon?.close();
            local.rcon = null;
        },
        async prepareLaunch() {
            assertHost(rust);
            const saved = await seeded();
            const install = await installDir();
            if (!(await installedBuild(RUST_APP_ID, install))) throw new Error("Install Rust in Updates first");
            const windows = process.platform === "win32";
            const executable = path.join(install, windows ? "RustDedicated.exe" : "RustDedicated");
            await fs.access(executable, windows ? fs.constants.F_OK : fs.constants.X_OK);
            await linkData();
            const password = await rconPassword.ensure();
            const rconPort = ctx.runPort("rust-rcon", Number(saved.rconPort ?? DEFAULT_RCON_PORT));
            connect(rconPort, password);
            local.started = false;

            const args = [
                "-batchmode", "-nographics", "-logfile", "-",
                "+server.ip", "0.0.0.0", "+server.port", String(ctx.runPort("rust", Number(saved.port ?? DEFAULT_PORT))), "+server.queryport", String(ctx.runPort("rust-query", Number(saved.queryPort ?? DEFAULT_QUERY_PORT))),
                // the remote console answers this computer only
                "+rcon.ip", "127.0.0.1", "+rcon.port", String(rconPort), "+rcon.web", "1", "+rcon.password", password,
                "+app.port", String(ctx.runPort("rust-app", Number(saved.appPort ?? DEFAULT_APP_PORT))),
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
                const home = path.join(await ctx.root(), "profile");
                await fs.mkdir(home, { recursive: true });
                const plugins = path.join(install, "RustDedicated_Data", "Plugins");
                Object.assign(env, { HOME: home, XDG_DATA_HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), LD_LIBRARY_PATH: [plugins, path.join(plugins, "x86_64")].join(":") });
            }
            return {
                message: `Starting Rust${saved.version ? ` ${saved.version}` : ""}…`,
                command: { executable, args, cwd: install, env },
            };
        },
        isMutating: () => local.busy,
        // a big map takes many minutes to make on its first start; the console shows it working
        readiness: { timeoutMs: 1_800_000, async probe() {
            // the remote console answers long before the map is loaded: the server's own line says when
            if (!local.started) return false;
            const answer = await info();
            ctx.setState({ maxPlayers: answer.MaxPlayers, serverVersion: answer.Protocol });
            if (ctx.settings.version !== answer.Protocol) await ctx.updateSettings({ version: answer.Protocol });
            players.start();
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
        async sendCommand(command) {
            // the answer comes back over the remote console, not through the server's own output
            let reply: string;
            try { reply = await rcon().exec(command, { timeoutMs: 5_000 }); }
            catch (err) {
                if (!(err instanceof RustRconSilent)) throw err;
                throw new Error(`${err.message}. Rust answers nothing to a command it doesn't know.`);
            }
            for (const line of reply.split(/\r?\n/)) if (line.trim()) ctx.console.push(redact(line, local.secrets), isError(line));
        },
        async sendChat(message) {
            // the server pushes the line back as chat, which is what the chat shows
            await rcon().exec(`say ${singleLine(message, "Message")}`);
        },
        observeLine(raw) {
            // Unity writes cursor codes into its output; the command line the server prints holds the RCON password
            const line = redact(raw.replace(/\r/g, "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""), local.secrets);
            if (!line.trim()) return;
            if (line.trim() === STARTED) local.started = true;
            ctx.console.push(line, isError(line));
        },
        async assertFileAccess(file, write) {
            if (typeof file !== "string") throw new Error("Choose a file");
            if (write && (file === "install" || file.startsWith("install/"))) throw new Error("Installed Rust files are managed by Updates");
            if (write && (local.busy || ctx.state.serverStatus !== "offline")) throw new Error("Stop Rust before editing its files");
        },
        portNames: ["rust", "rust-query", "rust-rcon", "rust-app"],
        async *ports() {
            const saved = ctx.settings;
            yield settingPort({ name: "rust", label: "Rust", protocol: "udp", key: "port", fallback: DEFAULT_PORT }, saved);
            yield settingPort({ name: "rust-query", label: "Rust server browser", protocol: "udp", key: "queryPort", fallback: DEFAULT_QUERY_PORT }, saved);
            yield settingPort({ name: "rust-rcon", label: "Rust remote console", protocol: "tcp", key: "rconPort", fallback: DEFAULT_RCON_PORT }, saved);
            yield settingPort({ name: "rust-app", label: "Rust+ app", protocol: "tcp", key: "appPort", fallback: DEFAULT_APP_PORT }, saved);
        },
        backup: offlineBackup(ctx, {
            name: "Rust", processId: PROC, flag: () => local,
            announce: async () => { await rcon().exec("say The server is stopping for a backup and will be back shortly."); },
            save, clean: async () => {},
        }),
    };
}
