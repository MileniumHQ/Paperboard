/**
 * What every game's service does the same way: settings, vault keys, the
 * console, chat, waits, one operation at a time, offline backups and links.
 * Game modules keep only what is theirs; nothing here names a game.
 */
import { exists, unlessMissing } from "../service/failures";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { files, processApi, readSettings, updateSettings, type ServiceContext } from "../service/api";
import { fileApi as rawFiles, problemsApi, secretsApi, errorMessage } from "@mileniumhq/paperapi";
import { currentServer, emitTrigger, serverLocal, serverOf } from "../service/scope";
import { TRIGGER_IDS } from "../service/contract";
import { appendCapped, PANEL_ID, type ChatMessage, type ConsoleLine, type GameServerState } from "../service/types";
import { chatId } from "../lib/logs";
import type { GameDefinition, GameOptions } from "./types";
import type { GameService, PortSpec } from "./serviceTypes";

export type Context = ServiceContext<GameServerState>;

/** The current server's folder. */
export const serverRoot = () => files.getPath("", PANEL_ID);
export { exists, readSettings, unlessMissing, updateSettings };

function serverId(game: string): string {
    const id = currentServer()?.server.id;
    if (!id) throw new Error(`${game} requires a server scope`);
    return id;
}

/** A secret one server keeps in the vault, such as a join password. */
export interface ServerSecret {
    key(): string;
    value(): Promise<string>;
    found(): Promise<boolean>;
    /** An empty value removes it. */
    set(value: string): Promise<void>;
    /** The saved value, or a new random one saved first; for passwords only Paperboard uses. */
    ensure(): Promise<string>;
}
/** `<server id>-<game id>-<name>` in the vault. */
export function serverSecret(gameId: string, name: string): ServerSecret {
    const key = () => `${serverId(gameId)}-${gameId}-${name}`;
    const secret: ServerSecret = {
        key,
        value: async () => (await secretsApi.get(key(), PANEL_ID)).value ?? "",
        found: async () => (await secretsApi.get(key(), PANEL_ID)).found,
        async set(value) {
            if (value) await secretsApi.set(key(), value, PANEL_ID);
            else await secretsApi.delete(key(), PANEL_ID);
        },
        async ensure() {
            const saved = await secret.value();
            if (saved) return saved;
            const made = randomBytes(18).toString("base64url");
            await secretsApi.set(key(), made, PANEL_ID);
            return made;
        },
    };
    return secret;
}

/** Throws the game's reason when it can't run on this computer. */
export function assertHost(game: GameDefinition, options: GameOptions = { software: "", version: "" }) {
    const support = hostSupportHere(game, options);
    if (!support.supported) throw new Error(support.reason);
}
export const hostSupportHere = (game: GameDefinition, options: GameOptions = { software: "", version: "" }) =>
    game.hostSupport({ os: process.platform, arch: process.arch }, options);

/**
 * Background work has no caller to throw to: its failure is a line in the
 * server's console, and the panel's problem under the server's name until
 * the same work reports again or clears it (settle).
 */
export function report(ctx: Context, what: string, err: unknown) {
    const message = errorMessage(err);
    const { server } = serverOf(ctx, what);
    ctx.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type: "error", content: `[Paperboard] ${what}: ${message}` }) }));
    problemsApi.report(PANEL_ID, { key: `${server.id}:${what}`, title: `${server.name}: ${what}`, message });
}
/** The work `report` said failed (the same `what`) has worked since: its problem goes. */
export function settle(ctx: Context, what: string) {
    problemsApi.clear(PANEL_ID, `${serverOf(ctx, what).server.id}:${what}`);
}
/** Adds a message to the chat and returns it as triggers send it. */
export function pushChat(ctx: Context, message: Omit<ChatMessage, "id" | "timestamp">): ChatMessage {
    const entry = { ...message, id: chatId(), timestamp: new Date().toTimeString().slice(0, 8) };
    ctx.setState((prev) => ({ chatMessages: appendCapped(prev.chatMessages, entry) }));
    return entry;
}

export { singleLine } from "./options";

/** How often a game that is asked for its players is asked while it runs. */
const PLAYER_POLL_MS = 5_000;

/**
 * The players of a game that tells who is online only when asked (a REST or
 * remote console request), asked every few seconds while it runs: joins and
 * leaves are the difference from the last answer. A tick waits while a
 * request is still out, and an answer a newer request or a stop replaced is
 * dropped, so a slow answer never rewinds the list or repeats a join.
 */
