import fs from "node:fs/promises";
import path from "node:path";
import { serverLocal } from "../../service/scope";
import { initialServerState } from "../../service/initialState";
import { appendCapped } from "../../service/types";
import { ACTION_IDS, TRIGGER_IDS } from "../../service/contract";
import { validateOptions } from "../options";
import { installedBuild } from "../steam/steamcmd";
import { VISUAL_CPP_X64 } from "../windowsRuntime";
import { provideWindowsRuntime } from "../windowsRuntimeInstall";
import { steamInstall, steamInstallActions, steamUpdateStatus, type SteamInstallSpec } from "../steam/installAction";
import type { GameService } from "../serviceTypes";
import {
    ConsoleBuffer, assertHost, exists, fileStamp, gameAction, linkFolder, offlineBackup, pushChat, readSettings, redact, report,
    resumeAfterBackup, serverRoot, serverSecret, settingPort, settled, singleLine, updateSettings, waitUntil, writePrivate, type Context,
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
const POLL_MS = 5_000;

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

const local = serverLocal(() => ({
    busy: false,
    rest: null as PalworldRest | null,
    roster: null as PalworldRoster | null,
    poll: null as ReturnType<typeof setInterval> | null,
    online: [] as PalworldPlayer[],
    // the first answer after reattaching lists who was already there; they did not just join
    baseline: false,
    pollError: "",
    secrets: [] as string[],
    // the settings file is read, changed and written back; two of those at once lose one
    ini: Promise.resolve() as Promise<unknown>,
    console: new ConsoleBuffer((line) => /error|exception|\bfail/i.test(line)),
}));

// Layout: install/ is SteamCMD's folder and is left out of backups; the game
// writes its worlds and settings to install/Pal/Saved, which links to saved/
// beside it so they are backed up and survive an update.
const installDir = async () => path.join(await serverRoot(), "install");
const savedDir = async () => path.join(await serverRoot(), "saved");
const configFile = async (name: string) => path.join(await savedDir(), "Config", platform().configDir, name);
const iniFile = () => configFile("PalWorldSettings.ini");
const joinPassword = serverSecret(GAME, "join-password");
const adminPassword = serverSecret(GAME, "admin-password");

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
    const run = local().ini.then(work, work);
    local().ini = Promise.allSettled([run]);
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
    if (await exists(await iniFile())) await rewriteIni({ AdminPassword: '""', ServerPassword: '""' });
});
const linkSaved = async () => linkFolder(path.join(await installDir(), "Pal", "Saved"), await savedDir());

const displayVersion = (saved: Record<string, unknown>) =>
    saved.version ? String(saved.version) : saved.build ? `Build ${saved.build}` : "";

async function loadOptions(ctx: Context) {
    const saved = await readSettings();
    const values: Record<string, unknown> = { port: saved.port ?? DEFAULT_PORT, community: saved.community ?? false };
    const file = await iniFile();
    const template = path.join(await installDir(), "DefaultPalWorldSettings.ini");
    const source = (await exists(file)) ? file : (await exists(template)) ? template : null;
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
    const client = local().rest;
    if (!client) throw new Error("Palworld is not running");
    return client;
}
function roster() { const r = local().roster; if (!r) throw new Error("Palworld's player list is not ready"); return r; }

/** Asks the server who is online; joins and leaves are the difference from the last answer. */
async function pollPlayers(ctx: Context) {
    if (ctx.state.serverStatus !== "online") return;
    let players: PalworldPlayer[];
    try { players = await rest().players(); }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // one notice in the console per failure, not one every few seconds
        if (message !== local().pollError && ctx.state.serverStatus === "online") report(ctx, "Could not list Palworld's players", err);
        else console.debug(`[palworld] players poll failed again: ${message}`);
        local().pollError = message;
        return;
    }
    local().pollError = "";
    const before = new Map(local().online.map((p) => [p.userId, p]));
    const now = new Map(players.map((p) => [p.userId, p]));
    local().online = players;
    ctx.setState((prev) => ({
        onlinePlayers: players.map((p) => p.name),
        seenPlayers: players.reduce((seen, p) => (seen.includes(p.name) ? seen : appendCapped(seen, p.name)), prev.seenPlayers),
    }));
    if (local().baseline) local().baseline = false;
    else {
        for (const [id, p] of now) if (!before.has(id)) {
            pushChat(ctx, { event: "join", sender: p.name, text: `${p.name} joined the game` });
            ctx.emitTrigger(TRIGGER_IDS.playerJoined, p.name);
        }
        for (const [id, p] of before) if (!now.has(id)) {
            pushChat(ctx, { event: "leave", sender: p.name, text: `${p.name} left the game` });
            ctx.emitTrigger(TRIGGER_IDS.playerLeft, p.name);
        }
    }
    roster().remember(players).catch((err) => report(ctx, "Could not record Palworld's players", err));
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

