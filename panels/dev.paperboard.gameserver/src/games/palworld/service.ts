import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { config, files, processApi, type ServiceContext } from "../../service/api";
import { fileApi as rawFiles, defineAction, secretsApi } from "@mileniumhq/paperapi";
import { currentServer, serverLocal } from "../../service/scope";
import { initialServerState } from "../../service/initialState";
import { appendCapped, PANEL_ID, type ChatMessage, type GameServerState } from "../../service/types";
import { chatId } from "../../lib/logs";
import { startServerInstance, stopServerInstance } from "../../service/lifecycle";
import { ACTION_IDS, TRIGGER_IDS } from "../../service/contract";
import { validateOptions } from "../options";
import { installApp, installedBuild } from "../steam/steamcmd";
import type { GameService } from "../serviceTypes";
import { palworld, options, PALWORLD_APP_ID } from "./index";
import { decode, encode, parseOptionSettings, writeOptionSettings, type IniEntry } from "./ini";
import { PalworldRest, type PalworldPlayer } from "./rest";
import { PalworldRoster, userId } from "./roster";
import { parseChat } from "./chat";

const PROC = "palworld-server";
const DEFAULT_PORT = 8211;
const DEFAULT_REST_PORT = 8212;
// Palworld writes its ban list itself, adding an id only it can derive
const BANS_ONLINE = "Start the server to ban or unban players; Palworld keeps its own ban list";
const POLL_MS = 5_000;
type Context = ServiceContext<GameServerState>;

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
    pending: [] as string[],
    logTimer: null as ReturnType<typeof setTimeout> | null,
}));

// Layout: install/ is SteamCMD's folder and is left out of backups; the game
// writes its worlds and settings to install/Pal/Saved, which links to saved/
// beside it so they are backed up and survive an update.
const root = () => files.getPath("", PANEL_ID);
const installDir = async () => path.join(await root(), "install");
const savedDir = async () => path.join(await root(), "saved");
const iniFile = async () => path.join(await savedDir(), "Config", "LinuxServer", "PalWorldSettings.ini");
const settings = async () => (await config.get<Record<string, unknown>>(PANEL_ID)) ?? {};

function serverId() { const id = currentServer()?.server.id; if (!id) throw new Error("Palworld requires a server scope"); return id; }
const joinKey = () => `${serverId()}-palworld-join-password`;
const adminKey = () => `${serverId()}-palworld-admin-password`;
async function marker() { return rawFiles.getPath(`.palworld-resume/${serverId()}`, PANEL_ID); }

function host() {
    const support = palworld.hostSupport({ os: process.platform, arch: process.arch }, { software: "", version: "" });
    if (!support.supported) throw new Error(support.reason);
}
function singleLine(value: unknown, label: string): string {
    if (typeof value !== "string" || /[\r\n\0]/.test(value)) throw new Error(`${label} must be a single line`);
    return value;
}
async function exists(file: string): Promise<boolean> {
    return fs.lstat(file).then(() => true, (err: NodeJS.ErrnoException) => { if (err.code === "ENOENT") return false; throw err; });
}

/** The settings file, made from the install's template the first time. */
async function ensureIni(): Promise<string> {
    const file = await iniFile();
    if (await exists(file)) return file;
    const template = path.join(await installDir(), "DefaultPalWorldSettings.ini");
    if (!(await exists(template))) throw new Error("Install Palworld in Updates first");
    const text = (await fs.readFile(template, "utf8")).split(/\r?\n/).filter((line) => !line.startsWith(";")).join("\n");
    parseOptionSettings(text);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, { mode: 0o600 });
    return file;
}
/** Sets these raw values in OptionSettings, keeping every other entry as it is. */
async function updateIni(values: Record<string, string>): Promise<void> {
    const file = await ensureIni();
    const text = await fs.readFile(file, "utf8");
    const entries: IniEntry[] = parseOptionSettings(text).map((e) => (Object.hasOwn(values, e.key) ? { key: e.key, raw: values[e.key]! } : e));
    for (const [key, raw] of Object.entries(values)) if (!entries.some((e) => e.key === key)) entries.push({ key, raw });
    await fs.writeFile(file, writeOptionSettings(text, entries), { mode: 0o600 });
    await fs.chmod(file, 0o600);
}
/** A stopped server's settings hold no passwords, so Files and backups never see them. */
async function stripSecrets(): Promise<void> {
    if (await exists(await iniFile())) await updateIni({ AdminPassword: '""', ServerPassword: '""' });
}

