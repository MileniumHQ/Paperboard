// The current conversation, and the ones put away. Like texting a friend,
// every message continues the same thread until the user starts a new one;
// the old one goes into the history (its transcript and harness threads,
// moved as they are) and can be reopened and continued. Starting over is
// different: it forgets the current conversation.
// Messages sent while the agent is busy wait until it reads them, and can be
// taken back until then. It reads them as it works, like a text arriving
// mid-task: they come with the result of its next tool call (see news()), so
// it can answer and change course without the turn ending. Any it didn't get
// to are read together on its next turn. The agent talks through send_message (see
// messages.ts): each call is a bubble, added at once, mid-turn. The service
// can start a turn too, with a notice (a routine is due): the agent reads it
// like a message that isn't from the user, and texts only if it has
// something to say.
// A message isn't read the moment it's sent: the agent waits until the user
// has been quiet for a second (see userTyping()), so a thought sent in parts is
// read whole.
//
// A long conversation costs the user tokens on every turn, and in the end
// overflows the model. After a turn that left the thread past its budget,
// the conversation compacts itself, as the settings say: the agent
// summarizes it, or its older part is forgotten. Either way the harness
// threads are dropped and the next turn starts a fresh one, seeded with the
// summary and the latest messages (the carry). Messages sent meanwhile wait.
//
// A turn is the harness run as a daemon-supervised child (one at a time, id
// TURN_PROC_ID). The transcript is an append-only JSONL file in the panel's
// storage, compacted when it grows past a cap; an entry that changes is
// appended again and the latest copy wins.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LIMITS, PANEL_ID, type Attachment, type ChatEntry, type ChatState, type Harness, type PastConversation, type Settings, type SignInEntry, type WaitingMessage } from "../contract";
import type { StartOptions } from "./browser";
import { Attachments, sizeText } from "./attachments";
import { AcpTurn, type AcpEvent } from "./acp";
import { HARNESS_NAMES, codexContext, parseTurnLine, turnLaunch } from "./harness";
import { writeLine } from "./mcpClient";

export const TURN_PROC_ID = `${PANEL_ID}.turn`;
const TRANSCRIPT = "transcript.jsonl";
const THREADS = "threads.json";
const ATTACHMENTS = "attachments";
const PAST = "past";
const CARRY = "carry.json";
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
const TOOLS_MS = 30_000; // how long OpenCode gets to connect to the panel's tools
const TOOLS_SETTLE_MS = 300; // OpenCode reloads its tools 100 ms after they change; then the next step has them
const QUOTE_CHARS = 80;
const SHORT_ID = 6;
/** how long the user has to be quiet before their messages are read */
export const QUIET_MS = 1000;
/** tokens of context a thread can fill before it's compacted; or 3/4 of the model's window, if that's less */
export const CONTEXT_BUDGET = 100_000;
const WINDOW_SHARE = 0.75;
/** the latest messages a compacted conversation carries as they were */
const CARRY_MESSAGES = 10;

const SUMMARIZE = `[from Paperboard, not the user] This conversation has grown long, so it will go on in a fresh thread that starts from your summary of it and the latest few messages. Don't text the user and don't use any tools: just write the summary, as plain text, for yourself. Include:
- who the user is and how they like to talk, as far as this conversation shows
- what they asked for and why, what's done, what's decided and what's still open
- the exact details you'd need again: names, links, ids, file ids, numbers, quotes
- what you were in the middle of, and what you said you'd do next
Leave out small talk and finished things that won't matter again. Be complete but compact.`;

/** What a compacted conversation carries into its next thread. */
interface Carry {
    /** the agent's summary; null when the older part was forgotten instead */
    summary: string | null;
    /** the first of the latest messages, carried as they were; null when there were none */
    from: string | null;
}

/** How much of the model's context the last turn left its thread filling. */
interface Context {
    harness: Harness;
    used: number | null;
    size: number | null;
}