/** The world Palworld runs: GameUserSettings.ini names its folder under SaveGames/0. */
async function worldDir(): Promise<string> {
    const name = /^DedicatedServerName=([0-9A-Fa-f]+)\s*$/m.exec(await fs.readFile(await configFile("GameUserSettings.ini"), "utf8"))?.[1];
    if (!name) throw new Error("Palworld's GameUserSettings.ini names no world");
    return path.join(await savedDir(), "SaveGames", "0", name);
}
/** null until Palworld first writes the world: a new one has no Level.sav before its first save */
export const worldStamp = async () => {
    const file = path.join(await worldDir(), "Level.sav");
    return await exists(file) ? fileStamp(file, "Palworld's Level.sav") : null;
};

/** Saves through the REST API and waits for Level.sav to change; an answer alone is not a save. */
export async function save(ctx: Context) {
    if (ctx.state.serverStatus !== "online") throw new Error("Start Palworld before saving");
    const before = await worldStamp();
    await rest().save();
    await waitUntil(async () => { const now = await worldStamp(); return now !== null && now !== before; }, 60_000, "Palworld to write Level.sav");
}

const steam: SteamInstallSpec = {
    game: palworld, appId: PALWORLD_APP_ID, ids: { info: "palworld-info", latest: "palworld-latest", install: "palworld-install" },
    installDir, flag: local, loadOptions,
    async afterInstall() { await linkSaved(); await ensureIni(); await stripSecrets(); },
};

