// The one conversation. There is no "new chat": like texting a friend, every
// message continues the same thread (starting over is a deliberate reset).
// Messages sent while the agent is busy wait, can be taken back, and are read
// together on its next turn.
//
// A turn is the harness run as a daemon-supervised child (one at a time, id
// TURN_PROC_ID). The transcript is an append-only JSONL file in the panel's
// storage, compacted when it grows past a cap; an entry that changes (a tool
// call finishing) is appended again and the latest copy wins.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LIMITS, PANEL_ID, type ChatEntry, type ChatState, type Harness, type Settings, type WaitingMessage } from "../contract";
import type { StartOptions } from "./computer";
import { parseTurnLine, turnLaunch } from "./harness";

export const TURN_PROC_ID = `${PANEL_ID}.turn`;
const TRANSCRIPT = "transcript.jsonl";
const THREADS = "threads.json";
const KEEP_IN_MEMORY = 500;
const COMPACT_AT_BYTES = 4 * 1024 * 1024;
const MAX_QUEUED = 20;
const MAX_LINE = 16 * 1024 * 1024; // one event can carry a screenshot
const TURN_MS = 30 * 60_000;
const STOP_GRACE_MS = 2_000;

export interface TurnHost {
    start(o: StartOptions): Promise<unknown>;
    kill(id: string, signal?: string): Promise<void>;
    exists(id: string): Promise<boolean>;
    onStdout(id: string, cb: (data: string) => void): () => void;
    onStderr(id: string, cb: (data: string) => void): () => void;
    onExit(id: string, cb: (code?: number) => void): () => void;
}

export interface ConversationDeps {
    host: TurnHost;
    /** absolute path of the conversation's folder in the panel's storage */
    dir: string;
    settings: () => Settings | null;
    /** the harness executable, or null if it isn't installed */
    resolve: (harness: Harness) => string | null;
    /** the computer's MCP endpoint for this service generation */
    mcp: () => { url: string; token: string };
    /** every toolset's part of the agent's instructions, read at the start of each turn */
    instructions: () => Promise<string[]>;
    emit: (entry: ChatEntry) => void;
    onState: (s: ChatState) => void;
    turnMs?: number;
}

export class Conversation {
    private entries: ChatEntry[] = [];
    private threads: Partial<Record<Harness, string>> = {};
    private queue: WaitingMessage[] = [];
    private running: Promise<void> | null = null;
    private stopRequested = false;
    private closed = false;

    constructor(private deps: ConversationDeps) {}

    init() {
        fs.mkdirSync(this.deps.dir, { recursive: true });
        this.entries = this.load();
        const threads = path.join(this.deps.dir, THREADS);
        if (fs.existsSync(threads)) this.threads = JSON.parse(fs.readFileSync(threads, "utf8"));
        // a turn the last service generation left running is not ours to finish
        void this.deps.host
            .exists(TURN_PROC_ID)
            .then(async (alive) => {
                if (alive) await this.deps.host.kill(TURN_PROC_ID, "SIGKILL");
            })
            .catch((e) => console.error("[ai] couldn't stop a turn left from before:", String(e)));
    }

    history(limit: number = LIMITS.history): ChatEntry[] {
        return this.entries.slice(-Math.max(1, Math.min(limit, LIMITS.history)));
    }

    /** Send a message: read now, or waiting for the running turn (then it can be taken back until it's read). */
    send(text: string): { id: string; waiting: boolean } {
        const message = text.trim();
        if (!message) throw new Error("say something first");
        if (message.length > LIMITS.message) throw new Error(`messages are limited to ${LIMITS.message} characters`);
        if (!this.deps.settings()) throw new Error("finish setting up first");
        if (this.queue.length >= MAX_QUEUED) throw new Error("that's a lot of messages at once; wait for a reply");
        const id = randomUUID();
        this.queue.push({ id, text: message });
        const waiting = this.running !== null;
        this.pump();
        return { id, waiting };
    }

