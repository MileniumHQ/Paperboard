/**
 * What every game's service does the same way: settings, vault keys, the
 * console, chat, waits, one operation at a time, offline backups and links.
 * Game modules keep only what is theirs; nothing here names a game.
 */
import type { Server } from "../service/server";
import { exists, unlessMissing } from "../service/failures";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileApi as rawFiles, problemsApi, secretsApi, errorMessage } from "@mileniumhq/paperapi";
import { TRIGGER_IDS } from "../service/contract";
import { appendCapped, PANEL_ID, type ChatMessage } from "../service/types";
import { chatId } from "../lib/logs";
import type { GameDefinition, GameOptions } from "./types";
import type { GameService, PortSpec } from "./serviceTypes";
export { exists, unlessMissing };

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
export function serverSecret(server: Server, gameId: string, name: string): ServerSecret {
    const key = () => `${server.id}-${gameId}-${name}`;
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
export function report(ctx: Server, what: string, err: unknown) {
    const message = errorMessage(err);
    ctx.console.say("error", `[Paperboard] ${what}: ${message}`);
    problemsApi.report(PANEL_ID, { key: `${ctx.id}:${what}`, title: `${ctx.name}: ${what}`, message });
}
/** The work `report` said failed (the same `what`) has worked since: its problem goes. */
export function settle(ctx: Server, what: string) {
    problemsApi.clear(PANEL_ID, `${ctx.id}:${what}`);
}
/** Adds a message to the chat and returns it as triggers send it. */
export function pushChat(ctx: Server, message: Omit<ChatMessage, "id" | "timestamp">): ChatMessage {
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
 * dropped, so a slow answer never rewinds the list or repeats a join. The
 * list ends with the run: nobody is online on a stopped server.
 */
export function playerPoller<P extends { name: string }>(ctx: Server, spec: {
    game: string;
    id(player: P): string;
    list(): Promise<P[]>;
    remember(players: P[]): Promise<void>;
}) {
    const state = { timer: null as ReturnType<typeof setInterval> | null, online: [] as P[], baseline: false, error: "", latest: 0, asking: false };
    /** Asks now; resolves once the answer is in the state (or dropped). */
    async function poll(): Promise<void> {
        if (ctx.state.serverStatus !== "online") return;
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
                ctx.trigger(TRIGGER_IDS.playerJoined, p.name);
            }
            for (const [id, p] of before) if (!now.has(id)) {
                pushChat(ctx, { event: "leave", sender: p.name, text: `${p.name} left the game` });
                ctx.trigger(TRIGGER_IDS.playerLeft, p.name);
            }
        }
        spec.remember(players).catch((err) => report(ctx, `Could not record ${spec.game}'s players`, err));
    }
    function stop() {
        if (state.timer) clearInterval(state.timer);
        Object.assign(state, { timer: null, online: [], baseline: false, error: "", latest: state.latest + 1, asking: false });
    }
    ctx.onRunEnd(stop);
    return {
        /** who answered online last */
        online: (): readonly P[] => state.online,
        poll,
        /**
         * `baseline`: the first answer is who was already there (a reattach), not who joined.
         * A start's readiness probe calls it after an await, so a stop may have landed first:
         * a server that is not starting or online gets no timer.
         */
        start(baseline = false) {
            if (state.timer || (ctx.state.serverStatus !== "starting" && ctx.state.serverStatus !== "online")) return;
            state.baseline = baseline;
            state.timer = setInterval(() => { if (!state.asking) void poll(); }, PLAYER_POLL_MS);
            void poll();
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
export async function exclusive<T>(ctx: Server, flag: BusyFlag, game: string, work: () => Promise<T>): Promise<T> {
    if (flag.busy || ctx.state.serverStatus !== "offline") throw new Error(`Stop ${game} and wait for the current operation to finish`);
    flag.busy = true;
    try { return await work(); } finally { flag.busy = false; }
}
/** True when online, false when offline; starting or stopping refuses. */
export function settled(ctx: Server, game: string): boolean {
    const status = ctx.state.serverStatus;
    if (status !== "online" && status !== "offline") throw new Error(`Wait for ${game} to finish starting or stopping`);
    return status === "online";
}

/** Hides values from console lines: passwords the game was started with. */
export function redact(line: string, secrets: readonly string[]): string {
    for (const secret of secrets) if (secret) line = line.replaceAll(secret, "[redacted]");
    return line;
}

/** Ports a game keeps in its settings, as the Port API claims them; the launch opens `ctx.runPort(name, saved)`. */
export function settingPort(spec: { name: string; label: string; protocol: PortSpec["protocol"]; key: string; fallback: number }, saved: Record<string, unknown>): PortSpec {
    return { name: spec.name, label: spec.label, protocol: spec.protocol, preferred: Number(saved[spec.key] ?? spec.fallback) };
}

/**
 * The resume marker of a backup or restore that stopped a running server:
 * the server starts again at the work's end, or, when the service died
 * meanwhile, once it is back. It lives outside the server folder, so a
 * restored snapshot never decides whether to restart.
 */
const resumeMarker = (ctx: Server) => rawFiles.getPath(`${resumeFolder(ctx.stored.game)}/${ctx.id}`, PANEL_ID);
/** the folder in the panel's storage that holds a game's resume markers */
export const resumeFolder = (game: string) => `.${game}-resume`;

/** Marks a running server to start again once the work that stops it is done. */
export async function markResume(ctx: Server) {
    await writePrivate(await resumeMarker(ctx), "resume after offline operation\n");
}

/** Takes a server's resume marker: true when a backup or restore stopped it and it should start again. */
export async function takeResume(ctx: Server): Promise<boolean> {
    const marker = await resumeMarker(ctx);
    if (!(await exists(marker))) return false;
    await fs.unlink(marker);
    return true;
}

/**
 * Starts the server again when a backup or restore stopped it, and drops
 * the marker. A start that fails says so in the server's console and its
 * problems; it does not undo the work.
 */
export async function resumeIfMarked(ctx: Server, after: string): Promise<void> {
    if (!(await takeResume(ctx)) || (await ctx.process.exists(ctx.game.primaryProcessId))) return;
    // lifecycle reaches every game's service, which import this module
    const { startServerInstance } = await import("../service/lifecycle");
    await startServerInstance(ctx).catch((err) => report(ctx, `The server could not start again after ${after}`, err));
}

/**
 * Waits until a server asked to stop is offline and its last run's cleanup
 * (afterStop) has settled, so nothing of that run writes its folder after,
 * and a start that follows is not dropped as one for a server still running.
 */
export async function stoppedAndReleased(ctx: Server, ms: number, label: string): Promise<void> {
    await waitUntil(async () => ctx.state.serverStatus === "offline" && !(await ctx.process.exists(ctx.game.primaryProcessId)), ms, label);
    await ctx.lifecycle.released;
}

export interface OfflineBackupSpec {
    name: string;
    processId: string;
    flag: () => BusyFlag;
    /** Tells players the server is going down. */
    announce(): Promise<void>;
    /** Saves the world and resolves once it is on disk. */
    save(): Promise<void>;
    /** Takes passwords out of files before they are copied; runs while stopped. */
    clean(): Promise<void>;
    /** When the game saves on exit, the stamp that must change for the exit to count. */
    exitStamp?(): Promise<string>;
}
/**
 * Backups of a game that can't be copied while it runs: save, stop, copy,
 * then start again. The stop leaves a resume marker, so a service that dies
 * before the start starts the server once it is back. A refusal after the
 * stop leaves the marker too: the caller's `after` starts the server again,
 * once nothing holds it.
 */
export function offlineBackup(ctx: Server, spec: OfflineBackupSpec): GameService["backup"] {
    async function before() {
        const flag = spec.flag();
        if (flag.busy) throw new Error(`Wait for the ${spec.name} operation to finish`);
        if (ctx.state.serverStatus === "offline") { await spec.clean(); return; }
        if (ctx.state.serverStatus !== "online") throw new Error(`${spec.name} is starting or stopping; wait before backup or restore`);
        flag.busy = true;
        try {
            await spec.announce();
            await spec.save();
            await markResume(ctx);
            const saved = await spec.exitStamp?.();
            await (await import("../service/lifecycle")).stopServerInstance(ctx);
            await stoppedAndReleased(ctx, 125_000, `${spec.name} to exit`);
            await spec.clean();
            if (saved !== undefined && (await spec.exitStamp!()) === saved) throw new Error(`${spec.name} exited without confirming its shutdown save; no backup was copied`);
        } finally { flag.busy = false; }
    }
    return { mode: "offline", before, after: () => resumeIfMarked(ctx, "its backup") };
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
