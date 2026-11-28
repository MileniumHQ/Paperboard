import type { Server } from "../../service/server";
import fs from "node:fs/promises";
import path from "node:path";
import { initialServerState } from "../../service/initialState";
import { appendCapped } from "../../service/types";
import { TRIGGER_IDS } from "../../service/contract";
import { validateOptions } from "../options";
import { installedBuild } from "../steam/steamcmd";
import { steamInstall, steamInstallCalls, steamUpdateStatus, type SteamInstallSpec } from "../steam/installAction";
import type { GameService } from "../serviceTypes";
import { ConsoleBuffer, assertHost, exists, offlineBackup, pushChat, redact, report, serverSecret, unlessMissing } from "../serviceKit";
import { KEYS, MODIFIERS, options, valheim, VALHEIM_APP_ID, VALHEIM_CLIENT_APP_ID, VALHEIM_MAX_PLAYERS, VALHEIM_PASSWORD_MIN, type ValheimOption } from "./index";
import { ValheimLog } from "./log";
import { isList, listEntry, ValheimLists, type ValheimList } from "./lists";
import { entryIs, isPlatformId, platformId } from "./ids";

const GAME = "valheim";
const PROC = "valheim-server";
const DEFAULT_PORT = 2456;
/** the server opens its port and the next (Steam's query port), so both are claimed as one */
const PORTS_IN_A_ROW = 2;
/** where the world and lists live, given to the server as -savedir */
const SAVE_DIR = "save";
/** what the running server was started with and the console line its start said, kept so a restart of Paperboard still knows: its options are read only as it starts */
const RUN_FILE = ".valheim-run.json";
/** Unity's own errors and the game's ZLog.LogError lines; Valheim's many "Failed to place" lines are world generation, not failures */
const isError = (line: string) => /exception|^(?:\d{1,2}\/\d{1,2}\/\d{4} [\d:]+: )?(?:Error|Could not parse)\b/i.test(line);

const optionValue = (option: ValheimOption, saved: Record<string, unknown>) => (Object.hasOwn(saved, option.id) ? saved[option.id] : "default" in option ? option.default : undefined);