export interface TurnHost {
    start(o: StartOptions): Promise<unknown>;
    write(id: string, data: string): Promise<void>;
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
    mcp: () => { url: string; token: string; onToolsListed(cb: () => void): () => void };
    /** every toolset's part of the agent's instructions, read at the start of each turn */
    instructions: () => Promise<string[]>;
    emit: (entry: ChatEntry) => void;
    onState: (s: ChatState) => void;
    /** Codex's home, where its rollouts say how long a thread is; null leaves Codex's threads unmeasured */
    codexHome: string | null;
    turnMs?: number;
    quietMs?: number;
    contextBudget?: number;
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
    /** the user's latest messages in the running turn have no text after them yet; until they do, plain output is the answer */
    private unanswered = false;
    /** the running turn's plain output, and where the part written since the user's latest messages begins */
    private plain: string[] = [];
    private plainFrom = 0;
    /** ids of the user's messages the running turn is answering */
    private answering: string[] = [];
    /** the agent is writing to the user right now, not working: only then does the typing bubble show */
    private typing = false;
    /** waiting messages aren't read before this: the user was typing */
    private holdUntil = 0;
    private holdTimer: ReturnType<typeof setTimeout> | null = null;
    private context: Context | null = null;
    private carry: Carry | null = null;
    private compactingNow = false;

    /** the current conversation's files */
    readonly attachments: Attachments;

    constructor(private deps: ConversationDeps) {
        this.attachments = new Attachments(() => deps.dir);
    }

    init() {
        fs.mkdirSync(this.deps.dir, { recursive: true });
        this.entries = this.load();
        const threads = path.join(this.deps.dir, THREADS);
        if (fs.existsSync(threads)) this.threads = JSON.parse(fs.readFileSync(threads, "utf8"));
        this.carry = this.loadCarry();
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
    send(text: string, replyTo: string | null = null, attachmentIds: unknown = []): { id: string; waiting: boolean } {
        const message = text.trim();
        const files = this.sentFiles(attachmentIds);
        if (!message && files.length === 0) throw new Error("say something first");
        if (message.length > LIMITS.message) throw new Error(`messages are limited to ${LIMITS.message} characters`);
        if (!this.deps.settings()) throw new Error("finish setting up first");
        if (this.queue.length >= MAX_QUEUED) throw new Error("that's a lot of messages at once; wait for a reply");
        if (replyTo !== null) this.checkReplyTarget(replyTo);
        const id = this.newId();
        this.queue.push({ id, text: message, ...(replyTo === null ? {} : { replyTo }), ...(files.length ? { attachments: files } : {}) });
        this.hold();
        const waiting = this.running !== null;
        this.pump();
        return { id, waiting };
    }

    /** The user is typing: messages still waiting wait until they stop, so they're read with what comes next. */
    userTyping() {
        if (this.queue.length === 0) return { held: false };
        this.hold();
        this.state();
        return { held: true };
    }

    get compacting() {
        return this.compactingNow;
    }

    private hold() {
        this.holdUntil = Date.now() + (this.deps.quietMs ?? QUIET_MS);
    }

    private held() {
        return this.queue.length > 0 && Date.now() < this.holdUntil;
    }

    /** The files a message carries: finished uploads in this conversation, each once, up to the limit. */
    private sentFiles(ids: unknown): Attachment[] {
        if (!Array.isArray(ids)) throw new Error("attachments are a list of file ids");
        if (ids.length > LIMITS.attachments.perMessage) throw new Error(`a message can carry ${LIMITS.attachments.perMessage} files`);
        if (new Set(ids).size !== ids.length) throw new Error("that file is attached twice");
        return ids.map((id) => this.attachments.get(id));
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
        this.holdUntil = 0;
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
            this.setCarry(null);
            fs.rmSync(path.join(this.deps.dir, ATTACHMENTS), { recursive: true, force: true });
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
            // files uploaded and never sent belong to no message: they don't come along
            else fs.rmSync(path.join(this.deps.dir, ATTACHMENTS), { recursive: true, force: true });
            const files = path.join(dir, ATTACHMENTS);
            if (fs.existsSync(files)) fs.renameSync(files, path.join(this.deps.dir, ATTACHMENTS));
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
            // a carry is only there if it was compacted and not yet carried on
            const carry = path.join(dir, CARRY);
            if (fs.existsSync(carry)) fs.renameSync(carry, path.join(this.deps.dir, CARRY));
            fs.rmSync(dir, { recursive: true });
            this.entries = this.load();
            this.threads = JSON.parse(fs.readFileSync(path.join(this.deps.dir, THREADS), "utf8"));
            this.carry = this.loadCarry();
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
        // a file it shows has to be one of the conversation's, or the bubble would show nothing
        for (const m of message.matchAll(/\]\(\s*<?attachment:([^)\s>]*)/g)) this.attachments.get(m[1]);
        // quoting the one message this turn answers says nothing the bubble above doesn't: shown plain, as a text would be
        if (replyTo !== null && this.answering.length === 1 && this.answering[0] === replyTo) replyTo = null;
        const entry: ChatEntry = { id: this.newId(), at: Date.now(), kind: "agent", text: message, ...(replyTo === null ? {} : { replyTo }) };
        this.unanswered = false;
        this.setTyping(false);
        this.put(entry);
        return { id: entry.id };
    }