    /** Take back a message the agent hasn't read yet. */
    unqueue(id: string) {
        const i = this.queue.findIndex((m) => m.id === id);
        if (i < 0) throw new Error("that message isn't waiting anymore");
        this.queue.splice(i, 1);
        this.state();
        return { removed: true };
    }

    /** Stop the running turn so the waiting messages are read now. */
    async sendNow() {
        if (this.queue.length === 0) throw new Error("no messages are waiting");
        if (!this.running) {
            this.pump();
            return { interrupted: false };
        }
        this.stopRequested = true;
        await this.killTurn();
        return { interrupted: true };
    }

    /** Start over: stop, forget the conversation and the harness's threads. Asked for explicitly; it can't be undone. */
    async clear() {
        this.queue = [];
        this.stopRequested = true;
        await this.killTurn();
        await this.running;
        this.entries = [];
        this.threads = {};
        atomicWrite(path.join(this.deps.dir, TRANSCRIPT), "");
        atomicWrite(path.join(this.deps.dir, THREADS), "{}");
        this.state();
        return { cleared: true };
    }

    /** Record something the conversation should show (a tool call). Returns the entry to update later. */
    add<E extends ChatEntry>(entry: E): E {
        this.put(entry);
        return entry;
    }

    update(entry: ChatEntry) {
        this.put(entry);
    }

    /** Stop the running turn; messages waiting for it are dropped with it. */
    async stop() {
        this.queue = [];
        this.stopRequested = true;
        await this.killTurn();
        this.state();
    }

    async shutdown() {
        this.closed = true;
        this.queue = [];
        await this.killTurn();
    }

    // ------------------------------------------------------------- turns

    private pump() {
        this.state();
        if (this.running || this.closed || this.queue.length === 0) return;
        const batch = this.queue.splice(0);
        this.stopRequested = false; // a stop asked of an earlier turn doesn't silence this one
        // read now, so now they join the conversation
        for (const m of batch) this.add({ id: m.id, at: Date.now(), kind: "user", text: m.text });
        const message = batch.map((m) => m.text).join("\n\n");
        this.running = this.turn(message)
            .catch((e: Error) => {
                this.add({ id: randomUUID(), at: Date.now(), kind: "error", text: e.message });
            })
            .finally(() => {
                this.running = null;
                this.stopRequested = false;
                this.pump();
            });
        this.state();
    }