export const palworldService: GameService = {
    primaryProcessId: PROC, processIds: [PROC],
    backupExclude: ["install"],
    updateStatus: () => steamUpdateStatus(steam),
    installUpdate: steamInstall(steam),
    initialState: () => ({ ...initialServerState(), serverSoftware: "palworld", serverPort: String(DEFAULT_PORT), serverMotd: "" }),
    actions: async () => { const { sharedActions, backupAction } = await import("../../service/actions"); return [...sharedActions, backupAction,
        gameAction(ACTION_IDS.readGameOptions, "Read options", async (ctx) => { await loadOptions(ctx); return ctx.state.gameSettings; }),
        gameAction(ACTION_IDS.writeGameOptions, "Save options", async (ctx, { patch }) => {
            if (local().busy) throw new Error("Wait for the Palworld operation to finish");
            if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Options patch is required");
            validateOptions(options, "Palworld", patch);
            const raw: Record<string, string> = {};
            for (const option of options) if (option.ini && Object.hasOwn(patch, option.id)) raw[option.ini.key] = encode(patch[option.id], option.ini.type, option.label);
            if (Object.keys(raw).length > 0) await updateIni(raw);
            if (Object.hasOwn(patch, "password")) await joinPassword.set(patch.password);
            if (Object.hasOwn(patch, "adminPassword")) await adminPassword.set(patch.adminPassword);
            const panel: Record<string, unknown> = {};
            for (const id of ["port", "community"]) if (Object.hasOwn(patch, id)) panel[id] = patch[id];
            if (Object.keys(panel).length > 0) await updateSettings(panel);
            await loadOptions(ctx);
            return ctx.state.gameSettings;
        }),
        ...steamInstallActions(steam),
        gameAction("palworld-metrics", "Palworld server health", () => rest().metrics()),
        gameAction("palworld-players", "Palworld players", async () => ({ seen: await roster().seen(), bans: await roster().bans(), online: local().online })),
        gameAction("palworld-kick", "Kick player", async (ctx, { userId: id }) => {
            const checked = userId(id);
            if (!settled(ctx, "Palworld") || !local().online.some((p) => p.userId === checked)) throw new Error("That player is not online");
            await rest().kick(checked);
            await pollPlayers(ctx);
            return true;
        }),
        gameAction("palworld-ban", "Ban player", async (ctx, { userId: id }) => {
            const checked = userId(id);
            if (!settled(ctx, "Palworld")) throw new Error(BANS_ONLINE);
            await rest().ban(checked);
            await pollPlayers(ctx);
            return true;
        }),
        gameAction("palworld-unban", "Unban player", async (ctx, { userId: id }) => {
            const checked = userId(id);
            if (!settled(ctx, "Palworld")) throw new Error(BANS_ONLINE);
            await rest().unban(checked);
            return true;
        }),
    ]; },
    loadOptions,
    async initialize(ctx, running) {
        local().roster = new PalworldRoster(await serverRoot(), await savedDir());
        if (running) {
            // reattaching to a running server: talk to it with the password it started with
            const saved = await readSettings();
            const password = await adminPassword.value();
            if (!password) throw new Error("Palworld is running without the admin password Paperboard set; stop it from the computer and start it again here");
            local().rest = new PalworldRest(Number(saved.restPort ?? DEFAULT_REST_PORT), password);
            local().secrets = [password, await joinPassword.value()].filter(Boolean);
            local().baseline = true;
            startPolling(ctx);
            void rest().metrics()
                .then((metrics) => ctx.setState({ maxPlayers: metrics.maxplayernum }))
                .catch((err) => report(ctx, "Could not read Palworld's player limit", err));
        } else await stripSecrets();
        await resumeAfterBackup(ctx, GAME, running);
    },
    async beforeRemove() { if (local().busy) throw new Error("Wait for Palworld's current operation"); },
    async dispose() {
        stopPolling();
        local().console.dispose();
    },
    async prepareLaunch() {
        assertHost(palworld);
        const saved = await readSettings();
        const install = await installDir();
        if (!(await installedBuild(PALWORLD_APP_ID, install))) throw new Error("Install Palworld in Updates first");
        const { executable: relative, args } = platform();
        const executable = path.join(install, relative);
        await fs.access(executable, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
        if (process.platform === "win32") await provideWindowsRuntime(VISUAL_CPP_X64, path.dirname(executable));
        await linkSaved();
        const admin = await adminPassword.ensure();
        const join = await joinPassword.value();
        const restPort = Number(saved.restPort ?? DEFAULT_REST_PORT);
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
        local().rest = new PalworldRest(restPort, admin);
        local().secrets = [admin, join].filter(Boolean);
        stopPolling();
        // Linux keeps the game's own files out of the user's home folder
        const env: Record<string, string> = {};
        if (process.platform !== "win32") {
            const home = path.join(await serverRoot(), "profile");
            await fs.mkdir(home, { recursive: true });
            Object.assign(env, { HOME: home, XDG_DATA_HOME: home });
        }
        const port = Number(saved.port ?? DEFAULT_PORT);
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
    isMutating: () => local().busy,
    readiness: { timeoutMs: 600_000, async probe(ctx) {
        try { await rest().info(); }
        catch (err) {
            // the API is not listening until the world has loaded
            if (err instanceof Error && err.message.includes("did not answer")) return false;
            throw err;
        }
        const max = await rest().metrics();
        ctx.setState({ maxPlayers: max.maxplayernum });
        startPolling(ctx);
        return true;
    } },
    saveWorld: save,
    stopTimeoutMs: 120_000, stopEntry: "shutdown",
    // Palworld saves before it shuts down
    stop: () => rest().shutdown(1, "The server is stopping."),
    commandLine() { throw new Error("Palworld has no console; use Players, Save world and Stop"); },
    async sendChat(ctx, message) {
        const line = singleLine(message, "Message");
        await rest().announce(line);
        // Palworld does not log announcements; the console and chat show what went out
        ctx.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type: "info", content: `[Announcement] ${line}` }) }));
        pushChat(ctx, { event: "server", content: line, text: `<Server> ${line}` });
    },
    observeLine(ctx, raw) {
        const line = redact(raw.replace(/\r/g, ""), local().secrets);
        // every REST call is logged, including the player polls, and followed by a blank line
        if (!line.trim() || /\[LOG\] REST accessed endpoint /.test(line)) return;
        const version = /^Game version is v([\d.]+)/.exec(line)?.[1];
        if (version) void (async () => {
            if ((await readSettings()).version !== version) await updateSettings({ version });
            ctx.setState({ serverVersion: version });
        })().catch((err) => report(ctx, "Could not record Palworld's version", err));
        try {
            const said = parseChat(line, local().online.map((p) => p.name));
            if (said) ctx.emitTrigger(TRIGGER_IDS.chatMessage, pushChat(ctx, { sender: said.sender, content: said.content, text: `<${said.sender}> ${said.content}` }));
        } catch (err) { report(ctx, "Could not read a chat message", err); }
        local().console.push(ctx, line);
    },
    async assertFileAccess(ctx, file, write) {
        if (typeof file !== "string") throw new Error("Choose a file");
        if (write && (file === "install" || file.startsWith("install/"))) throw new Error("Installed Palworld files are managed by Updates");
        if (file.endsWith("PalWorldSettings.ini")) {
            if (ctx.state.serverStatus !== "offline") throw new Error("Stop Palworld to open PalWorldSettings.ini; while it runs the file holds the admin password");
            await stripSecrets();
        }
        if (write && (local().busy || ctx.state.serverStatus !== "offline")) throw new Error("Stop Palworld before editing its files");
    },
    portNames: ["palworld", "palworld-rest"],
    async *ports(ctx) {
        const saved = await readSettings();
        yield settingPort({ name: "palworld", label: "Palworld", protocol: "udp", key: "port", fallback: DEFAULT_PORT, onWrite: (port) => ctx.setState({ serverPort: String(port) }) }, saved);
        yield settingPort({ name: "palworld-rest", label: "Palworld REST API", protocol: "tcp", key: "restPort", fallback: DEFAULT_REST_PORT }, saved);
    },
    backup: offlineBackup({
        gameId: GAME, name: "Palworld", processId: PROC, flag: local,
        announce: () => rest().announce("The server is stopping for a backup and will be back shortly."),
        save, clean: stripSecrets,
    }),
};