    /**
     * The messages sent since the running turn read the last ones, as the agent reads them after a tool's result,
     * or null when there are none. Handed over, they're read: they join the conversation and the turn answers them.
     */
    news(): string | null {
        if (!this.running || this.switching || this.closed || this.compactingNow || this.queue.length === 0 || this.held()) return null;
        const batch = this.queue.splice(0);
        this.read(batch);
        this.answering.push(...batch.map((m) => m.id));
        this.unanswered = true;
        this.plainFrom = this.plain.length;
        this.setTyping(true);
        this.state();
        return `\n\n[new messages from the user, sent while you were working]\n${batch.map((m) => this.forAgent(m)).join("\n\n")}`;
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
        if (this.holdTimer) clearTimeout(this.holdTimer);
        this.queue = [];
        this.attachments.closeUploads();
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
            this.attachments.closeUploads();
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
        for (const name of [TRANSCRIPT, THREADS, ATTACHMENTS, CARRY]) {
            const from = path.join(this.deps.dir, name);
            if (fs.existsSync(from)) fs.renameSync(from, path.join(dir, name));
        }
        this.entries = [];
        this.threads = {};
        this.carry = null;
        this.context = null;
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
        // the user may say more: read it all once they've stopped
        if (this.held()) {
            if (this.holdTimer) clearTimeout(this.holdTimer);
            this.holdTimer = setTimeout(() => {
                this.holdTimer = null;
                this.pump();
            }, this.holdUntil - Date.now());
            return;
        }
        const batch = this.queue.splice(0);
        const notices = this.notices.splice(0);
        this.stopRequested = false; // a stop asked of an earlier turn doesn't silence this one
        this.read(batch);
        const message = [...batch.map((m) => this.forAgent(m)), ...notices.map((n) => `[from Paperboard, not the user] ${n}`)].join("\n\n");
        this.unanswered = batch.length > 0;
        this.plain = [];
        this.plainFrom = 0;
        this.answering = batch.map((m) => m.id);
        // answering the user begins with writing to them; a routine's turn shows nothing until it writes
        this.typing = batch.length > 0;
        this.running = this.turn(message)
            .catch((e: Error) => {
                this.put({ id: this.newId(), at: Date.now(), kind: "error", text: e.message });
            })
            .then(() => this.compactIfLong())
            .finally(() => {
                this.running = null;
                this.answering = [];
                this.typing = false;
                this.stopRequested = false;
                this.pump();
            });
        this.state();
    }

    /** Read now, so now they join the conversation. */
    private read(batch: WaitingMessage[]) {
        for (const m of batch) {
            this.put({ id: m.id, at: Date.now(), kind: "user", text: m.text, ...(m.replyTo ? { replyTo: m.replyTo } : {}), ...(m.attachments ? { attachments: m.attachments } : {}) });
        }
    }

    /**
     * One run of the harness. One that answers the user's messages (from its start or read as it works) must end
     * with a reply. A compacted conversation's first turn starts its fresh thread from the carry, which is done
     * with once that turn has gone through; until then, each try starts from it again.
     */
    private async turn(message: string) {
        const settings = this.deps.settings();
        if (!settings) throw new Error("finish setting up first");
        const thread = this.threads[settings.harness] ?? null;
        const carry = thread === null && !this.compactingNow ? this.carry : null;
        try {
            await this.run(settings, thread, carry ? `${this.seed(carry)}\n\n${message}` : message);
        } catch (e) {
            if (carry) this.dropThread(settings.harness);
            throw e;
        }
        if (carry && this.stopRequested) this.dropThread(settings.harness);
        else if (carry) this.setCarry(null);
    }