/** Points install/Pal/Saved at saved/, moving anything the game already wrote there. */
async function linkSaved(): Promise<void> {
    const install = await installDir();
    const saved = await savedDir();
    const link = path.join(install, "Pal", "Saved");
    await fs.mkdir(saved, { recursive: true });
    const stat = await fs.lstat(link).catch((err: NodeJS.ErrnoException) => { if (err.code === "ENOENT") return null; throw err; });
    if (stat?.isSymbolicLink()) {
        if (path.resolve(path.dirname(link), await fs.readlink(link)) === saved) return;
        await fs.unlink(link);
    } else if (stat?.isDirectory()) {
        for (const entry of await fs.readdir(link)) {
            if (await exists(path.join(saved, entry))) throw new Error(`Palworld's ${entry} is in both install/Pal/Saved and saved/; move one aside in Files`);
            await fs.rename(path.join(link, entry), path.join(saved, entry));
        }
        await fs.rmdir(link);
    } else if (stat) throw new Error("install/Pal/Saved is a file; remove it in Files");
    await fs.mkdir(path.dirname(link), { recursive: true });
    await fs.symlink(path.relative(path.dirname(link), saved), link, "dir");
}

const displayVersion = (saved: Record<string, unknown>) =>
    saved.version ? String(saved.version) : saved.build ? `Build ${saved.build}` : "";

async function loadOptions(ctx: Context) {
    const saved = await settings();
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
    values.password = (await secretsApi.get(joinKey(), PANEL_ID)).found;
    values.adminPassword = (await secretsApi.get(adminKey(), PANEL_ID)).found;
    ctx.setState({ serverSoftware: "palworld", serverVersion: displayVersion(saved), serverPort: String(saved.port ?? DEFAULT_PORT), gameSettings: values });
}

function rest(): PalworldRest {
    const client = local().rest;
    if (!client) throw new Error("Palworld is not running");
    return client;
}
/** Background work has no caller to throw to, so its failures land in the console. */
function report(ctx: Context, what: string, err: unknown) {
    ctx.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type: "error", content: `[Paperboard] ${what}: ${err instanceof Error ? err.message : String(err)}` }) }));
}
function roster() { const r = local().roster; if (!r) throw new Error("Palworld's player list is not ready"); return r; }

