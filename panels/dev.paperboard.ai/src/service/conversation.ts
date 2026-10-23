// The current conversation, and the ones put away. Like texting a friend,
// every message continues the same thread until the user starts a new one;
// the old one goes into the history (its transcript and harness threads,
// moved as they are) and can be reopened and continued. Starting over is
// different: it forgets the current conversation.
// Messages sent while the agent is busy wait, can be taken back, and are read
// together on its next turn. The agent talks through send_message (see
// messages.ts): each call is a bubble, added at once, mid-turn. The service
// can start a turn too, with a notice (a routine is due): the agent reads it
// like a message that isn't from the user, and texts only if it has
// something to say.
//
// A turn is the harness run as a daemon-supervised child (one at a time, id
// TURN_PROC_ID). The transcript is an append-only JSONL file in the panel's
// storage, compacted when it grows past a cap; an entry that changes is
// appended again and the latest copy wins.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LIMITS, PANEL_ID, type ChatEntry, type ChatState, type Harness, type PastConversation, type Settings, type SignInEntry, type WaitingMessage } from "../contract";
import type { StartOptions } from "./computer";
import { parseTurnLine, turnLaunch } from "./harness";

export const TURN_PROC_ID = `${PANEL_ID}.turn`;
const TRANSCRIPT = "transcript.jsonl";
const THREADS = "threads.json";
const PAST = "past";
const PAST_META = "meta.json";
const PAST_ID = /^[a-f0-9]{12}$/;
const TITLE_CHARS = 80;
const KEEP_IN_MEMORY = 500;
const COMPACT_AT_BYTES = 4 * 1024 * 1024;
const MAX_QUEUED = 20;
const MAX_NOTICES = 10;
const MAX_LINE = 16 * 1024 * 1024; // one event can carry a screenshot
const TURN_MS = 30 * 60_000;
const STOP_GRACE_MS = 2_000;
const QUOTE_CHARS = 80;
const SHORT_ID = 6;

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
    /** the service's notices for the agent's next turn; not the user's, so not in the conversation */
    private notices: string[] = [];
    private running: Promise<void> | null = null;
    private stopRequested = false;
    private closed = false;
    /** set while conversations are swapped: no turn starts until the files are in place */
    private switching: Promise<unknown> | null = null;
    /** what the agent has texted in the running turn; once it has, its plain output is only a recap */
    private sent: string[] = [];
    /** ids of the user's messages the running turn is answering */
    private answering: string[] = [];
    /** the agent is writing to the user right now, not working: only then does the typing bubble show */
    private typing = false;

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
    send(text: string, replyTo: string | null = null): { id: string; waiting: boolean } {
        const message = text.trim();
        if (!message) throw new Error("say something first");
        if (message.length > LIMITS.message) throw new Error(`messages are limited to ${LIMITS.message} characters`);
        if (!this.deps.settings()) throw new Error("finish setting up first");
        if (this.queue.length >= MAX_QUEUED) throw new Error("that's a lot of messages at once; wait for a reply");
        if (replyTo !== null) this.checkReplyTarget(replyTo);
        const id = this.newId();
        this.queue.push(replyTo === null ? { id, text: message } : { id, text: message, replyTo });
        const waiting = this.running !== null;
        this.pump();
        return { id, waiting };
    }

    /**
     * Start the agent on something the service noticed (a routine is due): read on its next turn, which may
     * end without a text. Throws when there's no agent to tell yet.
     */
    notice(text: string) {
        if (this.closed) throw new Error("the conversation is shutting down");
        if (!this.deps.settings()) throw new Error("the agent isn't set up yet");
        this.notices.push(text);
        // a backlog this long means turns aren't keeping up: the oldest notice is the least useful one
        if (this.notices.length > MAX_NOTICES) console.error("[ai] dropped a notice nobody read:", this.notices.shift()!.slice(0, 120));
        this.pump();
    }

    /** Add or update a sign-in request's bubble (signIn.ts owns the request; this only shows it). */
    post(entry: SignInEntry) {
        if (this.closed) return;
        this.put(entry);
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
        this.notices = [];
        await this.swap(() => {
            this.entries = [];
            this.threads = {};
            atomicWrite(path.join(this.deps.dir, TRANSCRIPT), "");
            atomicWrite(path.join(this.deps.dir, THREADS), "{}");
        });
        return { cleared: true };
    }

    /** Put the current conversation in the history and start a new one. An empty one is just left. */
    newConversation() {
        return this.swap(() => {
            if (this.entries.length === 0) return;
            if (this.pastIds().length >= LIMITS.pastConversations) {
                throw new Error(`You have ${LIMITS.pastConversations} past conversations; delete some from the history first.`);
            }
            this.putAway();
        }).then(() => ({ started: true }));
    }

    /** The history, newest first. */
    past(): PastConversation[] {
        return this.pastIds()
            .map((id) => {
                const file = path.join(this.pastDir(), id, PAST_META);
                try {
                    return JSON.parse(fs.readFileSync(file, "utf8")) as PastConversation;
                } catch (e) {
                    // unreadable isn't "not there": say which one, so it can be deleted
                    throw new Error(`${file} can't be read: ${(e as Error).message}`);
                }
            })
            .sort((a, b) => b.endedAt - a.endedAt);
    }

    /** Make a past conversation the current one, to continue it; the current one goes into the history. */
    async open(id: unknown) {
        const dir = this.pastEntry(id);
        await this.swap(() => {
            if (!fs.existsSync(dir)) throw new Error("That conversation isn't in the history anymore.");
            if (this.entries.length > 0) this.putAway();
            // it comes back as it was put away; a part that's missing (an interrupted put-away) is empty
            for (const [name, empty] of [
                [TRANSCRIPT, ""],
                [THREADS, "{}"],
            ] as const) {
                const from = path.join(dir, name);
                const to = path.join(this.deps.dir, name);
                if (fs.existsSync(from)) fs.renameSync(from, to);
                else atomicWrite(to, empty);
            }
            fs.rmSync(dir, { recursive: true });
            this.entries = this.load();
            this.threads = JSON.parse(fs.readFileSync(path.join(this.deps.dir, THREADS), "utf8"));
        });
        return { opened: true };
    }

    /** Delete a past conversation for good. The current one is never deleted this way. */
    deletePast(id: unknown) {
        const dir = this.pastEntry(id);
        if (!fs.existsSync(dir)) throw new Error("That conversation isn't in the history anymore.");
        fs.rmSync(dir, { recursive: true });
        return { deleted: true };
    }

    /**
     * The agent's bubble, from its send_message tool: shown at once, mid-turn.
     * Refused (the model sees why) with no text, or a replyTo that isn't a message in the conversation.
     */
    say(text: string, replyTo: string | null = null): { id: string } {
        if (!this.running) throw new Error("there's no conversation going on right now");
        const message = text.trim();
        if (!message) throw new Error("say something first");
        if (message.length > LIMITS.message) throw new Error(`messages are limited to ${LIMITS.message} characters`);
        if (replyTo !== null) this.checkReplyTarget(replyTo);
        // quoting the one message this turn answers says nothing the bubble above doesn't: shown plain, as a text would be
        if (replyTo !== null && this.answering.length === 1 && this.answering[0] === replyTo) replyTo = null;
        const entry: ChatEntry = { id: this.newId(), at: Date.now(), kind: "agent", text: message, ...(replyTo === null ? {} : { replyTo }) };
        this.sent.push(message);
        this.setTyping(false);
        this.put(entry);
        return { id: entry.id };
    }

    /** The agent is using a tool other than its messages: it's working, not typing. */
    working() {
        this.setTyping(false);
    }

    private setTyping(on: boolean) {
        const typing = on && this.running !== null;
        if (typing === this.typing) return;
        this.typing = typing;
        this.state();
    }

    /** Stop the running turn; messages waiting for it are dropped with it. Not offered to the user: the agent just chats. */
    async stop() {
        this.queue = [];
        this.stopRequested = true;
        await this.killTurn();
        this.state();
    }

    async shutdown() {
        this.closed = true;
        this.queue = [];
        this.notices = [];
        await this.killTurn();
    }

    // ------------------------------------------------------------- the history

    /**
     * Stop the running turn, then change which conversation is current. Messages waiting for the old one are
     * dropped with it; the service's notices wait for the next turn, in whichever conversation that is.
     */
    private async swap(change: () => void) {
        if (this.closed) throw new Error("the conversation is shutting down");
        while (this.switching) await this.switching.catch(() => undefined);
        const run = (async () => {
            this.queue = [];
            this.stopRequested = true;
            await this.killTurn();
            await this.running;
            change();
        })();
        this.switching = run;
        try {
            await run;
        } finally {
            this.switching = null;
            this.pump();
        }
    }

    /**
     * Move the current conversation into the history. Its summary goes in first, then the files are moved,
     * so an interruption at any point leaves every message somewhere, never nowhere.
     */
    private putAway() {
        const said = this.entries.filter((e): e is Extract<ChatEntry, { kind: "user" | "agent" }> => e.kind === "user" || e.kind === "agent");
        const first = said.find((e) => e.kind === "user") ?? said[0];
        const text = first?.text.replace(/\s+/g, " ").trim() ?? "";
        const id = randomUUID().replace(/-/g, "").slice(0, 12);
        const meta: PastConversation = {
            id,
            title: text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 1).trimEnd()}…` : text || "A conversation",
            startedAt: this.entries[0]!.at,
            endedAt: this.entries.at(-1)!.at,
            messages: said.length,
        };
        const tmp = path.join(this.pastDir(), `.${id}`);
        fs.mkdirSync(tmp, { recursive: true });
        fs.writeFileSync(path.join(tmp, PAST_META), JSON.stringify(meta));
        const dir = path.join(this.pastDir(), id);
        fs.renameSync(tmp, dir);
        for (const name of [TRANSCRIPT, THREADS]) {
            const from = path.join(this.deps.dir, name);
            if (fs.existsSync(from)) fs.renameSync(from, path.join(dir, name));
        }
        this.entries = [];
        this.threads = {};
    }

    private pastDir() {
        return path.join(this.deps.dir, PAST);
    }

    /** Past conversations' ids; a half-made one (a dot folder from an interrupted put-away) isn't listed. */
    private pastIds(): string[] {
        if (!fs.existsSync(this.pastDir())) return [];
        return fs.readdirSync(this.pastDir()).filter((n) => PAST_ID.test(n));
    }

    private pastEntry(id: unknown): string {
        if (typeof id !== "string" || !PAST_ID.test(id)) throw new Error("that isn't a conversation's id");
        return path.join(this.pastDir(), id);
    }

    // ------------------------------------------------------------- turns

    private pump() {
        this.state();
        if (this.running || this.closed || this.switching || (this.queue.length === 0 && this.notices.length === 0)) return;
        const batch = this.queue.splice(0);
        const notices = this.notices.splice(0);
        this.stopRequested = false; // a stop asked of an earlier turn doesn't silence this one
        // read now, so now they join the conversation
        for (const m of batch) this.put({ id: m.id, at: Date.now(), kind: "user", text: m.text, ...(m.replyTo ? { replyTo: m.replyTo } : {}) });
        const message = [...batch.map((m) => this.forAgent(m)), ...notices.map((n) => `[from Paperboard, not the user] ${n}`)].join("\n\n");
        this.sent = [];
        this.answering = batch.map((m) => m.id);
        // answering the user begins with writing to them; a routine's turn shows nothing until it writes
        this.typing = batch.length > 0;
        this.running = this.turn(message, batch.length > 0)
            .catch((e: Error) => {
                this.put({ id: this.newId(), at: Date.now(), kind: "error", text: e.message });
            })
            .finally(() => {
                this.running = null;
                this.answering = [];
                this.typing = false;
                this.stopRequested = false;
                this.pump();
            });
        this.state();
    }

    /** One run of the harness. `forUser`: it answers the user's messages, so it must end with a reply. */
    private async turn(message: string, forUser: boolean) {
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
        const plain: string[] = [];
        const onLine = (line: string) => {
            for (const ev of parseTurnLine(settings.harness, line)) {
                if (ev.type === "thread") this.saveThread(settings.harness, ev.id);
                else if (ev.type === "message") plain.push(ev.text);
                else if (ev.type === "failed") failures.push(ev.message);
                else if (ev.type === "typing") this.setTyping(true);
                else if (ev.type === "working") this.setTyping(false);
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
            env: { ...launch.env, [launch.tokenEnv]: mcp.token },
        });
        const timer = setTimeout(() => void this.killTurn(), this.deps.turnMs ?? TURN_MS);
        let code: number | undefined;
        try {
            code = await exited;
        } finally {
            clearTimeout(timer);
        }
        if (buf.trim()) onLine(buf);
        // plain output reaches the user only when the model never texted: a turn that did text ends with its own
        // recap of what it sent ("I sent you two messages…"), which isn't meant for the user. A turn that only
        // answers a notice texts with send_message or not at all: its plain output is its note to itself
        if (this.sent.length === 0 && forUser) {
            for (const text of plain) {
                if (!text.trim()) continue;
                this.sent.push(text);
                this.put({ id: this.newId(), at: Date.now(), kind: "agent", text: text.trim() });
            }
        }
        if (this.stopRequested) return;
        if (failures.length) throw new Error(failures[failures.length - 1]);
        if (code !== 0) throw new Error(`the turn ended with exit ${code ?? "?"}${stderr.trim() ? `: ${lastLines(stderr)}` : ""}`);
        if (this.sent.length === 0 && forUser) throw new Error("the turn ended without a reply");
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

    /** A message as the agent reads it: its id first, so it can reply to it; what it answers is quoted. */
    private forAgent(m: WaitingMessage): string {
        const to = m.replyTo ? this.entries.find((e) => e.id === m.replyTo) : undefined;
        const quote = to && "text" in to ? ` (replying to [${to.id}] “${to.text.length > QUOTE_CHARS ? to.text.slice(0, QUOTE_CHARS - 1) + "…" : to.text}”)` : "";
        return `[${m.id}]${quote} ${m.text}`;
    }

    /** Replies point at what's in the conversation: the user's and the agent's own messages, nothing else. */
    private checkReplyTarget(id: string) {
        const to = this.entries.find((e) => e.id === id);
        if (!to || (to.kind !== "user" && to.kind !== "agent")) throw new Error(`no message [${id}] to reply to`);
    }

    /** Short enough for the model to carry in a reply_to; unique among everything the conversation knows. */
    private newId(): string {
        for (;;) {
            const id = randomUUID().replace(/-/g, "").slice(0, SHORT_ID);
            if (!this.entries.some((e) => e.id === id) && !this.queue.some((m) => m.id === id)) return id;
        }
    }

    private state() {
        // busy only while answering the user: a routine that finds nothing to say shows nothing
        this.deps.onState({
            busy: this.running !== null && this.answering.length > 0,
            typing: this.running !== null && this.typing,
            waiting: this.queue.map((m) => ({ ...m })),
        });
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
            // transcripts from before the chat was only a chat hold tool-call entries: not messages, not shown
            if (e.kind !== "user" && e.kind !== "agent" && e.kind !== "error" && e.kind !== "sign-in") return;
            // a sign-in request lives only as long as the service that asked for it
            if (e.kind === "sign-in" && (e.status === "waiting" || e.status === "submitting")) e = { ...e, status: "expired" };
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