    private async run(settings: Settings, thread: string | null, message: string) {
        const command = this.deps.resolve(settings.harness);
        if (!command) throw new Error(`${HARNESS_NAMES[settings.harness]} isn't installed on this computer anymore.`);
        const mcp = this.deps.mcp();
        const sections = await this.deps.instructions();
        const launch = turnLaunch({
            harness: settings.harness,
            command,
            model: settings.model,
            name: settings.name,
            thread,
            message,
            mcpUrl: mcp.url,
            sections,
        });
        if (launch.thread) this.saveThread(settings.harness, launch.thread);

        let buf = "";
        let stderr = "";
        const failures: string[] = [];
        const plain = this.plain;
        const timers = new Set<ReturnType<typeof setTimeout>>();
        let answered = false;
        const context: Context = { harness: settings.harness, used: null, size: null };
        this.context = context;
        const onEvent = (ev: AcpEvent) => {
            if (ev.type === "thread") this.saveThread(settings.harness, ev.id);
            else if (ev.type === "context") {
                if (ev.used !== undefined) context.used = ev.used;
                if (ev.size !== undefined) context.size = ev.size;
            }
            else if (ev.type === "message") plain.push(ev.text);
            else if (ev.type === "failed") failures.push(ev.message);
            else if (ev.type === "typing") this.setTyping(true);
            else if (ev.type === "working") this.setTyping(false);
            else if (ev.type === "done") {
                // the prompt is answered; OpenCode would wait for the next one
                answered = true;
                const stop = (signal: string) =>
                    this.deps.host
                        .exists(TURN_PROC_ID)
                        .then((alive) => (alive ? this.deps.host.kill(TURN_PROC_ID, signal) : undefined))
                        .catch((e) => console.warn(`[ai] couldn't stop OpenCode after its answer (the turn's time limit still will): ${e instanceof Error ? e.message : e}`));
                void stop("SIGTERM");
                timers.add(setTimeout(() => void stop("SIGKILL"), STOP_GRACE_MS));
            }
        };
        // OpenCode connects to the panel's tools in the background: its prompt waits until it has listed them
        let listed = false;
        let onListed: (() => void) | null = null;
        const offListed = mcp.onToolsListed(() => {
            listed = true;
            onListed?.();
        });
        const ready = () =>
            new Promise<void>((ok, fail) => {
                const timeout = setTimeout(() => fail(new Error("OpenCode didn't connect to the panel's tools")), TOOLS_MS);
                timers.add(timeout);
                const go = () => {
                    clearTimeout(timeout);
                    timers.add(setTimeout(ok, TOOLS_SETTLE_MS));
                };
                if (listed) go();
                else onListed = go;
            });
        const acp =
            settings.harness === "opencode"
                ? new AcpTurn({
                      cwd: this.workdir(),
                      thread: launch.thread,
                      model: settings.model,
                      message,
                      ready,
                      write: (line) => writeLine(this.deps.host.write, TURN_PROC_ID, line),
                      emit: onEvent,
                  })
                : null;
        const onLine = (line: string) => {
            if (acp) acp.line(line);
            else for (const ev of parseTurnLine(settings.harness, line)) onEvent(ev);
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
        let timer: ReturnType<typeof setTimeout> | undefined;
        let code: number | undefined;
        try {
            await this.deps.host.start({
                id: TURN_PROC_ID,
                command: launch.command,
                args: launch.args,
                cwd: this.workdir(),
                env: { ...launch.env, [launch.tokenEnv]: mcp.token },
                // only an ACP turn talks over stdin; codex exec reads a piped stdin to its end before it starts
                ...(acp ? {} : { stdin: false }),
            });
            timer = setTimeout(() => void this.killTurn(), this.deps.turnMs ?? TURN_MS);
            const driven = acp?.run();
            code = await exited;
            if (buf.trim()) onLine(buf);
            acp?.close();
            await driven;
        } finally {
            clearTimeout(timer);
            offListed();
            for (const t of timers) clearTimeout(t);
        }
        // Codex says how long its thread is only in its rollout
        let unmeasured: string | null = null;
        const codexThread = this.threads.codex;
        if (settings.harness === "codex" && this.deps.codexHome && codexThread) {
            try {
                Object.assign(context, codexContext(this.deps.codexHome, codexThread));
            } catch (e) {
                unmeasured = e instanceof Error ? e.message : String(e);
            }
        }
        // plain output reaches the user only when the model never texted after their latest messages: a turn that
        // did text ends with its own recap of what it sent ("I sent you two messages…"), which isn't meant for the
        // user. A turn that only answers a notice texts with send_message or not at all: its plain output is its
        // note to itself
        const forUser = this.answering.length > 0;
        if (this.unanswered && forUser) {
            for (const text of plain.slice(this.plainFrom)) {
                if (!text.trim()) continue;
                this.unanswered = false;
                this.put({ id: this.newId(), at: Date.now(), kind: "agent", text: text.trim() });
            }
        }
        if (this.stopRequested) return;
        if (failures.length) throw new Error(failures[failures.length - 1]);
        if (code !== 0 && !answered) throw new Error(`the turn ended with exit ${code ?? "?"}${stderr.trim() ? `: ${lastLines(stderr)}` : ""}`);
        if (this.unanswered && forUser) throw new Error("the turn ended without a reply");
        if (unmeasured) throw new Error(`Couldn't tell how long the conversation is, so it can't be compacted: ${unmeasured}`);
    }

    // ------------------------------------------------------------- compaction

    /** After a turn: a thread past its budget is compacted before the next turn, as the settings say. */
    private async compactIfLong() {
        const settings = this.deps.settings();
        const c = this.context;
        if (!settings || !c || c.used === null || this.stopRequested || this.closed || c.harness !== settings.harness || !this.threads[c.harness]) return;
        const budget = Math.min(this.deps.contextBudget ?? CONTEXT_BUDGET, c.size ? Math.floor(c.size * WINDOW_SHARE) : Infinity);
        if (c.used < budget) return;
        this.answering = [];
        this.typing = false;
        this.compactingNow = true;
        this.state();
        try {
            const summary = settings.compaction === "summarize" ? await this.summarize() : null;
            if (this.stopRequested) return; // stopped for a reason of its own (a new conversation): nothing to carry on
            this.compact(summary);
        } catch (e) {
            if (this.stopRequested) return;
            // the thread stays as it was: nothing is lost, and the next turn's end tries again
            this.put({
                id: this.newId(),
                at: Date.now(),
                kind: "error",
                text: `Couldn't summarize the conversation to save space: ${e instanceof Error ? e.message : e}. It tries again after the next reply; if this keeps happening, set Compaction to Forget in settings.`,
            });
        } finally {
            this.compactingNow = false;
            this.context = null;
        }
    }

    /** The agent's summary of the conversation, written in its own thread (so it knows everything the thread does). */
    private async summarize(): Promise<string> {
        this.plain = [];
        this.plainFrom = 0;
        this.unanswered = false;
        await this.turn(SUMMARIZE);
        const summary = this.plain.join("\n\n").trim();
        if (!summary && !this.stopRequested) throw new Error("it wrote nothing");
        return summary;
    }

    /** Drop every harness thread; the next turn starts a fresh one from the summary (if any) and the latest messages. */
    private compact(summary: string | null) {
        const said = this.entries.filter((e) => e.kind === "user" || e.kind === "agent");
        this.setCarry({ summary, from: said[Math.max(0, said.length - CARRY_MESSAGES)]?.id ?? null });
        this.threads = {};
        atomicWrite(path.join(this.deps.dir, THREADS), "{}");
    }

    /** What a fresh thread starts with: the summary, then the latest messages as they were (not the ones it's about to read). */
    private seed(carry: Carry): string {
        const from = carry.from ? this.entries.findIndex((e) => e.id === carry.from) : -1;
        const latest = (from >= 0 ? this.entries.slice(from) : [])
            .filter((e): e is Extract<ChatEntry, { kind: "user" | "agent" }> => (e.kind === "user" || e.kind === "agent") && !this.answering.includes(e.id))
            .map((e) => (e.kind === "user" ? `The user: ${this.forAgent(e)}` : `You: [${e.id}] ${e.text}`));
        return [
            `[from Paperboard, not the user] This conversation got long, so it goes on in a fresh thread. ${carry.summary ? `Your summary of it so far:\n\n${carry.summary}` : "Its older part was forgotten to save space."}`,
            ...(latest.length ? [`The latest messages, as they were:\n\n${latest.join("\n\n")}`] : []),
            "[the conversation goes on]",
        ].join("\n\n");
    }

    private setCarry(carry: Carry | null) {
        this.carry = carry;
        const file = path.join(this.deps.dir, CARRY);
        if (carry) atomicWrite(file, JSON.stringify(carry));
        else fs.rmSync(file, { force: true });
    }

    private loadCarry(): Carry | null {
        const file = path.join(this.deps.dir, CARRY);
        return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Carry) : null;
    }

    private dropThread(harness: Harness) {
        const { [harness]: _, ...rest } = this.threads;
        this.threads = rest;
        atomicWrite(path.join(this.deps.dir, THREADS), JSON.stringify(this.threads));
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
        const files = (m.attachments ?? []).map((a) => `\n(attached: [file ${a.id}] ${a.name}, ${a.kind === "file" ? a.type : a.kind}, ${sizeText(a.bytes)})`).join("");
        return `[${m.id}]${quote} ${m.text}${files}`;
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
            held: this.running === null && this.held(),
            compacting: this.compactingNow,
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