/** A world name as the server and its save folder take it. */
export function worldName(value: unknown): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/.test(value) || value.trim() !== value) throw new Error("World must be 1 to 40 letters, digits, spaces, - and _, starting with a letter or digit");
    return value;
}
/** A server name: one line that the server's argument parsing takes whole. */
export function serverName(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || /[\r\n\0"]/.test(value)) throw new Error("Server name must be one line with no quotes");
    return value;
}
/**
 * The server's own password rule (FejdStartup.GetPublicPasswordError): a
 * public server needs a password of at least 5 characters that is not part
 * of the world's name. The server checks it against the world's seed too,
 * and quits with "Error bad password" when it fails, which the start reports.
 */
export function passwordProblem(password: string, world: string, isPublic: boolean): string | null {
    if (!password) return isPublic ? "A public Valheim server needs a join password; set one in Options or turn Public off" : null;
    if (password.length < VALHEIM_PASSWORD_MIN) return `The join password must be at least ${VALHEIM_PASSWORD_MIN} characters`;
    if (world.includes(password)) return "The join password can't be part of the world's name";
    return null;
}

/** The server's arguments for its saved options, in the order the server reads them: the preset before the modifiers it changes. */
export function launchArgs(saved: Record<string, unknown>, run: { port: number; saveDir: string; password: string }): string[] {
    const value = (id: string) => optionValue(options.find((o) => o.id === id)!, saved);
    const args = [
        "-nographics", "-batchmode",
        "-name", serverName(value("name")),
        "-port", String(run.port),
        "-world", worldName(value("world")),
        "-savedir", run.saveDir,
        "-public", value("public") ? "1" : "0",
        "-saveinterval", String(Number(value("saveinterval")) * 60),
        "-backups", String(value("backups")),
        "-backupshort", String(Number(value("backupshort")) * 60),
        "-backuplong", String(Number(value("backuplong")) * 60),
        // a preset clears the world's modifiers first, so the options are the world's whole set at every start
        "-preset", String(value("preset")),
    ];
    if (run.password) args.push("-password", run.password);
    if (value("crossplay")) args.push("-crossplay");
    for (const id of MODIFIERS) if (value(id) !== "default") args.push("-modifier", id, String(value(id)));
    for (const id of KEYS) if (value(id) === true) args.push("-setkey", id);
    return args;
}

/** what a run was started with: its world, whether it is in the server list, and crossplay */
interface Run { world: string; listed: boolean; crossplay: boolean }
/** what RUN_FILE keeps: the run, and the console line its start said, which is where its own lines begin */
interface RunRecord { run: Run; launch: string }

/**
 * The run's own lines of a kept console: those after its launch line, the
 * last one that says it. The lines above are earlier runs', whose players
 * left with them. A console trimmed past the launch line holds only the
 * run's own lines, as the trim drops the oldest first.
 */
function runLines(entries: readonly { type?: string; content: unknown }[], launch: string): string[] {
    const from = entries.findLastIndex((e) => e.type === "info" && e.content === launch);
    return entries.slice(from + 1).flatMap((e) => (typeof e.content === "string" ? [e.content] : []));
}

/** One server's part of the game: its process, console, world and lists are its own. */
export function valheimService(ctx: Server): GameService {
    const local = {
        busy: false,
        log: new ValheimLog(),
        lists: null as ValheimLists | null,
        /** what this run's start has seen of its readiness */
        start: { connected: false, generating: false, generated: false, newWorld: false, refused: null as string | null },
        /** what the running server was started with; null while it is stopped */
        run: null as Run | null,
        /** the crossplay session's join code and public address, once the relay registered it */
        session: { joinCode: null as string | null, address: null as string | null },
        /** world saves the server reported this run; the stop must add one for a backup to copy */
        saves: 0,
        secrets: [] as string[],
        console: new ConsoleBuffer(isError),
    };

    // Layout: install/ is SteamCMD's folder and is left out of backups; save/ is
    // the server's -savedir, holding worlds_local/<world>/ and its three lists;
    // profile/ is its HOME, so Unity's own files stay out of the user's.
    const installDir = async () => path.join(await ctx.root(), "install");
    const saveDir = async () => path.join(await ctx.root(), SAVE_DIR);
    const joinPassword = serverSecret(ctx, GAME, "join-password");
    const lists = () => { const l = local.lists; if (!l) throw new Error("Valheim's lists are not ready"); return l; };
    const saved = () => ctx.settings;
    const setting = (id: string) => optionValue(options.find((o) => o.id === id)!, saved());

    // who is on and the relay's session are the run's: a stop, a crash or a kill ends them
    ctx.onRunEnd(() => {
        local.log = new ValheimLog();
        local.session = { joinCode: null, address: null };
        local.run = null;
    });
    const runFile = async () => path.join(await ctx.root(), RUN_FILE);
    /** The run a server found running was started with, from the record its start left. */
    async function readRun(): Promise<RunRecord> {
        const text = await unlessMissing(fs.readFile(await runFile(), "utf8"), null);
        if (text === null) throw new Error(`Valheim is running without ${RUN_FILE}, which Paperboard writes as it starts it; stop it from the computer and start it again here`);
        const { run, launch } = JSON.parse(text) as { run?: Partial<Run>; launch?: unknown };
        if (!run || typeof run.world !== "string" || typeof run.listed !== "boolean" || typeof run.crossplay !== "boolean" || typeof launch !== "string") throw new Error(`${RUN_FILE} is not a record of how Valheim was started`);
        return { run: { world: run.world, listed: run.listed, crossplay: run.crossplay }, launch };
    }

    const displayVersion = (s: Record<string, unknown>) => (s.version ? String(s.version) : s.build ? `Build ${s.build}` : "");

    async function loadOptions() {
        const values: Record<string, unknown> = {};
        for (const option of options) if (option.kind !== "secret") values[option.id] = optionValue(option, saved());
        values.password = await joinPassword.found();
        ctx.setState({ serverSoftware: "valheim", serverVersion: displayVersion(saved()), serverPort: String(setting("port")), maxPlayers: VALHEIM_MAX_PLAYERS, gameSettings: values });
    }

    /** Whether the world has saves yet: a world the server will make at this start has none. */
    async function worldExists(world: string): Promise<boolean> {
        const dir = path.join(await saveDir(), "worlds_local");
        if (await exists(path.join(dir, world))) return true;
        // worlds saved by earlier Valheim builds are files beside the folders
        return exists(path.join(dir, `${world}.fwl`));
    }

    function publishOnline() {
        const names = local.log.online().map((p) => p.name);
        ctx.setState((prev) => ({ onlinePlayers: names, seenPlayers: names.reduce((seen, n) => (seen.includes(n) ? seen : appendCapped(seen, n)), prev.seenPlayers) }));
    }

    /** What a log line means for this run. `replay` reads a line from before a restart of Paperboard: it rebuilds who is on, and fires nothing. */
    function readLine(line: string, replay = false) {
        for (const event of local.log.read(line)) {
            switch (event.kind) {
                case "joined":
                    publishOnline();
                    if (replay) break;
                    pushChat(ctx, { event: "join", sender: event.player.name, text: `${event.player.name} joined the game` });
                    ctx.trigger(TRIGGER_IDS.playerJoined, event.player.name);
                    lists().remember(event.player).catch((err) => report(ctx, "Could not record Valheim's players", err));
                    break;
                case "left":
                    publishOnline();
                    if (replay) break;
                    pushChat(ctx, { event: "leave", sender: event.player.name, text: `${event.player.name} left the game` });
                    ctx.trigger(TRIGGER_IDS.playerLeft, event.player.name);
                    break;
                case "version":
                    if (replay) break;
                    void (async () => {
                        if (ctx.settings.version !== event.version) await ctx.updateSettings({ version: event.version });
                        ctx.setState({ serverVersion: event.version });
                    })().catch((err) => report(ctx, "Could not record Valheim's version", err));
                    break;
                case "join-code":
                    local.session = { joinCode: event.code, address: event.address ?? local.session.address };
                    break;
                case "saved": local.saves++; break;
                case "connected": local.start.connected = true; break;
                case "generating": local.start.generating = true; break;
                case "generated": local.start.generated = true; local.start.generating = false; break;
                case "refused": local.start.refused = event.reason; break;
            }
        }
    }

    /** A start's own readiness and save count; who is on was cleared as the last run ended. */
    function freshRun() {
        local.start = { connected: false, generating: false, generated: false, newWorld: false, refused: null };
        local.saves = 0;
    }

    /** Whom a block's player name is: one seen on the server, or an entry already on a list. */
    async function playerNamed(name: string): Promise<{ name?: string; id?: string | null }> {
        const online = local.log.online().filter((p) => p.name === name);
        const seen = (await lists().seen()).filter((p) => p.name === name);
        const ids = [...new Set([...online, ...seen].map((p) => p.id))];
        if (ids.length > 1) throw new Error(`${ids.length} players are named ${name}; use the Players tab to pick one`);
        if (ids.length === 1) return { name, id: ids[0] };
        // a platform id given as the name, or a name only a ban list holds
        return isPlatformId(name) ? { id: name } : { name };
    }

    /** A list's entries by the name of the player each is, as the Players tab shows them; an entry Paperboard never saw join stays as it is written. */
    async function listNames(list: ValheimList): Promise<string[]> {
        const seen = await lists().seen();
        return (await lists().read(list)).map((entry) => seen.find((p) => entryIs(entry, p, list === "banned"))?.name ?? entry);
    }

    /** Puts a player on a list or takes them off, by their id or (bans only) their name. */
    async function setList(list: ValheimList, player: { name?: string; id?: string | null }, on: boolean) {
        if (local.busy) throw new Error("Wait for the Valheim operation to finish");
        await lists().set(list, player, on);
    }

    const steam: SteamInstallSpec = {
        game: valheim, appId: VALHEIM_APP_ID,
        installDir, flag: () => local, loadOptions,
        async afterInstall() {
            const binary = path.join(await installDir(), "valheim_server.x86_64");
            if (!(await exists(binary))) throw new Error("SteamCMD finished, but the install has no valheim_server.x86_64");
            await fs.mkdir(await saveDir(), { recursive: true });
        },
    };
    const install = steamInstall(ctx, steam);

    return {
        primaryProcessId: PROC, processIds: [PROC],
        backupExclude: ["install"],
        updateStatus: () => steamUpdateStatus(steam),
        installUpdate: install,
        initialState: () => ({ ...initialServerState(), serverSoftware: "valheim", serverPort: String(DEFAULT_PORT), serverMotd: "", maxPlayers: VALHEIM_MAX_PLAYERS }),
        blocks: async () => {
            const { mergeBlocks, playerEvents, rosterBlocks, runGameCall } = await import("../../service/blocks");
            const player = { type: "player", name: "Player" } as const;
            const listCommand = (id: string, name: string, icon: string, description: string, text: string, list: ValheimList, on: boolean) => ({
                id, name, category: "Players", icon, description, text, inputs: { player },
                run: async ({ player: named }: { player: string }) => {
                    const who = await playerNamed(named);
                    await runGameCall(ctx, "valheimList", { list, id: who.id ?? null, name: who.name ?? null, on });
                },
            });
            const listValue = (id: string, name: string, icon: string, description: string, list: ValheimList) => ({
                id, name, category: "Players", icon, description, type: "list<player>", read: () => listNames(list),
            });
            return mergeBlocks({ events: playerEvents() }, rosterBlocks({
                ban: async (name) => { const who = await playerNamed(name); return runGameCall(ctx, "valheimList", { list: "banned", id: who.id ?? null, name: who.name ?? null, on: true }); },
                unban: async (name) => { const who = await playerNamed(name); return runGameCall(ctx, "valheimList", { list: "banned", id: who.id ?? null, name: who.name ?? null, on: false }); },
                banned: () => listNames("banned"),
            }), {
                commands: [
                    listCommand("make-admin", "Make Admin", "shield_person", "Lets a player use Valheim's admin console: kick, ban and the rest", "Make {player} an admin", "admin", true),
                    listCommand("remove-admin", "Remove Admin", "remove_moderator", "Takes a player's admin console away", "Remove {player} as an admin", "admin", false),
                    listCommand("permit-player", "Permit Player", "how_to_reg", "Adds a player to the permitted list. Once the list has anyone on it, only they can join", "Permit {player}", "permitted", true),
                    listCommand("unpermit-player", "Stop Permitting Player", "person_off", "Takes a player off the permitted list; with nobody left on it, anyone can join", "Stop permitting {player}", "permitted", false),
                ],
                values: [
                    listValue("admins", "Admins", "shield_person", "The players on Valheim's admin list", "admin"),
                    listValue("permitted-players", "Permitted Players", "how_to_reg", "The players on Valheim's permitted list; when it has anyone, only they can join", "permitted"),
                ],
            });
        },
        calls: async () => { const { sharedCalls } = await import("../../service/calls"); return { ...sharedCalls,
            readGameOptions: async (ctx) => { await loadOptions(); return ctx.state.gameSettings; },
            writeGameOptions: async (ctx, { patch }) => {
                if (local.busy) throw new Error("Wait for the Valheim operation to finish");
                if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Options patch is required");
                const current: Record<string, unknown> = {};
                for (const option of options) if (option.kind !== "secret") current[option.id] = optionValue(option, saved());
                const next = validateOptions(options, "Valheim", patch, current);
                serverName(next.name);
                worldName(next.world);
                const password = Object.hasOwn(patch, "password") ? String(patch.password) : await joinPassword.value();
                const problem = passwordProblem(password, String(next.world), next.public === true);
                if (problem) throw new Error(problem);
                if (Object.hasOwn(patch, "password")) await joinPassword.set(password);
                const panel: Record<string, unknown> = {};
                for (const option of options) if (option.kind !== "secret" && Object.hasOwn(patch, option.id)) panel[option.id] = next[option.id];
                if (Object.keys(panel).length > 0) await ctx.updateSettings(panel);
                await loadOptions();
                return ctx.state.gameSettings;
            },
            ...steamInstallCalls(steam, install),
            // the running server's own: options changed since are for its next start
            valheimSession: async () => {
                const run = ctx.state.serverStatus === "online" ? local.run : null;
                return run && { ...run, joinCode: local.session.joinCode, address: local.session.address };
            },
            valheimPlayers: async () => ({
                seen: await lists().seen(),
                online: local.log.online(),
                admin: await lists().read("admin"),
                banned: await lists().read("banned"),
                permitted: await lists().read("permitted"),
            }),
            valheimList: async (ctx, { list, id, name, on }) => {
                if (!isList(list)) throw new Error("Choose the admin, banned or permitted list");
                if (typeof on !== "boolean") throw new Error("Say whether the player goes on the list or off it");
                if (id === null && name === null) throw new Error("Choose a player");
                // the server reads its lists again as it runs, so they change whether it runs or not
                const player = { id: id === null ? null : platformId(id), name: name === null ? undefined : listEntry(name) };
                await setList(list, player, on);
                return true;
            },
        }; },
        loadOptions,
        async initialize(running) {
            local.lists = new ValheimLists(await ctx.root(), await saveDir());
            if (running) {
                // a server that kept running while Paperboard restarted: its console kept the lines that say who is on
                const { run, launch } = await readRun();
                local.run = run;
                local.secrets = [await joinPassword.value()].filter(Boolean);
                for (const line of runLines(ctx.state.serverEntries, launch)) readLine(line, true);
            } else await fs.rm(await runFile(), { force: true });
        },
        async beforeRemove() { if (local.busy) throw new Error("Wait for Valheim's current operation"); },
        async dispose() { local.console.dispose(); },
        async prepareLaunch() {
            assertHost(valheim);
            const install = await installDir();
            if (!(await installedBuild(VALHEIM_APP_ID, install))) throw new Error("Install Valheim in Updates first");
            const executable = path.join(install, "valheim_server.x86_64");
            await fs.access(executable, fs.constants.X_OK);
            const world = worldName(setting("world"));
            const password = await joinPassword.value();
            const problem = passwordProblem(password, world, setting("public") === true);
            if (problem) throw new Error(problem);
            const save = await saveDir();
            await fs.mkdir(save, { recursive: true });
            freshRun();
            local.start.newWorld = !(await worldExists(world));
            local.run = { world, listed: setting("public") === true, crossplay: setting("crossplay") === true };
            const message = `Starting Valheim${saved().version ? ` ${saved().version}` : ""} with ${world}…`;
            await fs.writeFile(await runFile(), JSON.stringify({ run: local.run, launch: message } satisfies RunRecord));
            local.secrets = [password].filter(Boolean);
            const home = path.join(await ctx.root(), "profile");
            await fs.mkdir(home, { recursive: true });
            const port = ctx.runPort(GAME, Number(setting("port")));
            return {
                message,
                command: {
                    executable,
                    args: launchArgs(saved(), { port, saveDir: save, password }),
                    cwd: install,
                    // as the install's start_server.sh: its own libraries, and the game's id for Steam
                    env: { LD_LIBRARY_PATH: path.join(install, "linux64"), SteamAppId: String(VALHEIM_CLIENT_APP_ID), HOME: home, XDG_CONFIG_HOME: path.join(home, ".config") },
                },
            };
        },
        async afterStop() { await fs.rm(await runFile(), { force: true }); },
        isMutating: () => local.busy,
        // A world it already had is up once the server says "Game server connected"; a
        // new one generates its locations after that, and is up once that is done.
        // A password the server refuses makes it quit, and the start says why.
        readiness: { timeoutMs: 15 * 60_000, async probe() {
            const start = local.start;
            if (start.refused !== null) throw new Error(`Valheim refused its join password: ${start.refused}`);
            if (!start.connected || start.generating) return false;
            return !start.newWorld || start.generated;
        } },
        async saveWorld() { throw new Error("Valheim saves its world on its own, every few minutes and as it stops; it can't be asked to save while it runs"); },
        // a world of years takes a while to write
        stopTimeoutMs: 120_000, stopEntry: "Stopping: Valheim saves its world as it quits",
        // Ctrl+C, as the server's manual says to stop it; it saves the world before it exits
        stop: () => ctx.process.kill(PROC, "SIGINT"),
        flushConsole: () => local.console.flush(ctx),
        commandLine() { throw new Error("Valheim's server reads no console commands; manage admins and bans in Players"); },
        observeLine(raw) {
            const line = redact(raw.replace(/\r/g, ""), local.secrets);
            if (!line.trim()) return;
            try { readLine(line); } catch (err) { report(ctx, "Could not read a Valheim log line", err); }
            local.console.push(ctx, line);
        },
        async assertFileAccess(file, write) {
            if (typeof file !== "string") throw new Error("Choose a file");
            if (write && (file === "install" || file.startsWith("install/"))) throw new Error("Installed Valheim files are managed by Updates");
            // the lists can change while it runs, as the server reads them again; its world can't
            const listFile = /^save\/(adminlist|bannedlist|permittedlist)\.txt$/.test(file);
            if (write && !listFile && (local.busy || ctx.state.serverStatus !== "offline")) throw new Error("Stop Valheim before editing its files");
        },
        portNames: [GAME],
        async *ports() {
            yield { name: GAME, label: "Valheim", protocol: "udp", preferred: Number(setting("port")), count: PORTS_IN_A_ROW };
        },
        backup: offlineBackup(ctx, {
            name: "Valheim", processId: PROC, flag: () => local,
            // the server can't be told anything while it runs; its stop saves the world
            announce: async () => {},
            save: async () => {},
            clean: async () => {},
            exitStamp: async () => String(local.saves),
        }),
    };
}