export function playerPoller<P extends { name: string }>(spec: {
    game: string;
    id(player: P): string;
    list(): Promise<P[]>;
    remember(players: P[]): Promise<void>;
}) {
    const local = serverLocal(() => ({ timer: null as ReturnType<typeof setInterval> | null, online: [] as P[], baseline: false, error: "", latest: 0, asking: false }));
    /** Asks now; resolves once the answer is in the state (or dropped). */
    async function poll(ctx: Context): Promise<void> {
        if (ctx.state.serverStatus !== "online") return;
        const state = local();
        const asked = ++state.latest;
        state.asking = true;
        let players: P[];
        try {
            players = await spec.list();
        } catch (err) {
            if (asked !== state.latest) return;
            state.asking = false;
            const message = errorMessage(err);
            // one notice in the console per failure, not one every few seconds
            if (message !== state.error && ctx.state.serverStatus === "online") report(ctx, `Could not list ${spec.game}'s players`, err);
            state.error = message;
            return;
        }
        if (asked !== state.latest) return;
        state.asking = false;
        if (state.error) settle(ctx, `Could not list ${spec.game}'s players`);
        state.error = "";
        const before = new Map(state.online.map((p) => [spec.id(p), p]));
        const now = new Map(players.map((p) => [spec.id(p), p]));
        state.online = players;
        ctx.setState((prev) => ({
            onlinePlayers: players.map((p) => p.name),
            seenPlayers: players.reduce((seen, p) => (seen.includes(p.name) ? seen : appendCapped(seen, p.name)), prev.seenPlayers),
        }));
        if (state.baseline) state.baseline = false;
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
        spec.remember(players).catch((err) => report(ctx, `Could not record ${spec.game}'s players`, err));
    }
    function stop() {
        const state = local();
        if (state.timer) clearInterval(state.timer);
        Object.assign(state, { timer: null, online: [], baseline: false, error: "", latest: state.latest + 1, asking: false });
    }
    return {
        /** who answered online last */
        online: (): readonly P[] => local().online,
        poll,
        /** `baseline`: the first answer is who was already there (a reattach), not who joined */
        start(ctx: Context, baseline = false) {
            const state = local();
            if (state.timer) return;
            state.baseline = baseline;
            state.timer = setInterval(() => {
                if (ctx.state.serverStatus === "offline") stop();
                else if (!local().asking) void poll(ctx);
            }, PLAYER_POLL_MS);
            void poll(ctx);
        },
        stop,
    };
}
/** Polls until the check passes; the label finishes "Timed out waiting for …". */
export async function waitUntil(check: () => boolean | Promise<boolean>, ms: number, label: string, pollMs = 100) {
    const deadline = Date.now() + ms;
    while (!(await check())) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
        await new Promise((r) => setTimeout(r, pollMs));
    }
}
/** Changes whenever a file is rewritten, even within the same second; an empty file is refused. */
export async function fileStamp(file: string, label: string): Promise<string> {
    const stat = await fs.stat(file, { bigint: true });
    if (stat.size <= 0n) throw new Error(`${label} is empty`);
    return `${stat.ino}:${stat.mtimeNs}:${stat.size}`;
}
/** Writes a file only this user can read; Windows has no mode bits, so there it is an ordinary file in the server folder. */
export async function writePrivate(file: string, text: string) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, { mode: 0o600 });
    await fs.chmod(file, 0o600);
}

/** The per-server flag that keeps a game's long operations from overlapping. */
export interface BusyFlag { busy: boolean }
/** Runs work while the server is stopped and nothing else of the game's is running. */
export async function exclusive<T>(ctx: Context, flag: BusyFlag, game: string, work: () => Promise<T>): Promise<T> {
    if (flag.busy || ctx.state.serverStatus !== "offline") throw new Error(`Stop ${game} and wait for the current operation to finish`);
    flag.busy = true;
    try { return await work(); } finally { flag.busy = false; }
}
/** True when online, false when offline; starting or stopping refuses. */
export function settled(ctx: Context, game: string): boolean {
    const status = ctx.state.serverStatus;
    if (status !== "online" && status !== "offline") throw new Error(`Wait for ${game} to finish starting or stopping`);
    return status === "online";
}

/** Hides values from console lines: passwords the game was started with. */
export function redact(line: string, secrets: readonly string[]): string {
    for (const secret of secrets) if (secret) line = line.replaceAll(secret, "[redacted]");
    return line;
}

const CONSOLE_LINES = 1000;
const PERCENT = /\d{1,3}(?:\.\d+)?%/g;

/**
 * A progress line's step: the line with its counts masked, so "Loading world
 * data: 27%" and a new world's "95.4% - Clean up - 63.9%" (overall and step
 * count) each match their next count. Null for a line that doesn't end in one.
 */
