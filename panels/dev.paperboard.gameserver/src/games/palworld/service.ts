import type { Server } from "../../service/server";
import fs from "node:fs/promises";
import path from "node:path";
import { initialServerState } from "../../service/initialState";
import { TRIGGER_IDS } from "../../service/contract";
import { validateOptions } from "../options";
import { installedBuild } from "../steam/steamcmd";
import { VISUAL_CPP_X64 } from "../windowsRuntime";
import { provideWindowsRuntime } from "../windowsRuntimeInstall";
import { steamInstall, steamInstallCalls, steamUpdateStatus, type SteamInstallSpec } from "../steam/installAction";
import type { GameService } from "../serviceTypes";
import {
    assertHost, exists, fileStamp, hostSupportHere, linkFolder, offlineBackup, playerPoller, pushChat, redact, report,
    serverSecret, settingPort, settled, singleLine, waitUntil, writePrivate,
} from "../serviceKit";
import { palworld, options, PALWORLD_APP_ID } from "./index";
import { decode, encode, parseOptionSettings, writeOptionSettings, type IniEntry } from "./ini";
import { PalworldRest, type PalworldPlayer } from "./rest";
import { PalworldRoster, userId } from "./roster";
import { parseChat } from "./chat";

const GAME = "palworld";
const PROC = "palworld-server";
const DEFAULT_PORT = 8211;
const DEFAULT_REST_PORT = 8212;
// Palworld writes its ban list itself, adding an id only it can derive
const BANS_ONLINE = "Start the server to ban or unban players; Palworld keeps its own ban list";

/**
 * What differs between the Linux and Windows servers. Windows runs the
 * console build directly: PalServer.exe only starts it as a child, which
 * Paperboard could neither stop nor read.
 */
export function palworldPlatform(os: string) {
    if (os === "win32") return { configDir: "WindowsServer", executable: path.join("Pal", "Binaries", "Win64", "PalServer-Win64-Shipping-Cmd.exe"), args: ["Pal"] };
    if (os === "linux") return { configDir: "LinuxServer", executable: "PalServer.sh", args: [] };
    throw new Error(`The Palworld dedicated server does not run on ${os}`);
}
const platform = () => palworldPlatform(process.platform);

/** A console line Palworld writes for a failure. */
const isError = (line: string) => /error|exception|\bfail/i.test(line);