function chat(ctx: Context, message: Omit<ChatMessage, "id" | "timestamp">) {
    const entry = { ...message, id: chatId(), timestamp: new Date().toTimeString().slice(0, 8) };
    ctx.setState((prev) => ({ chatMessages: appendCapped(prev.chatMessages, entry) }));
    return entry;
}

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
            chat(ctx, { event: "join", sender: p.name, text: `${p.name} joined the game` });
            ctx.emitTrigger(TRIGGER_IDS.playerJoined, p.name);
        }
        for (const [id, p] of before) if (!now.has(id)) {
            chat(ctx, { event: "leave", sender: p.name, text: `${p.name} left the game` });
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
    const settingsFile = path.join(await savedDir(), "Config", "LinuxServer", "GameUserSettings.ini");
    const name = /^DedicatedServerName=([0-9A-Fa-f]+)\s*$/m.exec(await fs.readFile(settingsFile, "utf8"))?.[1];
    if (!name) throw new Error("Palworld's GameUserSettings.ini names no world");
    return path.join(await savedDir(), "SaveGames", "0", name);
}
async function worldStamp(): Promise<string> {
    const stat = await fs.stat(path.join(await worldDir(), "Level.sav"), { bigint: true });
    if (stat.size <= 0n) throw new Error("Palworld's Level.sav is empty");
    return `${stat.ino}:${stat.mtimeNs}:${stat.size}`;
}
async function waitUntil(check: () => Promise<boolean>, ms: number, label: string) {
    const deadline = Date.now() + ms;
    while (!(await check())) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for Palworld ${label}`);
        await new Promise((r) => setTimeout(r, 100));
    }
}

/** Saves through the REST API and waits for Level.sav to change; an answer alone is not a save. */
export async function save(ctx: Context) {
    if (ctx.state.serverStatus !== "online") throw new Error("Start Palworld before saving");
    const before = await worldStamp();
    await rest().save();
    await waitUntil(async () => (await worldStamp()) !== before, 60_000, "to write Level.sav");
}

async function offline(ctx: Context) {
    if (local().busy) throw new Error("Wait for the Palworld operation to finish");
    if (ctx.state.serverStatus === "offline") { await stripSecrets(); return; }
    if (ctx.state.serverStatus !== "online") throw new Error("Palworld is starting or stopping; wait before backup or restore");
    local().busy = true;
    try {
        await rest().announce("The server is stopping for a backup and will be back shortly.");
        await save(ctx);
        // outside the source: a restored snapshot must never decide whether to restart
        const resume = await marker();
        await fs.mkdir(path.dirname(resume), { recursive: true });
        await fs.writeFile(resume, "resume after offline operation\n", { mode: 0o600 });
        await stopServerInstance(ctx);
        await waitUntil(async () => !(await processApi.exists(PROC)), 125_000, "to exit");
        await stripSecrets();
    } finally { local().busy = false; }
}
async function exclusive<T>(ctx: Context, work: () => Promise<T>): Promise<T> {
    if (local().busy || ctx.state.serverStatus !== "offline") throw new Error("Stop Palworld and wait for the current operation to finish");
    local().busy = true;
    try { return await work(); } finally { local().busy = false; }
}
function online(ctx: Context): boolean {
    const status = ctx.state.serverStatus;
    if (status !== "online" && status !== "offline") throw new Error("Wait for Palworld to finish starting or stopping");
    return status === "online";
}

const action = (id: string, name: string, run: (ctx: Context, input: any) => any) => defineAction({ id, name, category: "Server", description: name, internal: true, inputs: {}, run });

export const palworldService: GameService = {
    primaryProcessId: PROC, processIds: [PROC],
    backupExclude: ["install"],
    initialState: () => ({ ...initialServerState(), serverSoftware: "palworld", serverPort: String(DEFAULT_PORT), serverMotd: "" }),
    actions: async () => { const { sharedActions, backupAction } = await import("../../service/actions"); return [...sharedActions, backupAction,
        action(ACTION_IDS.readGameOptions, "Read options", async (ctx) => { await loadOptions(ctx); return ctx.state.gameSettings; }),
        action(ACTION_IDS.writeGameOptions, "Save options", async (ctx, { patch }) => {
            if (local().busy) throw new Error("Wait for the Palworld operation to finish");
            if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Options patch is required");
            validateOptions(options, "Palworld", patch);
            const raw: Record<string, string> = {};
            for (const option of options) if (option.ini && Object.hasOwn(patch, option.id)) raw[option.ini.key] = encode(patch[option.id], option.ini.type, option.label);
            if (Object.keys(raw).length > 0) await updateIni(raw);
            for (const [id, key] of [["password", joinKey()], ["adminPassword", adminKey()]] as const) {
                if (!Object.hasOwn(patch, id)) continue;
                if (patch[id]) await secretsApi.set(key, patch[id], PANEL_ID);
                else await secretsApi.delete(key, PANEL_ID);
            }
            const panel: Record<string, unknown> = {};
            for (const id of ["port", "community"]) if (Object.hasOwn(patch, id)) panel[id] = patch[id];
            if (Object.keys(panel).length > 0) await config.set({ ...(await settings()), ...panel }, PANEL_ID);
            await loadOptions(ctx);
            return ctx.state.gameSettings;
        }),
        action("palworld-info", "Palworld install", async () => {
            const saved = await settings();
            return { host: palworld.hostSupport({ os: process.platform, arch: process.arch }, { software: "", version: "" }), build: await installedBuild(PALWORLD_APP_ID, await installDir()), version: saved.version ?? null };
        }),
        action("palworld-install", "Install or update Palworld", (ctx) => exclusive(ctx, async () => {
            host();
            ctx.setState({ installProgress: { stage: "downloading", percent: 0 } });
            let last = "";
            try {
                const build = await installApp(PALWORLD_APP_ID, await installDir(), {
                    onProgress: ({ stage, percent }) => {
                        const next = { stage: stage === "verifying" ? "verifying" as const : "downloading" as const, percent: Math.floor(percent) };
                        if (`${next.stage}${next.percent}` === last) return;
                        last = `${next.stage}${next.percent}`;
                        ctx.setState({ installProgress: next });
                    },
                });
                ctx.setState({ installProgress: { stage: "installing", percent: 100 } });
                await linkSaved();
                await ensureIni();
                await stripSecrets();
                await config.set({ ...(await settings()), configured: true, build }, PANEL_ID);
                ctx.setState({ installProgress: { stage: "completed", percent: 100 } });
            } catch (err) {
                ctx.setState({ installProgress: { stage: "error", percent: 0 } });
                throw err;
            }
            await loadOptions(ctx);
            return true;
        })),
        action("palworld-players", "Palworld players", async () => ({ seen: await roster().seen(), bans: await roster().bans(), online: local().online })),
        action("palworld-kick", "Kick player", async (ctx, { userId: id }) => {
            const checked = userId(id);
            if (!online(ctx) || !local().online.some((p) => p.userId === checked)) throw new Error("That player is not online");
            await rest().kick(checked);
            await pollPlayers(ctx);
            return true;
        }),
        action("palworld-ban", "Ban player", async (ctx, { userId: id }) => {
            const checked = userId(id);
            if (!online(ctx)) throw new Error(BANS_ONLINE);
            await rest().ban(checked);
            await pollPlayers(ctx);
            return true;
        }),
        action("palworld-unban", "Unban player", async (ctx, { userId: id }) => {
            const checked = userId(id);
            if (!online(ctx)) throw new Error(BANS_ONLINE);
            await rest().unban(checked);
            return true;
        }),
    ]; },
    loadOptions,
    async initialize(ctx, running) {
        local().roster = new PalworldRoster(await root(), await savedDir());
        if (running) {
            // reattaching to a running server: talk to it with the password it started with
            const saved = await settings();
            const password = (await secretsApi.get(adminKey(), PANEL_ID)).value;
            if (!password) throw new Error("Palworld is running without the admin password Paperboard set; stop it from the computer and start it again here");
            local().rest = new PalworldRest(Number(saved.restPort ?? DEFAULT_REST_PORT), password);
            local().secrets = [password, (await secretsApi.get(joinKey(), PANEL_ID)).value ?? ""].filter(Boolean);
            local().baseline = true;
            startPolling(ctx);
            void rest().metrics()
                .then((metrics) => ctx.setState({ maxPlayers: metrics.maxplayernum }))
                .catch((err) => report(ctx, "Could not read Palworld's player limit", err));
        } else await stripSecrets();
        const resume = await marker();
        if (await exists(resume)) {
            if (!running) await startServerInstance(ctx);
            await fs.unlink(resume);
        }
    },
    async beforeRemove() { if (local().busy) throw new Error("Wait for Palworld's current operation"); },
    async dispose() {
        stopPolling();
        if (local().logTimer) clearTimeout(local().logTimer!);
        local().logTimer = null;
    },
    readIcon: async () => null,
    async prepareLaunch(ctx) {
        host();
        const saved = await settings();
        const install = await installDir();
        const build = await installedBuild(PALWORLD_APP_ID, install);
        if (!build) throw new Error("Install Palworld in Updates first");
        const script = path.join(install, "PalServer.sh");
        await fs.access(script, fs.constants.X_OK);
        await linkSaved();
        let admin = (await secretsApi.get(adminKey(), PANEL_ID)).value;
        if (!admin) {
            admin = randomBytes(18).toString("base64url");
            await secretsApi.set(adminKey(), admin, PANEL_ID);
        }
        const join = (await secretsApi.get(joinKey(), PANEL_ID)).value ?? "";
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
        const home = path.join(await root(), "profile");
        await fs.mkdir(home, { recursive: true });
        const port = Number(saved.port ?? DEFAULT_PORT);
        return {
            message: `Starting Palworld${saved.version ? ` ${saved.version}` : ""}…`,
            command: { executable: script, args: [`-port=${port}`, ...(saved.community ? ["-publiclobby"] : [])], cwd: install, env: { HOME: home, XDG_DATA_HOME: home } },
        };
    },
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
        chat(ctx, { event: "server", content: line, text: `<Server> ${line}` });
    },
    observeLine(ctx, raw) {
        let line = raw.replace(/\r/g, "");
        // every REST call is logged, including the player polls, and followed by a blank line
        if (!line.trim() || /\[LOG\] REST accessed endpoint /.test(line)) return;
        for (const secret of local().secrets) line = line.replaceAll(secret, "[redacted]");
        const version = /^Game version is v([\d.]+)/.exec(line)?.[1];
        if (version) void (async () => {
            const saved = await settings();
            if (saved.version !== version) await config.set({ ...saved, version }, PANEL_ID);
            ctx.setState({ serverVersion: version });
        })().catch((err) => report(ctx, "Could not record Palworld's version", err));
        try {
            const said = parseChat(line, local().online.map((p) => p.name));
            if (said) ctx.emitTrigger(TRIGGER_IDS.chatMessage, chat(ctx, { sender: said.sender, content: said.content, text: `<${said.sender}> ${said.content}` }));
        } catch (err) { report(ctx, "Could not read a chat message", err); }
        local().pending = [...local().pending, line].slice(-1000);
        if (!local().logTimer) local().logTimer = setTimeout(() => {
            local().logTimer = null;
            const lines = local().pending;
            local().pending = [];
            ctx.setState({ serverEntries: [...ctx.state.serverEntries, ...lines.map((content) => ({ type: /error|exception|\bfail/i.test(content) ? "error" as const : "info" as const, content }))].slice(-1000) });
        }, 100);
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
        const saved = await settings();
        yield { name: "palworld", label: "Palworld", protocol: "udp", preferred: Number(saved.port ?? DEFAULT_PORT), async write(port) { await config.set({ ...(await settings()), port }, PANEL_ID); ctx.setState({ serverPort: String(port) }); } };
        yield { name: "palworld-rest", label: "Palworld REST API", protocol: "tcp", preferred: Number(saved.restPort ?? DEFAULT_REST_PORT), async write(port) { await config.set({ ...(await settings()), restPort: port }, PANEL_ID); } };
    },
    backup: { mode: "offline", before: offline, recover: async () => {}, async withConsistentData(ctx, work) { await offline(ctx); return work(); } },
};