export function progressStep(line: string): string | null {
    const trimmed = line.trim();
    if (!/\d{1,3}(?:\.\d+)?%$/.test(trimmed)) return null;
    return trimmed.replace(PERCENT, "%");
}

// how far back a progress line looks for its step's earlier count
const PROGRESS_LOOKBACK = 32;

/**
 * Adds a line to a console's lines. A progress line replaces its step's
 * earlier count when only progress lines stand between them, so a start
 * shows "Loading world data: 100%" once, not a hundred times, even while
 * Terraria reprints "Finalizing world" between each of its other counts.
 * Any other line in between keeps the earlier count.
 */
function addConsoleLine<T>(lines: T[], line: T, text: (line: T) => string): T[] {
    const step = progressStep(text(line));
    if (step !== null) {
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - PROGRESS_LOOKBACK); i--) {
            const earlier = progressStep(text(lines[i]!));
            if (earlier === null) break;
            if (earlier === step) return [...lines.slice(0, i), ...lines.slice(i + 1), line];
        }
    }
    return [...lines, line];
}

/**
 * Console lines gathered for a tenth of a second and published together, so a
 * chatty server costs one state update per batch rather than one per line.
 */
export class ConsoleBuffer {
    private pending: string[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    constructor(private readonly isError: (line: string) => boolean) {}
    push(ctx: Context, line: string) {
        // a game's first line can start with byte order marks (Terraria writes one each start): they are no text
        line = line.replace(/^\uFEFF+/, "");
        if (!line) return;
        this.pending = addConsoleLine(this.pending, line, String).slice(-CONSOLE_LINES);
        if (this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            const lines = this.pending;
            this.pending = [];
            // added to what is published now: a line written in between keeps the old progress line
            let entries: ConsoleLine[] = ctx.state.serverEntries;
            for (const content of lines) entries = addConsoleLine(entries, { type: this.isError(content) ? "error" : "info", content }, (entry) => String(entry.content));
            ctx.setState({ serverEntries: entries.slice(-CONSOLE_LINES) });
        }, 100);
    }
    dispose() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.pending = [];
    }
}

/** Ports a game keeps in its settings, as the Port API claims them. */
export function settingPort(spec: { name: string; label: string; protocol: PortSpec["protocol"]; key: string; fallback: number; onWrite?(port: number): Promise<void> | void }, saved: Record<string, unknown>): PortSpec {
    return {
        name: spec.name, label: spec.label, protocol: spec.protocol,
        preferred: Number(saved[spec.key] ?? spec.fallback),
        async write(port) {
            await updateSettings({ [spec.key]: port });
            await spec.onWrite?.(port);
        },
    };
}

/**
 * The resume marker of an offline backup or restore. It lives outside the
 * server folder: a restored snapshot must never decide whether to restart.
 */
const resumeMarker = (gameId: string) => rawFiles.getPath(`.${gameId}-resume/${serverId(gameId)}`, PANEL_ID);

/** Starts a server an offline backup stopped, once Paperboard is back. */
export async function resumeAfterBackup(ctx: Context, gameId: string, running: boolean) {
    const marker = await resumeMarker(gameId);
    if (!(await exists(marker))) return;
    // lifecycle reaches every game's service, which import this module
    if (!running) await (await import("../service/lifecycle")).startServerInstance(ctx);
    await fs.unlink(marker);
}

export interface OfflineBackupSpec {
    gameId: string;
    name: string;
    processId: string;
    flag: () => BusyFlag;
    /** Tells players the server is going down. */
    announce(ctx: Context): Promise<void>;
    /** Saves the world and resolves once it is on disk. */
    save(ctx: Context): Promise<void>;
    /** Takes passwords out of files before they are copied; runs while stopped. */
    clean(): Promise<void>;
    /** When the game saves on exit, the stamp that must change for the exit to count. */
    exitStamp?(): Promise<string>;
}
/**
 * Backups of a game that can't be copied while it runs: save, stop, copy,
 * then start again. A crash between them leaves the marker, which restarts
 * the server when Paperboard comes back.
 */