    private async turn(message: string) {
        const settings = this.deps.settings();
        if (!settings) throw new Error("finish setting up first");
        const command = this.deps.resolve(settings.harness);
        if (!command) throw new Error(`${settings.harness === "codex" ? "Codex" : "Claude"} isn't installed on this computer anymore.`);
        const mcp = this.deps.mcp();
        const sections = await this.deps.instructions();
        const launch = turnLaunch({
            harness: settings.harness,
            command,
            model: settings.model,
            name: settings.name,
            thread: this.threads[settings.harness] ?? null,
            message,
            mcpUrl: mcp.url,
            sections,
        });
        if (launch.thread) this.saveThread(settings.harness, launch.thread);

        let buf = "";
        let stderr = "";
        const failures: string[] = [];
        let said = false;
        const onLine = (line: string) => {
            for (const ev of parseTurnLine(settings.harness, line)) {
                if (ev.type === "thread") this.saveThread(settings.harness, ev.id);
                else if (ev.type === "message") {
                    said = true;
                    this.add({ id: randomUUID(), at: Date.now(), kind: "agent", text: ev.text });
                } else if (ev.type === "search") {
                    this.add({ id: randomUUID(), at: Date.now(), kind: "tool", tool: "search", summary: ev.query, status: "done", detail: null });
                } else failures.push(ev.message);
            }
        };
        const exited = new Promise<number | undefined>((ok) => {
            const offs = [
                this.deps.host.onStdout(TURN_PROC_ID, (data) => {
                    buf += data;
                    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
                        onLine(buf.slice(0, i));
                        buf = buf.slice(i + 1);
                    }
                    if (buf.length > MAX_LINE) buf = ""; // a line past the cap is dropped, not buffered forever
                }),
                this.deps.host.onStderr(TURN_PROC_ID, (data) => {
                    stderr = (stderr + data).slice(-4000);
                }),
            ];
            offs.push(
                this.deps.host.onExit(TURN_PROC_ID, (code) => {
                    for (const off of offs) off();
                    ok(code);
                }),
            );
        });
        await this.deps.host.start({
            id: TURN_PROC_ID,
            command: launch.command,
            args: launch.args,
            cwd: this.workdir(),
            env: { [launch.tokenEnv]: mcp.token },
        });
        const timer = setTimeout(() => void this.killTurn(), this.deps.turnMs ?? TURN_MS);
        let code: number | undefined;
        try {
            code = await exited;
        } finally {
            clearTimeout(timer);
        }
        if (buf.trim()) onLine(buf);
        if (this.stopRequested) return;
        if (failures.length) throw new Error(failures[failures.length - 1]);
        if (code !== 0) throw new Error(`the turn ended with exit ${code ?? "?"}${stderr.trim() ? `: ${lastLines(stderr)}` : ""}`);
        if (!said) throw new Error("the turn ended without a reply");
    }

    private async killTurn() {
        if (!(await this.deps.host.exists(TURN_PROC_ID))) return;
        const gone = this.running ?? Promise.resolve();
        await this.deps.host.kill(TURN_PROC_ID, "SIGTERM");
        let t: ReturnType<typeof setTimeout> | undefined;
        const timedOut = await Promise.race([gone.then(() => false), new Promise<boolean>((ok) => (t = setTimeout(() => ok(true), STOP_GRACE_MS)))]);
        clearTimeout(t);
        if (timedOut) await this.deps.host.kill(TURN_PROC_ID, "SIGKILL");
    }

    /** An empty folder: no project files and no AGENTS.md or CLAUDE.md for the harness to pick up. */
    private workdir() {
        const dir = path.join(this.deps.dir, "workspace");
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    private saveThread(harness: Harness, id: string) {
        if (this.threads[harness] === id) return;
        this.threads = { ...this.threads, [harness]: id };
        atomicWrite(path.join(this.deps.dir, THREADS), JSON.stringify(this.threads));
    }

    private state() {
        this.deps.onState({ busy: this.running !== null, waiting: this.queue.map((m) => ({ ...m })) });
    }

    // ------------------------------------------------------------- transcript

    private put(entry: ChatEntry) {
        const i = this.entries.findIndex((e) => e.id === entry.id);
        if (i >= 0) this.entries[i] = entry;
        else this.entries.push(entry);
        if (this.entries.length > KEEP_IN_MEMORY) this.entries.splice(0, this.entries.length - KEEP_IN_MEMORY);
        const file = path.join(this.deps.dir, TRANSCRIPT);
        fs.appendFileSync(file, JSON.stringify(entry) + "\n");
        if (fs.statSync(file).size > COMPACT_AT_BYTES) atomicWrite(file, this.entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
        this.deps.emit(entry);
    }

    private load(): ChatEntry[] {
        const file = path.join(this.deps.dir, TRANSCRIPT);
        if (!fs.existsSync(file)) return [];
        const byId = new Map<string, ChatEntry>();
        const lines = fs.readFileSync(file, "utf8").split("\n");
        lines.forEach((line, n) => {
            if (!line.trim()) return;
            let e: ChatEntry;
            try {
                e = JSON.parse(line);
            } catch (err) {
                // only the last line can be torn (a crash mid-append); anything else is damage to report
                if (n >= lines.length - 2) return;
                throw new Error(`${file} line ${n + 1} is unreadable: ${(err as Error).message}`);
            }
            byId.delete(e.id); // re-insert so a changed entry keeps its newest position
            byId.set(e.id, e);
        });
        return [...byId.values()].sort((a, b) => a.at - b.at).slice(-KEEP_IN_MEMORY);
    }
}

function atomicWrite(file: string, data: string) {
    fs.writeFileSync(`${file}.tmp`, data);
    fs.renameSync(`${file}.tmp`, file);
}

function lastLines(s: string) {
    return s.trim().split("\n").slice(-3).join(" ").slice(0, 400);
}
