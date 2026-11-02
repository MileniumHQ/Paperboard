/**
 * What every game's service does the same way: settings, vault keys, the
 * console, chat, waits, one operation at a time, offline backups and links.
 * Game modules keep only what is theirs; nothing here names a game.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { config, files, processApi, type ServiceContext } from "../service/api";
import { defineAction, fileApi as rawFiles, secretsApi } from "@mileniumhq/paperapi";
import { currentServer } from "../service/scope";
import type { PaperConsoleEntry } from "@mileniumhq/paperui";
import { appendCapped, PANEL_ID, type ChatMessage, type GameServerState } from "../service/types";
import { chatId } from "../lib/logs";
import type { GameDefinition, GameOptions } from "./types";
import type { GameService, PortSpec } from "./serviceTypes";

export type Context = ServiceContext<GameServerState>;

/** The current server's folder. */
export const serverRoot = () => files.getPath("", PANEL_ID);
/** The current server's saved settings. */
export const readSettings = async () => (await config.get<Record<string, unknown>>(PANEL_ID)) ?? {};
/** Saves these settings over the current ones and returns the result. */
export async function updateSettings(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const next = { ...(await readSettings()), ...patch };
    await config.set(next, PANEL_ID);
    return next;
}

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

/** Background work has no caller to throw to, so its failures land in the console. */
export function report(ctx: Context, what: string, err: unknown) {
    ctx.setState((prev) => ({ serverEntries: appendCapped(prev.serverEntries, { type: "error", content: `[Paperboard] ${what}: ${err instanceof Error ? err.message : String(err)}` }) }));
}
/** Adds a message to the chat and returns it as triggers send it. */
export function pushChat(ctx: Context, message: Omit<ChatMessage, "id" | "timestamp">): ChatMessage {
    const entry = { ...message, id: chatId(), timestamp: new Date().toTimeString().slice(0, 8) };
    ctx.setState((prev) => ({ chatMessages: appendCapped(prev.chatMessages, entry) }));
    return entry;
}

/** Whether anything is at this path; any error but a missing file throws. */
export async function exists(file: string): Promise<boolean> {
    return fs.lstat(file).then(() => true, (err: NodeJS.ErrnoException) => { if (err.code === "ENOENT") return false; throw err; });
}
export { singleLine } from "./options";
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

/** An internal Action of a game's service; input is checked by its run. */
export const gameAction = (id: string, name: string, run: (ctx: Context, input: any) => unknown) =>
    defineAction({ id, name, category: "Server", description: name, internal: true, inputs: {}, run: run as (ctx: Context, input: any) => any });

/** Hides values from console lines: passwords the game was started with. */
export function redact(line: string, secrets: readonly string[]): string {
    for (const secret of secrets) if (secret) line = line.replaceAll(secret, "[redacted]");
    return line;
}

const CONSOLE_LINES = 1000;
/** A progress line's step, as "Loading world data" for "Loading world data: 27%"; null for any other line. */
export function progressStep(line: string): string | null {
    const match = /^(.*\D)\s*:?\s*\d{1,3}(?:\.\d+)?%$/.exec(line.trim());
    return match ? match[1]!.replace(/[\s:]+$/, "") : null;
}

/**
 * Console lines gathered for a tenth of a second and published together, so a
 * chatty server costs one state update per batch rather than one per line.
 * A progress line replaces the one before it of the same step: a start shows
 * "Loading world data: 100%" once, not a hundred times.
 */
export class ConsoleBuffer {
    private pending: string[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    constructor(private readonly isError: (line: string) => boolean) {}
    push(ctx: Context, line: string) {
        const step = progressStep(line);
        const previous = this.pending.at(-1);
        if (step !== null && previous !== undefined && progressStep(previous) === step) this.pending = this.pending.slice(0, -1);
        this.pending = [...this.pending, line].slice(-CONSOLE_LINES);
        if (this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            const lines = this.pending;
            this.pending = [];
            // checked as it publishes: a line written in between keeps the old progress line
            const step = progressStep(lines[0]!);
            const last = ctx.state.serverEntries.at(-1);
            const published = step !== null && last && progressStep(String(last.content)) === step ? ctx.state.serverEntries.slice(0, -1) : ctx.state.serverEntries;
            const entries: PaperConsoleEntry[] = lines.map((content) => ({ type: this.isError(content) ? "error" : "info", content }));
            ctx.setState({ serverEntries: [...published, ...entries].slice(-CONSOLE_LINES) });
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
    async function before(ctx: Context) {
        const flag = spec.flag();
        if (flag.busy) throw new Error(`Wait for the ${spec.name} operation to finish`);
        if (ctx.state.serverStatus === "offline") { await spec.clean(); return; }
        if (ctx.state.serverStatus !== "online") throw new Error(`${spec.name} is starting or stopping; wait before backup or restore`);
        flag.busy = true;
        try {
            await spec.announce(ctx);
            await spec.save(ctx);
            await writePrivate(await resumeMarker(spec.gameId), "resume after offline operation\n");
            const saved = await spec.exitStamp?.();
            await (await import("../service/lifecycle")).stopServerInstance(ctx);
            await waitUntil(async () => !(await processApi.exists(spec.processId)), 125_000, `${spec.name} to exit`);
            await spec.clean();
            if (saved !== undefined && (await spec.exitStamp!()) === saved) throw new Error(`${spec.name} exited without confirming its shutdown save; no backup was copied`);
        } finally { flag.busy = false; }
    }
    return { mode: "offline", before, recover: async () => {}, async withConsistentData(ctx, work) { await before(ctx); return work(); } };
}

/**
 * Points `link` at `target`, a folder in the server folder: what the game
 * left at `link` moves into `target` first, refusing to overwrite anything.
 * Windows gets a junction, which needs no administrator rights.
 */
export async function linkFolder(link: string, target: string): Promise<void> {
    await fs.mkdir(target, { recursive: true });
    const stat = await fs.lstat(link).catch((err: NodeJS.ErrnoException) => { if (err.code === "ENOENT") return null; throw err; });
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

/** Removes a link linkFolder made; a real folder there is the user's and stays. */
export async function unlinkFolder(link: string): Promise<void> {
    const stat = await fs.lstat(link).catch((err: NodeJS.ErrnoException) => { if (err.code === "ENOENT") return null; throw err; });
    if (stat?.isSymbolicLink()) await fs.unlink(link);
}
/** Whether linkFolder's link is at this path. */
export async function isLinked(link: string): Promise<boolean> {
    const stat = await fs.lstat(link).catch((err: NodeJS.ErrnoException) => { if (err.code === "ENOENT") return null; throw err; });
    return !!stat?.isSymbolicLink();
}