export function offlineBackup(spec: OfflineBackupSpec): GameService["backup"] {
    /** Starts the server again when this backup stopped it, and drops the marker. */
    const recover = async (ctx: Context) => resumeAfterBackup(ctx, spec.gameId, await processApi.exists(spec.processId));
    async function before(ctx: Context) {
        const flag = spec.flag();
        if (flag.busy) throw new Error(`Wait for the ${spec.name} operation to finish`);
        if (ctx.state.serverStatus === "offline") { await spec.clean(); return; }
        if (ctx.state.serverStatus !== "online") throw new Error(`${spec.name} is starting or stopping; wait before backup or restore`);
        flag.busy = true;
        let marked = false;
        try {
            await spec.announce(ctx);
            await spec.save(ctx);
            await writePrivate(await resumeMarker(spec.gameId), "resume after offline operation\n");
            marked = true;
            const saved = await spec.exitStamp?.();
            await (await import("../service/lifecycle")).stopServerInstance(ctx);
            await waitUntil(async () => !(await processApi.exists(spec.processId)), 125_000, `${spec.name} to exit`);
            await spec.clean();
            if (saved !== undefined && (await spec.exitStamp!()) === saved) throw new Error(`${spec.name} exited without confirming its shutdown save; no backup was copied`);
        } catch (err) {
            // refused after it stopped: the server starts again, as the copy would have ended
            flag.busy = false;
            if (marked) await recover(ctx).catch((startErr) => report(ctx, `${spec.name} could not start again after the refused backup`, startErr));
            throw err;
        } finally { flag.busy = false; }
    }
    return { mode: "offline", before, recover, async withConsistentData(ctx, work) { await before(ctx); return work(); } };
}

/**
 * Points `link` at `target`, a folder in the server folder: what the game
 * left at `link` moves into `target` first, refusing to overwrite anything.
 * Windows gets a junction, which needs no administrator rights.
 */
export async function linkFolder(link: string, target: string): Promise<void> {
    await fs.mkdir(target, { recursive: true });
    const stat = await unlessMissing(fs.lstat(link), null);
    if (stat?.isSymbolicLink()) {
        if (path.resolve(path.dirname(link), await fs.readlink(link)) === path.resolve(target)) return;
        await fs.unlink(link);
    } else if (stat?.isDirectory()) {
        for (const entry of await fs.readdir(link)) {
            if (await exists(path.join(target, entry))) throw new Error(`${entry} is in both ${path.basename(link)} in the game's folder and ${path.basename(target)}; move one aside in Files`);
            await fs.rename(path.join(link, entry), path.join(target, entry));
        }
        await fs.rmdir(link);
    } else if (stat) throw new Error(`${path.basename(link)} in the game's folder is a file; remove it in Files`);
    await fs.mkdir(path.dirname(link), { recursive: true });
    if (process.platform === "win32") await fs.symlink(path.resolve(target), link, "junction");
    else await fs.symlink(path.relative(path.dirname(link), target), link, "dir");
}

/**
 * A file the game keeps in its own folder (`link`) that is the server
 * owner's, so it lives in the server folder (`target`), where backups carry
 * it and an update leaves it. Elsewhere `link` is a link to it, made when
 * the file is placed. Windows has no file link an ordinary account can make,
 * so there the file itself is moved in for a start and taken back once the
 * server is gone. Neither side need exist yet; a file on both sides is
 * refused, never guessed between.
 */
export function keptFile(link: string, target: string, platform = process.platform) {
    const both = () => new Error(`${path.basename(link)} is in both the game's folder and the server folder; move one aside in Files`);
    const stat = (file: string) => unlessMissing(fs.lstat(file), null);
    const move = async (from: string, to: string) => {
        if (await exists(to)) throw both();
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.rename(from, to);
    };
    return {
        /** Before a start: the game finds the server folder's file at `link`. */
        async place(): Promise<void> {
            const there = await stat(link);
            if (there?.isDirectory()) throw new Error(`${path.basename(link)} in the game's folder is a folder; remove it in Files`);
            if (platform === "win32") {
                if (await exists(target)) await move(target, link);
                return;
            }
            if (there?.isSymbolicLink()) {
                if (path.resolve(path.dirname(link), await fs.readlink(link)) === path.resolve(target)) return;
                await fs.unlink(link);
            } else if (there) await move(link, target);
            await fs.mkdir(path.dirname(link), { recursive: true });
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.symlink(path.relative(path.dirname(link), target), link, "file");
        },
        /** Once the server is gone: the file is in the server folder again. Nothing to do where `link` is a link. */
        async takeBack(): Promise<void> {
            if (platform !== "win32") return;
            if ((await stat(link))?.isFile()) await move(link, target);
        },
    };
}

/** Removes a link linkFolder made; a real folder there is the user's and stays. */
export async function unlinkFolder(link: string): Promise<void> {
    const stat = await unlessMissing(fs.lstat(link), null);
    if (stat?.isSymbolicLink()) await fs.unlink(link);
}
/** Whether linkFolder's link is at this path. */
export async function isLinked(link: string): Promise<boolean> {
    const stat = await unlessMissing(fs.lstat(link), null);
    return !!stat?.isSymbolicLink();
}
