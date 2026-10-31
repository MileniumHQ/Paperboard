import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { config, files, processApi, type ServiceContext } from "../../service/api";
import { fileApi as rawFiles, defineAction, secretsApi } from "@mileniumhq/paperapi";
import { currentServer, serverLocal } from "../../service/scope";
import { initialServerState } from "../../service/initialState";
import { appendCapped, PANEL_ID, type GameServerState } from "../../service/types";
import { startServerInstance, stopServerInstance } from "../../service/lifecycle";
import type { GameService } from "../serviceTypes";
import { terraria } from "./index";
import { configText, singleLine, validateOptions, worldName } from "./config";
import { releases, releaseFor, entrypoint } from "./catalog";
import { install, recoverRelease } from "./install";
import { discardUpload, importUpload, inspectUpload, listWorlds, trashWorld } from "./worldStore";
import { WORLD_GENERATION } from "./index";
import { parseConsoleLine, playerName, PlayerStore, stripPrompt, type ConsoleEvent } from "./roster";
import { TRIGGER_IDS } from "../../service/contract";
import { chatId } from "../../lib/logs";
import type { ChatMessage } from "../../service/types";
const PROC = "terraria-server";
type Context = ServiceContext<GameServerState>;
const local = serverLocal(() => ({ busy: false, ready: false, password: "", prompts: 0, partialPrompt: false, logTimer: null as ReturnType<typeof setTimeout> | null, pending: [] as string[], queries: 0, listed: [] as { name: string; address: string }[], store: null as PlayerStore | null }));
const root = () => files.getPath("", PANEL_ID);
const settings = async () => await config.get<Record<string, unknown>>(PANEL_ID) ?? {};
function host() { const support = terraria.hostSupport({ os: process.platform, arch: process.arch }, { software: "vanilla", version: "" }); if (!support.supported) throw new Error(support.reason); }
function secretKey() { const id = currentServer()?.server.id; if (!id) throw new Error("Terraria requires a server scope"); return `${id}-terraria-join-password`; }
async function marker() { const id = currentServer()?.server.id; if (!id) throw new Error("Terraria requires a server scope"); return rawFiles.getPath(`.terraria-resume/${id}`, PANEL_ID); }
async function generate(password: string) {
    const directory = await root();
    await fs.mkdir(path.join(directory, "worlds"), { recursive: true });
    const file = path.join(directory, "serverconfig.txt");
    let existing = "";
    try { existing = await fs.readFile(file, "utf8"); } catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
    const text = configText(directory, await settings(), password, existing);
    await fs.writeFile(file, text, { mode: 0o600 });
    await fs.chmod(file, 0o600);
}
async function loadOptions(ctx: Context) {
    const saved = await settings();
    const password = await secretsApi.get(secretKey(), PANEL_ID);
    ctx.setState({ serverSoftware: "vanilla", serverVersion: String(saved.version ?? ""), serverPort: String(saved.port ?? 7777), serverMotd: String(saved.motd ?? ""), gameSettings: { ...saved, password: password.found } });
}
async function waitUntil(check: () => boolean | Promise<boolean>, ms: number, label: string) {
    const deadline = Date.now() + ms;
    while (!(await check())) { if (Date.now() >= deadline) throw new Error(`Timed out waiting for Terraria ${label}`); await new Promise(r => setTimeout(r, 50)); }
}
async function worldStamp(): Promise<string> {
    const saved = await settings();
    const stat = await fs.stat(path.join(await root(), "worlds", `${worldName(saved.world ?? "World")}.wld`), { bigint: true });
    if (stat.size <= 0n) throw new Error("Terraria world file is empty");
    return `${stat.ino}:${stat.mtimeNs}:${stat.size}`;
}
export async function save(ctx: Context) {
    if (ctx.state.serverStatus !== "online") throw new Error("Start Terraria before saving");
    const before = await worldStamp(); const prompts = local().prompts;
    await processApi.write(PROC, "save\n");
    // 1.4.5.8 prints no 'World saved' line. Its console returns ': ' only
    // after save/validation/backup finishes. Require both that response and
    // a changed, nonempty world file; a prompt alone is not a save proof.
    await waitUntil(async () => local().prompts > prompts && await worldStamp() !== before, 120_000, "save completion (console prompt and changed world file)");
}