/** One server's part of the game: its process, console, settings files and players are its own. */
export function palworldService(ctx: Server): GameService {
    const local = {
        busy: false,
        rest: null as PalworldRest | null,
        roster: null as PalworldRoster | null,
        secrets: [] as string[],
        // the settings file is read, changed and written back; two of those at once lose one
        ini: Promise.resolve() as Promise<unknown>,
    };

    // Layout: install/ is SteamCMD's folder and is left out of backups; the game
    // writes its worlds and settings to install/Pal/Saved, which links to saved/
    // beside it so they are backed up and survive an update.
    const installDir = async () => path.join(await ctx.root(), "install");
    const savedDir = async () => path.join(await ctx.root(), "saved");
    const configFile = async (name: string) => path.join(await savedDir(), "Config", platform().configDir, name);
    const iniFile = () => configFile("PalWorldSettings.ini");
    /**
     * The settings file, or null on a computer Palworld doesn't run on: there is
     * none there, and the server still loads so setup can say why.
     */
    const iniFileHere = async () => (hostSupportHere(palworld).supported ? iniFile() : null);
    const joinPassword = serverSecret(ctx, GAME, "join-password");
    const adminPassword = serverSecret(ctx, GAME, "admin-password");

    /** The settings file, made from the install's template the first time. */
    async function ensureIni(): Promise<string> {
        const file = await iniFile();
        if (await exists(file)) return file;
        const template = path.join(await installDir(), "DefaultPalWorldSettings.ini");
        if (!(await exists(template))) throw new Error("Install Palworld in Updates first");
        const text = (await fs.readFile(template, "utf8")).split(/\r?\n/).filter((line) => !line.startsWith(";")).join("\n");
        parseOptionSettings(text);
        await writePrivate(file, text);
        return file;
    }
    /** Runs settings-file work after what is already queued, in the order it was asked for. */
    function serialIni<T>(work: () => Promise<T>): Promise<T> {
        const run = local.ini.then(work, work);
        local.ini = Promise.allSettled([run]);
        return run;
    }
    /** Sets these raw values in OptionSettings, keeping every other entry as it is. */
    const updateIni = (values: Record<string, string>): Promise<void> => serialIni(() => rewriteIni(values));
    async function rewriteIni(values: Record<string, string>): Promise<void> {
        const file = await ensureIni();
        const text = await fs.readFile(file, "utf8");
        const entries: IniEntry[] = parseOptionSettings(text).map((e) => (Object.hasOwn(values, e.key) ? { key: e.key, raw: values[e.key]! } : e));
        for (const [key, raw] of Object.entries(values)) if (!entries.some((e) => e.key === key)) entries.push({ key, raw });
        await writePrivate(file, writeOptionSettings(text, entries));
    }
    /**
     * A stopped server's settings hold no passwords, so Files and backups never
     * see them. They are taken out when the process is gone, not once it is up:
     * Palworld reads the file as it starts, but nothing documents that it never
     * reads it again, and a server that lost its join password while running
     * would be open to anyone.
     */
    const stripSecrets = (): Promise<void> => serialIni(async () => {
        const file = await iniFileHere();
        if (file && (await exists(file))) await rewriteIni({ AdminPassword: '""', ServerPassword: '""' });
    });
    const linkSaved = async () => linkFolder(path.join(await installDir(), "Pal", "Saved"), await savedDir());

    const displayVersion = (saved: Record<string, unknown>) =>
        saved.version ? String(saved.version) : saved.build ? `Build ${saved.build}` : "";

    async function loadOptions() {
        const saved = ctx.settings;
        const values: Record<string, unknown> = { port: saved.port ?? DEFAULT_PORT, community: saved.community ?? false };
        const file = await iniFileHere();
        const template = path.join(await installDir(), "DefaultPalWorldSettings.ini");
        const source = file && (await exists(file)) ? file : (await exists(template)) ? template : null;
        if (source) {
            const entries = parseOptionSettings(await fs.readFile(source, "utf8"));
            for (const option of options) {
                if (!option.ini) continue;
                const entry = entries.find((e) => e.key === option.ini!.key);
                if (entry) values[option.id] = decode(entry.raw, option.ini.type, option.ini.key);
            }
        }
        values.password = await joinPassword.found();
        values.adminPassword = await adminPassword.found();
        ctx.setState({ serverSoftware: "palworld", serverVersion: displayVersion(saved), serverPort: String(saved.port ?? DEFAULT_PORT), gameSettings: values });
    }

    function rest(): PalworldRest {
        const client = local.rest;
        if (!client) throw new Error("Palworld is not running");
        return client;
    }
    function roster() { const r = local.roster; if (!r) throw new Error("Palworld's player list is not ready"); return r; }

    const players = playerPoller(ctx, {
        game: "Palworld",
        id: (p: PalworldPlayer) => p.userId,
        list: async () => rest().players(),
        remember: (list) => roster().remember(list),
    });

    /** The world Palworld runs: GameUserSettings.ini names its folder under SaveGames/0. */
    async function worldDir(): Promise<string> {
        const name = /^DedicatedServerName=([0-9A-Fa-f]+)\s*$/m.exec(await fs.readFile(await configFile("GameUserSettings.ini"), "utf8"))?.[1];
        if (!name) throw new Error("Palworld's GameUserSettings.ini names no world");
        return path.join(await savedDir(), "SaveGames", "0", name);
    }
    /** null until Palworld first writes the world: a new one has no Level.sav before its first save */
    const worldStamp = async () => {
        const file = path.join(await worldDir(), "Level.sav");
        return await exists(file) ? fileStamp(file, "Palworld's Level.sav") : null;
    };

    /** Saves through the REST API and waits for Level.sav to change; an answer alone is not a save. */
    async function save() {
        if (ctx.state.serverStatus !== "online") throw new Error("Start Palworld before saving");
        const before = await worldStamp();
        await rest().save();
        await waitUntil(async () => { const now = await worldStamp(); return now !== null && now !== before; }, 60_000, "Palworld to write Level.sav");
    }

    const steam: SteamInstallSpec = {
        game: palworld, appId: PALWORLD_APP_ID,
        installDir, flag: () => local, loadOptions,
        async afterInstall() { await linkSaved(); await ensureIni(); await stripSecrets(); },
    };
    const install = steamInstall(ctx, steam);

    return {
        primaryProcessId: PROC, processIds: [PROC],
        backupExclude: ["install"],
        updateStatus: () => steamUpdateStatus(steam),
        installUpdate: install,
        initialState: () => ({ ...initialServerState(), serverSoftware: "palworld", serverPort: String(DEFAULT_PORT), serverMotd: "" }),
        blocks: async () => {
            const { mergeBlocks, onlyIdNamed, playerEvents, rosterBlocks, runGameCall } = await import("../../service/blocks");
            // Palworld kicks and bans by user id: a block's player name is looked up
            // among the players online, then the ones the server has seen
            const known = async () => [...players.online(), ...await roster().seen()];
            const nameOf = (p: { name: string }) => p.name;
            const idOf = (p: { userId: string }) => p.userId;
            return mergeBlocks({ events: playerEvents() }, rosterBlocks({
                kick: (name) => runGameCall(ctx, "palworldKick", { userId: onlyIdNamed(name, players.online(), nameOf, idOf, "online") }),
                ban: async (name) => runGameCall(ctx, "palworldBan", { userId: onlyIdNamed(name, await known(), nameOf, idOf, "on this server") }),
                unban: async (name) => {
                    const bans = new Set(await roster().bans());
                    // listed by their user id when Paperboard never saw them
                    if (bans.has(name)) return runGameCall(ctx, "palworldUnban", { userId: name });
                    const banned = (await roster().seen()).filter((p) => bans.has(p.userId));
                    return runGameCall(ctx, "palworldUnban", { userId: onlyIdNamed(name, banned, nameOf, idOf, "banned") });
                },
                // a ban of a player Paperboard never saw shows as their user id, as the Players tab shows it
                banned: async () => {
                    const seen = new Map((await roster().seen()).map((p) => [p.userId, p.name]));
                    return (await roster().bans()).map((id) => seen.get(id) ?? id);
                },
            }));
        },
        calls: async () => { const { sharedCalls } = await import("../../service/calls"); return { ...sharedCalls,
            readGameOptions: async (ctx) => { await loadOptions(); return ctx.state.gameSettings; },
            writeGameOptions: async (ctx, { patch }) => {
                if (local.busy) throw new Error("Wait for the Palworld operation to finish");
                if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Options patch is required");
                validateOptions(options, "Palworld", patch);
                const raw: Record<string, string> = {};
                for (const option of options) if (option.ini && Object.hasOwn(patch, option.id)) raw[option.ini.key] = encode(patch[option.id], option.ini.type, option.label);
                if (Object.keys(raw).length > 0) await updateIni(raw);
                if (Object.hasOwn(patch, "password")) await joinPassword.set(String(patch.password));
                if (Object.hasOwn(patch, "adminPassword")) await adminPassword.set(String(patch.adminPassword));
                const panel: Record<string, unknown> = {};
                for (const id of ["port", "community"]) if (Object.hasOwn(patch, id)) panel[id] = patch[id];
                if (Object.keys(panel).length > 0) await ctx.updateSettings(panel);
                await loadOptions();
                return ctx.state.gameSettings;
            },
            ...steamInstallCalls(steam, install),
            palworldMetrics: () => rest().metrics(),
            palworldPlayers: async () => ({ seen: await roster().seen(), bans: await roster().bans(), online: [...players.online()] }),
            palworldKick: async (ctx, { userId: id }) => {
                const checked = userId(id);
                if (!settled(ctx, "Palworld") || !players.online().some((p) => p.userId === checked)) throw new Error("That player is not online");
                await rest().kick(checked);
                await players.poll();
                return true;
            },
            palworldBan: async (ctx, { userId: id }) => {
                const checked = userId(id);
                if (!settled(ctx, "Palworld")) throw new Error(BANS_ONLINE);
                await rest().ban(checked);
                await players.poll();
                return true;
            },
            palworldUnban: async (ctx, { userId: id }) => {
                const checked = userId(id);
                if (!settled(ctx, "Palworld")) throw new Error(BANS_ONLINE);
                await rest().unban(checked);
                return true;
            },
        }; },
        loadOptions,
        async initialize(running) {
            local.roster = new PalworldRoster(await ctx.root(), await savedDir());
            if (running) {
                // reattaching to a running server: talk to it with the password it started with
                const saved = ctx.settings;
                const password = await adminPassword.value();
                if (!password) throw new Error("Palworld is running without the admin password Paperboard set; stop it from the computer and start it again here");
                local.rest = new PalworldRest(ctx.runPort("palworld-rest", Number(saved.restPort ?? DEFAULT_REST_PORT)), password);
                local.secrets = [password, await joinPassword.value()].filter(Boolean);
                players.start(true);
                void rest().metrics()
                    .then((metrics) => ctx.setState({ maxPlayers: metrics.maxplayernum }))
                    .catch((err) => report(ctx, "Could not read Palworld's player limit", err));
            } else await stripSecrets();
        },
        async beforeRemove() { if (local.busy) throw new Error("Wait for Palworld's current operation"); },
        async dispose() {
            players.stop();
        },
        async prepareLaunch() {
            assertHost(palworld);
            const saved = ctx.settings;
            const install = await installDir();
            if (!(await installedBuild(PALWORLD_APP_ID, install))) throw new Error("Install Palworld in Updates first");
            const { executable: relative, args } = platform();
            const executable = path.join(install, relative);
            await fs.access(executable, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
            if (process.platform === "win32") await provideWindowsRuntime(VISUAL_CPP_X64, path.dirname(executable));
            await linkSaved();
            const admin = await adminPassword.ensure();
            const join = await joinPassword.value();
            const restPort = ctx.runPort("palworld-rest", Number(saved.restPort ?? DEFAULT_REST_PORT));
            await updateIni({
                AdminPassword: encode(admin, "string", "Admin password"),
                ServerPassword: encode(join, "string", "Join password"),
                RESTAPIEnabled: "True",
                RESTAPIPort: String(restPort),
                // RCON is deprecated; the REST API replaces it
                RCONEnabled: "False",
                // the console parsing reads text lines
                LogFormatType: "Text",
            });
            local.rest = new PalworldRest(restPort, admin);
            local.secrets = [admin, join].filter(Boolean);
            // Linux keeps the game's own files out of the user's home folder
            const env: Record<string, string> = {};
            if (process.platform !== "win32") {
                const home = path.join(await ctx.root(), "profile");
                await fs.mkdir(home, { recursive: true });
                Object.assign(env, { HOME: home, XDG_DATA_HOME: home });
            }
            const port = ctx.runPort("palworld", Number(saved.port ?? DEFAULT_PORT));
            return {
                message: `Starting Palworld${saved.version ? ` ${saved.version}` : ""}…`,
                command: {
                    executable,
                    args: [...args, `-port=${port}`, ...(saved.community ? ["-publiclobby"] : [])],
                    cwd: install,
                    env,
                },
            };
        },
        afterStop: stripSecrets,
        isMutating: () => local.busy,
        readiness: { timeoutMs: 600_000, async probe() {
            try { await rest().info(); }
            catch (err) {
                // the API is not listening until the world has loaded
                if (err instanceof Error && err.message.includes("did not answer")) return false;
                throw err;
            }
            const max = await rest().metrics();
            ctx.setState({ maxPlayers: max.maxplayernum });
            players.start();
            return true;
        } },
        saveWorld: save,
        stopTimeoutMs: 120_000, stopEntry: "shutdown",
        // Palworld saves before it shuts down
        stop: () => rest().shutdown(1, "The server is stopping."),
        commandLine() { throw new Error("Palworld has no console; use Players, Save and Stop"); },
        async sendChat(message) {
            const line = singleLine(message, "Message");
            await rest().announce(line);
            // Palworld does not log announcements; the console and chat show what went out
            ctx.console.say("info", `[Announcement] ${line}`);
            pushChat(ctx, { event: "server", content: line, text: `<Server> ${line}` });
        },
        observeLine(raw) {
            const line = redact(raw.replace(/\r/g, ""), local.secrets);
            // every REST call is logged, including the player polls, and followed by a blank line
            if (!line.trim() || /\[LOG\] REST accessed endpoint /.test(line)) return;
            const version = /^Game version is v([\d.]+)/.exec(line)?.[1];
            if (version) void (async () => {
                if (ctx.settings.version !== version) await ctx.updateSettings({ version });
                ctx.setState({ serverVersion: version });
            })().catch((err) => report(ctx, "Could not record Palworld's version", err));
            try {
                const said = parseChat(line, players.online().map((p) => p.name));
                if (said) ctx.trigger(TRIGGER_IDS.chatMessage, pushChat(ctx, { sender: said.sender, content: said.content, text: `<${said.sender}> ${said.content}` }));
            } catch (err) { report(ctx, "Could not read a chat message", err); }
            ctx.console.push(line, isError(line));
        },
        async assertFileAccess(file, write) {
            if (typeof file !== "string") throw new Error("Choose a file");
            if (write && (file === "install" || file.startsWith("install/"))) throw new Error("Installed Palworld files are managed by Updates");
            if (file.endsWith("PalWorldSettings.ini")) {
                if (ctx.state.serverStatus !== "offline") throw new Error("Stop Palworld to open PalWorldSettings.ini; while it runs the file holds the admin password");
                await stripSecrets();
            }
            if (write && (local.busy || ctx.state.serverStatus !== "offline")) throw new Error("Stop Palworld before editing its files");
        },
        portNames: ["palworld", "palworld-rest"],
        async *ports() {
            const saved = ctx.settings;
            yield settingPort({ name: "palworld", label: "Palworld", protocol: "udp", key: "port", fallback: DEFAULT_PORT }, saved);
            yield settingPort({ name: "palworld-rest", label: "Palworld REST API", protocol: "tcp", key: "restPort", fallback: DEFAULT_REST_PORT }, saved);
        },
        backup: offlineBackup(ctx, {
            name: "Palworld", processId: PROC, flag: () => local,
            announce: () => rest().announce("The server is stopping for a backup and will be back shortly."),
            save, clean: stripSecrets,
        }),
    };
}
