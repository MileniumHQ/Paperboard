import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import type { ChatMessage, GameServerState } from "./types";

/** How much of the console and the chat a server keeps across service restarts. */
export const HISTORY_ENTRIES = 500;
export const HISTORY_CHAT = 200;
/** A burst of output is written once, this long after it settles. */
export const HISTORY_WRITE_DELAY_MS = 1000;
const VERSION = 1;

export type ConsoleHistory = Pick<GameServerState, "serverEntries" | "chatMessages">;
/** What the file keeps: the console, the chat, and whether the server was running when last seen. */
export interface ServerHistory extends ConsoleHistory {
    running: boolean;
}
/** A server in these is meant to be running: it only leaves them by stopping or crashing. */
const RUNNING: readonly GameServerState["serverStatus"][] = ["online", "starting", "restarting"];
export const isRunning = (status: GameServerState["serverStatus"]) => RUNNING.includes(status);

const isChat = (value: unknown): value is ChatMessage => {
    const m = value as ChatMessage;
    return !!m && typeof m === "object" && typeof m.id === "string" && typeof m.text === "string" && typeof m.timestamp === "string";
};

/** Only text lines are kept: a console line built from markup does not survive JSON. */
export function historyOf(state: ServerHistory): ServerHistory {
    return {
        running: state.running,
        serverEntries: state.serverEntries.filter((e) => typeof e.content === "string").slice(-HISTORY_ENTRIES),
        chatMessages: state.chatMessages.slice(-HISTORY_CHAT),
    };
}

/** Throws on a damaged file; a missing one is a server that has said nothing yet. */
export async function readHistory(file: string): Promise<ServerHistory> {
    let text: string;
    try {
        text = await nodeFs.readFile(file, "utf8");
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return { serverEntries: [], chatMessages: [], running: false };
        throw err;
    }
    const raw = JSON.parse(text) as { version?: unknown; serverEntries?: unknown; chatMessages?: unknown; running?: unknown };
    if (raw?.version !== VERSION || !Array.isArray(raw.serverEntries) || !Array.isArray(raw.chatMessages) || typeof raw.running !== "boolean")
        throw new Error("The saved console history is damaged");
    return {
        running: raw.running,
        serverEntries: raw.serverEntries
            .filter((e): e is GameServerState["serverEntries"][number] => !!e && typeof e === "object" && typeof (e as { content?: unknown }).content === "string")
            .slice(-HISTORY_ENTRIES),
        chatMessages: raw.chatMessages.filter(isChat).slice(-HISTORY_CHAT),
    };
}

/** Written beside and renamed over, so a crash mid-write never leaves half a file. */
export async function writeHistory(file: string, history: ServerHistory): Promise<void> {
    await nodeFs.mkdir(nodePath.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await nodeFs.writeFile(temp, JSON.stringify({ version: VERSION, ...historyOf(history) }));
    await nodeFs.rename(temp, file);
}

/**
 * Keeps a server's console, chat and whether it is running on disk. `changed` is called on every
 * state change and writes once the output settles; a failed write is
 * reported once through `onError` until a write succeeds again.
 */
export function historyWriter(file: () => Promise<string>, onError: (err: unknown) => void, delayMs = HISTORY_WRITE_DELAY_MS) {
    let last: ServerHistory | null = null;
    let pending: ServerHistory | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let writing: Promise<void> = Promise.resolve();
    let failed = false;
    let stopped = false;
    const flush = (): Promise<void> => {
        if (timer) clearTimeout(timer);
        timer = null;
        const next = pending;
        pending = null;
        if (!next) return writing;
        writing = writing.then(async () => {
            try {
                await writeHistory(await file(), next);
                failed = false;
            } catch (err) {
                if (!failed) onError(err);
                failed = true;
            }
        });
        return writing;
    };
    return {
        /** The history the server opened with, so it is not written straight back. */
        loaded(history: ServerHistory) { last = history; },
        changed(state: ConsoleHistory & Pick<GameServerState, "serverStatus">) {
            if (stopped) return;
            const running = isRunning(state.serverStatus);
            if (last && last.serverEntries === state.serverEntries && last.chatMessages === state.chatMessages && last.running === running) return;
            last = { serverEntries: state.serverEntries, chatMessages: state.chatMessages, running };
            pending = last;
            if (timer) return;
            timer = setTimeout(() => void flush(), delayMs);
            timer.unref?.();
        },
        flush,
        /** Ends the writes, as when the server is removed. */
        async stop() { stopped = true; pending = null; if (timer) clearTimeout(timer); timer = null; await writing; },
    };
}