async function offline(ctx: Context) {
    if (local().busy) throw new Error("Wait for the Terraria operation to finish");
    if (ctx.state.serverStatus === "offline") { await generate(""); return; }
    if (ctx.state.serverStatus !== "online") throw new Error("Terraria is starting or stopping; wait before backup/restore");
    local().busy = true;
    try {
        await processApi.write(PROC, "say Server stopping for backup or restore.\n");
        await save(ctx);
        // Outside the source: restored snapshots must never decide whether to restart.
        const resume = await marker(); await fs.mkdir(path.dirname(resume), { recursive: true });
        await fs.writeFile(resume, "resume after offline operation\n", { mode: 0o600 });
        const savedBeforeExit = await worldStamp();
        await stopServerInstance(ctx);
        await waitUntil(async () => !(await processApi.exists(PROC)), 125_000, "graceful exit");
        await generate("");
        if (await worldStamp() === savedBeforeExit) throw new Error("Terraria exited without confirming its shutdown save; no backup was copied");
    } finally { local().busy = false; }
}
async function exclusive<T>(ctx: Context, work: () => Promise<T>): Promise<T> {
    if (local().busy || ctx.state.serverStatus !== "offline") throw new Error("Stop Terraria and wait for the current operation to finish");
    local().busy = true;
    try { return await work(); } finally { local().busy = false; }
}
/** Set up by initialize, so console lines can queue roster writes before they publish state. */
function store() { const s = local().store; if (!s) throw new Error("Terraria's player roster is not ready"); return s; }
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** Background roster work has no caller to throw to, so its failures land in the console. */
function report(ctx: Context, what: string, err: unknown) {
    ctx.setState(prev => ({ serverEntries: appendCapped(prev.serverEntries, { type: "error", content: `[Paperboard] ${what}: ${err instanceof Error ? err.message : String(err)}` }) }));
}
/** Asks the server who is connected; the answer is read back by observeLine and kept out of the console. */
function queryPlayers(ctx: Context) {
    local().queries++;
    processApi.write(PROC, "playing\n").catch(err => { local().queries = Math.max(0, local().queries - 1); report(ctx, "Could not list Terraria's players", err); });
}
/** The online player's name as Terraria spells it; kick and ban match it exactly. */
function onlineName(ctx: Context, name: string) {
    const status = ctx.state.serverStatus;
    if (status !== "online" && status !== "offline") throw new Error("Wait for Terraria to finish starting or stopping");
    return status === "online" ? ctx.state.onlinePlayers.find(p => sameName(p, name)) : undefined;
}
function chat(ctx: Context, message: Omit<ChatMessage, "id" | "timestamp">) {
    const entry = { ...message, id: chatId(), timestamp: new Date().toTimeString().slice(0, 8) };
    ctx.setState(prev => ({ chatMessages: appendCapped(prev.chatMessages, entry) }));
    return entry;
}
/** Applies a console line to the roster and chat. Returns true for an answer to Paperboard's own `playing`. */
function observePlayers(ctx: Context, event: ConsoleEvent): boolean {
    switch (event.kind) {
        case "join": {
            ctx.setState(prev => ({
                onlinePlayers: prev.onlinePlayers.some(p => sameName(p, event.name)) ? prev.onlinePlayers : [...prev.onlinePlayers, event.name],
                seenPlayers: prev.seenPlayers.some(p => sameName(p, event.name)) ? prev.seenPlayers : appendCapped(prev.seenPlayers, event.name),
            }));
            chat(ctx, { event: "join", sender: event.name, text: `${event.name} has joined.` });
            ctx.emitTrigger(TRIGGER_IDS.playerJoined, event.name);
            // the join line has no address; `playing` lists it for bans
            queryPlayers(ctx);
            return false;
        }
        case "leave": {
            store().remember(event.name).catch(err => report(ctx, `Could not record ${event.name} leaving`, err));
            ctx.setState(prev => ({ onlinePlayers: prev.onlinePlayers.filter(p => !sameName(p, event.name)) }));
            chat(ctx, { event: "leave", sender: event.name, text: `${event.name} has left.` });
            ctx.emitTrigger(TRIGGER_IDS.playerLeft, event.name);
            return false;
        }
        case "chat": {
            ctx.emitTrigger(TRIGGER_IDS.chatMessage, chat(ctx, { sender: event.sender, content: event.content, text: `<${event.sender}> ${event.content}` }));
            return false;
        }
        case "server": {
            chat(ctx, { event: "server", content: event.content, text: `<Server> ${event.content}` });
            return false;
        }
        case "listed": {
            local().listed = [...local().listed, { name: event.name, address: event.address }];
            return local().queries > 0;
        }
        case "count": {
            const listed = local().listed; local().listed = [];
            const ours = local().queries > 0;
            if (ours) local().queries--;
            const s = store();
            Promise.all(listed.map(p => s.remember(p.name, p.address))).catch(err => report(ctx, "Could not record Terraria's players", err));
            ctx.setState(prev => ({
                onlinePlayers: listed.map(p => p.name),
                seenPlayers: listed.reduce((seen, p) => seen.some(s => sameName(s, p.name)) ? seen : appendCapped(seen, p.name), prev.seenPlayers),
            }));
            return ours;
        }
    }
}
async function onServerStarted(ctx: Context) {
    const max = Number((await settings()).maxplayers ?? 8);
    ctx.setState({ maxPlayers: max });
    queryPlayers(ctx);
}
const action = (id: string, name: string, run: (ctx: Context, input: any) => any) => defineAction({ id, name, category: "Server", description: name, internal: true, inputs: {}, run });
export const terrariaService: GameService = {
    primaryProcessId: PROC, processIds: [PROC],
    initialState: () => ({ ...initialServerState(), serverSoftware: "vanilla", serverPort: "7777", serverMotd: "" }),
    actions: async () => { const { sharedActions, backupAction } = await import("../../service/actions"); return [ ...sharedActions, backupAction,
        action("read-game-options", "Read options", async ctx => { await loadOptions(ctx); return ctx.state.gameSettings; }),
        action("write-game-options", "Save options", (ctx, { patch }) => exclusive(ctx, async () => {
            if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Options patch is required");
            const next = validateOptions(patch, await settings());
            if (Object.hasOwn(patch, "password")) {
                if (patch.password) await secretsApi.set(secretKey(), patch.password, PANEL_ID);
                else await secretsApi.delete(secretKey(), PANEL_ID);
            }
            await config.set(next, PANEL_ID); await generate(""); await loadOptions(ctx); return ctx.state.gameSettings;
        })),
        action("terraria-versions", "Terraria releases", () => ({ releases, host: terraria.hostSupport({ os: process.platform, arch: process.arch }, { software: "vanilla", version: "" }) })),
        action("terraria-install", "Install Terraria", (ctx, { version }) => exclusive(ctx, async () => {
            host(); releaseFor(version);
            const previous = await settings();
            if (previous.version && previous.version !== version) throw new Error("Back up and retain the old server before changing Terraria world formats");
            await install(ctx, version);
            await config.set({ ...previous, software: "vanilla", version, configured: true }, PANEL_ID);
            await generate(""); await loadOptions(ctx); return true;
        })),
        action("terraria-worlds", "Terraria worlds", async () => listWorlds(path.join(await root(), "worlds"), worldName((await settings()).world ?? "World"))),
        action("terraria-world", "Select or create world", (ctx, { name, create, generation }) => exclusive(ctx, async () => {
            const nameChecked = worldName(name);
            const file = path.join(await root(), "worlds", `${nameChecked}.wld`);
            const exists = await fs.stat(file).then(s => s.isFile(), err => { if (err.code === "ENOENT") return false; throw err; });
            if (create ? exists : !exists) throw new Error(create ? "This world already exists; select it instead" : "The selected .wld world does not exist");
            let next = { ...await settings(), world: nameChecked };
            if (create && generation !== undefined) {
                // a new world's size, difficulty and seed; Terraria reads them on the start that creates it
                if (!generation || typeof generation !== "object" || Object.keys(generation).some(k => !WORLD_GENERATION.includes(k))) throw new Error(`New world settings are ${WORLD_GENERATION.join(", ")}`);
                next = { ...validateOptions(generation, next), world: nameChecked };
            }
            await config.set(next, PANEL_ID);
            await generate(""); await loadOptions(ctx); return true;
        })),
        action("terraria-world-delete", "Delete world", (ctx, { name }) => exclusive(ctx, async () => { await trashWorld(await root(), name); return true; })),
        action("terraria-world-inspect", "Read uploaded world", async (_ctx, { file }) => inspectUpload(await root(), file)),
        action("terraria-world-import", "Add uploaded world", async (_ctx, { file, name }) => { await importUpload(await root(), file, name); return true; }),
        action("terraria-world-discard", "Discard uploaded world", async (_ctx, { file }) => { await discardUpload(await root(), file); return true; }),
        action("terraria-save", "Save Terraria world", save),
        action("terraria-players", "Terraria players", async () => ({ seen: await store().seen(), bans: await store().bans() })),
        action("terraria-kick", "Kick player", async (ctx, { name }) => {
            const online = onlineName(ctx, playerName(name));
            if (!online) throw new Error(`${name} is not online`);
            await processApi.write(PROC, `kick ${online}\n`);
            return true;
        }),
        action("terraria-ban", "Ban player", async (ctx, { name }) => {
            const checked = playerName(name);
            const online = onlineName(ctx, checked);
            // an online ban kicks them and records their address itself
            if (online) await processApi.write(PROC, `ban ${online}\n`);
            else await store().banOffline(checked);
            return true;
        }),
        // Terraria re-reads banlist.txt on every connection, so an unban applies at once
        action("terraria-unban", "Unban player", async (_ctx, { name }) => { await store().unban(playerName(name)); return true; }),
        action("terraria-motd", "Set message of the day", async (ctx, { motd }) => {
            if (local().busy) throw new Error("Wait for the Terraria operation to finish");
            const status = ctx.state.serverStatus;
            if (status !== "online" && status !== "offline") throw new Error("Wait for Terraria to finish starting or stopping");
            await config.set(validateOptions({ motd }, await settings()), PANEL_ID);
            // a running server takes the new message at once; its console has
            // no way to clear one, so an empty message waits for the next start
            let appliesOnRestart = false;
            if (status === "offline") await generate("");
            else if (motd) await processApi.write(PROC, `motd ${motd}\n`);
            else appliesOnRestart = true;
            await loadOptions(ctx);
            return { appliesOnRestart };
        }),
    ]; },
    loadOptions,
    async initialize(ctx, running) {
        local().password = (await secretsApi.get(secretKey(), PANEL_ID)).value ?? "";
        local().store = new PlayerStore(await root());
        // reattaching to a running server: learn who is on it
        if (running) await onServerStarted(ctx);
        if (!running) {
            for (const release of releases) await recoverRelease(path.join(await root(), "install", release.directory));
            await generate("");
        }
        const resume = await marker();
        if (await fs.stat(resume).then(() => true, err => { if (err.code === "ENOENT") return false; throw err; })) {
            if (!running) await startServerInstance(ctx);
            await fs.unlink(resume);
        }
    },
    async beforeRemove() { if (local().busy) throw new Error("Wait for Terraria's current operation"); },
    async dispose() { if (local().logTimer) clearTimeout(local().logTimer!); local().logTimer = null; }, readIcon: async () => null,
    async prepareLaunch(ctx) {
        host();
        const saved = await settings(); const release = releaseFor(String(saved.version));
        const directory = await root(); const installDir = path.join(directory, "install", release.directory);
        const record = JSON.parse(await fs.readFile(path.join(installDir, "manifest.json"), "utf8"));
        if (record.sha256 !== release.sha256 || record.os !== process.platform || record.arch !== process.arch) throw new Error("Terraria install manifest does not match this release and host; reinstall");
        const executable = path.join(installDir, entrypoint(process.platform)); await fs.access(executable, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
        local().password = (await secretsApi.get(secretKey(), PANEL_ID)).value ?? "";
        await generate(local().password); local().ready = false;
        const home = path.join(directory, "profile"); await fs.mkdir(home, { recursive: true });
        return { message: `Starting Terraria ${release.version}…`, command: { executable, args: ["-config", path.join(directory, "serverconfig.txt"), "-noupnp"], cwd: path.dirname(executable), env: { HOME: home, XDG_DATA_HOME: home, LD_LIBRARY_PATH: path.join(path.dirname(executable), "lib64"), MONO_CONFIG: path.join(path.dirname(executable), "monoconfig") } } };
    },
    isMutating: () => local().busy,
    readiness: { timeoutMs: 300_000, async probe(ctx) {
        if (!local().ready) return false;
        return new Promise((resolve, reject) => {
            const socket = net.connect({ host: "127.0.0.1", port: Number(ctx.state.serverPort) });
            socket.setTimeout(1000); socket.once("connect", () => { socket.destroy(); resolve(true); });
            socket.once("error", err => { socket.destroy(); if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") resolve(false); else reject(new Error(`Terraria listener probe failed: ${err.message}`)); });
            socket.once("timeout", () => { socket.destroy(); reject(new Error("Terraria listener probe timed out")); });
        });
    } },
    stopTimeoutMs: 120_000, stopEntry: "exit", stop: () => processApi.write(PROC, "exit\n"),
    commandLine(command) { const line = singleLine(command, "Command").trim(); if (/^(password|exit-nosave)\b/i.test(line)) throw new Error("Use Options for the password and Stop for a saved shutdown"); return `${line}\n`; },
    sendChat: (_ctx, message) => processApi.write(PROC, `say ${singleLine(message, "Message")}\n`),
    observePartialLine(_ctx, line) {
        const prompt = /^: $/.test(line);
        if (prompt && !local().partialPrompt) { local().prompts++; local().ready = true; }
        local().partialPrompt = prompt;
    },
    observeLine(ctx, raw) {
        const line = local().password ? raw.replaceAll(local().password, "[redacted]") : raw;
        if (/Server started|Listening on port/i.test(line)) local().ready = true;
        local().partialPrompt = false;
        if (stripPrompt(line) === "Server started") void onServerStarted(ctx).catch(err => report(ctx, "Could not read Terraria's player limit", err));
        const event = parseConsoleLine(line);
        if (event && observePlayers(ctx, event)) return;
        local().pending = [...local().pending, line.replace(/\r/g, "")].slice(-1000);
        if (!local().logTimer) local().logTimer = setTimeout(() => {
            local().logTimer = null;
            const lines = local().pending; local().pending = [];
            ctx.setState({ serverEntries: [...ctx.state.serverEntries, ...lines.map(content => ({ type: /error|exception/i.test(content) ? "error" as const : "info" as const, content }))].slice(-1000) });
        }, 100);
    },
    async assertFileAccess(ctx, file, write) {
        if (typeof file !== "string") throw new Error("Choose a file");
        if (file === "serverconfig.txt") throw new Error("Use Options for generated serverconfig.txt (contains vault credentials while running)");
        if (write && (file.startsWith("install/") || file.startsWith(".terraria-"))) throw new Error("Installed Terraria files are managed by Versions");
        if (write && (local().busy || ctx.state.serverStatus !== "offline")) throw new Error("Stop Terraria before editing its files");
    },
    portNames: ["terraria"],
    async *ports(ctx) {
        const saved = await settings();
        yield { name: "terraria", label: "Terraria", protocol: "tcp", preferred: Number(saved.port ?? 7777), async write(port) { await config.set({ ...await settings(), port }, PANEL_ID); ctx.setState({ serverPort: String(port) }); await generate(""); } };
    },
    backup: { mode: "offline", before: offline, recover: async () => {}, async withConsistentData(ctx, work) { await offline(ctx); return work(); } },
};
