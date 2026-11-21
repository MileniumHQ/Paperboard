// The current conversation, and the ones put away. Like texting a friend,
// every message continues the same thread until the user starts a new one;
// the old one goes into the history (its transcript and harness threads,
// moved as they are) and can be reopened and continued. Starting over is
// different: it forgets the current conversation.
// The user can chime in at any time: a message sent while the agent works
// stops its turn there, and the next turn picks the same thread up with the
// message, so it answers and changes course at once rather than whenever it
// next calls a tool. Only a compaction finishes first. The agent talks through send_message (see
// messages.ts): each call is a bubble, added at once, mid-turn. The service
// can start a turn too, with a notice (a routine is due): the agent reads it
// like a message that isn't from the user, and texts only if it has
// something to say.
// A long conversation costs the user tokens on every turn, and in the end
// overflows the model. After a turn that left the thread past its budget,
// the conversation compacts itself, as the settings say: the agent
// summarizes it, or its older part is forgotten. Either way the harness
// threads are dropped and the next turn starts a fresh one, seeded with the
// summary and the latest messages (the carry). Messages sent meanwhile wait.
//
// A turn is the harness run as a daemon-supervised child (one at a time, id
// TURN_PROC_ID). The transcript is transcript.ts's, the history history.ts's.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { errorMessage, problemsApi, stopProcess } from "@mileniumhq/paperapi";
import { writeFileAtomicSync } from "@mileniumhq/paperapi/fs";
import { BRAINS, CURRENT_CONVERSATION, LIMITS, PANEL_ID, type AccessEntry, type PageEntry, type PromptEntry, type ToolServerEntry, type ToolSignInEntry, type Attachment, type ChatEntry, type ChatState, type Harness, type PastConversation, type Settings, type SignInEntry, type StatusTone, type WaitingMessage } from "../contract";
import type { StartOptions } from "./browser";
import { Attachments } from "./attachments";
import { sizeText } from "../lib/files";
import { MCP_SERVER, codexContext, instructions, removeLeftRunFiles, runFilesDir, turnLaunch, type TurnLaunch } from "./harness";
import { harnessFailure, runHarness } from "./harnessRun";
import type { TurnLog } from "./turnLog";
import { ATTACHMENTS, CARRY, History, summary, THREADS } from "./history";
import { said, Transcript, TRANSCRIPT, type Said } from "./transcript";
import type { Sections, TurnMode } from "./toolsets";

export const TURN_PROC_ID = `${PANEL_ID}.turn`;
const RUN = "run";
const MAX_QUEUED = 20;
const MAX_NOTICES = 10;
const TURN_MS = 30 * 60_000;
const TOOLS_MS = 30_000; // how long OpenCode gets to connect to the panel's tools
const TOOLS_SETTLE_MS = 300; // OpenCode reloads its tools 100 ms after they change; then the next step has them
const QUOTE_CHARS = 80;
const SHORT_ID = 6;
/** tokens of context a thread can fill before it's compacted; or 3/4 of the model's window, if that's less */
const CONTEXT_BUDGET = 100_000;
const WINDOW_SHARE = 0.75;
/** the latest messages a compacted conversation carries as they were */
const CARRY_MESSAGES = 10;

const SUMMARIZE = `[from Paperboard, not the user] This conversation has grown long, so it will go on in a fresh thread that starts from your summary of it and the latest few messages. Don't text the user and don't use any tools: just write the summary, as plain text, for yourself. Include:
- who the user is and how they like to talk, as far as this conversation shows
- what they asked for and why, what's done, what's decided and what's still open
- the exact details you'd need again: names, links, ids, file ids, numbers, quotes
- what you were in the middle of, and what you said you'd do next
Leave out small talk and finished things that won't matter again. Be complete but compact.`;

// a turn that answered the user in plain output, which they never see
const UNTEXTED = `[from Paperboard, not the user] Your turn ended without a send_message, so the user hasn't heard from you. Plain output is never shown: send them your reply with send_message now.`;

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
    /** ends the child's input after what was written to it */
    closeInput(id: string): Promise<void>;
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
    /** the harness's isolated home folder in the panel's storage */
    home: (harness: Harness) => string;
    /** what the harness runs with besides the daemon's environment: its home, and no updating itself */
    env: (harness: Harness) => Record<string, string>;
    /** why the harness can't take a turn (not signed in, say), or null: asked before it's started, so a signed-out harness fails with the way out instead of its own reply */
    problem?: (harness: Harness) => string | null;
    /** the computer's MCP endpoint for this service generation */
    mcp: () => { url: string; token: string; onToolsListed(cb: () => void): () => void };
    /** every toolset's part of the agent's instructions, read at the start of each turn */
    instructions: () => Promise<Sections>;
    /** the model writing this tool's call is the agent typing to the user (Toolbox.writes) */
    writes: (tool: string) => boolean;
    /** the developer's log of every turn (turnLog.ts), when it's switched on */
    log?: TurnLog | null;
    emit: (entry: ChatEntry) => void;
    /** a turn ended without doing what it was for: its error, as the conversation shows it */
    onTurnFailed?: (error: string) => void;
    /** a turn is over, whatever became of it: what was allowed for it lapses */
    onTurnEnd?: () => void;
    /** the conversation is about to be left (started over, or another made current): what's waiting on it lapses */
    onLeave?: () => void;
    onState: (s: ChatState) => void;
    /** Codex's home, where its rollouts say how long a thread is; null leaves Codex's threads unmeasured */
    codexHome: string | null;
    turnMs?: number;
    contextBudget?: number;
}

export class Conversation {
    private transcript: Transcript;
    /** the conversations put away */
    private archive: History;
    private threads: Partial<Record<Harness, string>> = {};
    private queue: WaitingMessage[] = [];
    /** the service's notices for the agent's next turn; not the user's, so not in the conversation */
    private notices: string[] = [];
    /** the notices the running turn was started with: a turn the user stops hands them on to the next */
    private turnNotices: string[] = [];
    private running: Promise<void> | null = null;
    private stopRequested = false;
    private closed = false;
    /** set while conversations are swapped: no turn starts until the files are in place */
    private switching: Promise<unknown> | null = null;
    /** the user's messages in the running turn have no text after them yet: the agent owes them a reply */
    private unanswered = false;
    /** the running turn's plain output: only a summary is written that way, never a reply */
    private plain: string[] = [];
    /** ids of the user's messages the running turn is answering */
    private answering: string[] = [];
    /**
     * The typing bubble: on only while the model writes something the user reads (a text, or a card like a
     * sign-in), from the moment its harness shows the call begin until the call arrives. Thinking, plain output
     * and any other tool are not typing.
     */
    private typing = false;
    /**
     * The running turn's calls to tools written to the user, by name: begun (as its harness shows them) and
     * arrived. The harness's output and the calls come by different ways, so a call can arrive before the line
     * that says it began: begun no more often than arrived is a call that's already done, not typing.
     */
    private begun = new Map<string, number>();
    private arrived = new Map<string, number>();
    private context: Context | null = null;
    private carry: Carry | null = null;
    private compactingNow = false;
    /** the running turn answers a flow's messages */
    private turnFromFlow = false;
    /** and the flow's own instructions for it */
    private turnInstructions: string | undefined;

    /** the current conversation's files */
    readonly attachments: Attachments;

    constructor(private deps: ConversationDeps) {
        this.attachments = new Attachments(() => deps.dir);
        this.transcript = new Transcript(path.join(deps.dir, TRANSCRIPT));
        this.archive = new History(deps.dir);
    }

    init() {
        fs.mkdirSync(this.deps.dir, { recursive: true });
        this.loadCurrent();
        // the instructions files of runs the last service generation didn't see to their end (the questions' too, in Codex's home)
        removeLeftRunFiles(this.runDir());
        const codexHome = this.deps.env("codex").CODEX_HOME;
        if (codexHome) removeLeftRunFiles(codexHome);
        // a turn the last service generation left running is not ours to finish, and nobody waits on it
        void stopProcess(TURN_PROC_ID, { host: this.deps.host }).catch((e) =>
            problemsApi.report(PANEL_ID, { key: "turn-left", title: "A turn left running from before couldn't be stopped", message: errorMessage(e) }));
    }

    /** The current conversation and what goes with it, read from its files. */
    private loadCurrent() {
        const threads = this.readSaved<Partial<Record<Harness, string>>>(THREADS) ?? {};
        const carry = this.readSaved<Carry>(CARRY);
        this.transcript.load();
        this.threads = threads;
        this.carry = carry;
    }

    /** One of the conversation's own files, or null when there's none. A damaged one is named, and left as it is. */
    private readSaved<T>(name: string): T | null {
        const file = path.join(this.deps.dir, name);
        if (!fs.existsSync(file)) return null;
        try {
            return JSON.parse(fs.readFileSync(file, "utf8")) as T;
        } catch (e) {
            throw new Error(`${file} can't be read (${errorMessage(e)}); fix or delete it`);
        }
    }

    private get entries(): ChatEntry[] {
        return this.transcript.entries;
    }

    history(limit: number = LIMITS.history): ChatEntry[] {
        return this.entries.slice(-Math.max(1, Math.min(limit, LIMITS.history)));
    }

    /**
     * Send a message: read now, stopping what the agent was doing, or once a compaction is done. A flow's message
     * (fromFlow) is answered for the flow: see TurnMode.
     */
    send(text: string, replyTo: string | null = null, attachmentIds: unknown = [], o: { fromFlow?: boolean; instructions?: string } = {}): { id: string; waiting: boolean } {
        const message = text.trim();
        const files = this.sentFiles(attachmentIds);
        if (!message && files.length === 0) throw new Error("say something first");
        if (message.length > LIMITS.message) throw new Error(`messages are limited to ${LIMITS.message} characters`);
        if (!this.deps.settings()) throw new Error("finish setting up first");
        if (this.queue.length >= MAX_QUEUED) throw new Error("that's a lot of messages at once; wait for a reply");
        if (replyTo !== null) this.checkReplyTarget(replyTo);
        const instructions = o.fromFlow ? o.instructions?.trim() : undefined;
        if (instructions && instructions.length > LIMITS.instructions) throw new Error(`instructions are limited to ${LIMITS.instructions} characters`);
        const id = this.newId();
        this.queue.push({ id, text: message, ...(replyTo === null ? {} : { replyTo }), ...(files.length ? { attachments: files } : {}), ...(o.fromFlow ? { fromFlow: true } : {}), ...(instructions ? { instructions } : {}) });
        const waiting = this.running !== null;
        // the user's message stops the turn; a flow's waits for it, so an automation never cuts the user off
        if (waiting && !o.fromFlow) this.interrupt();
        this.pump();
        return { id, waiting };
    }

    get compacting() {
        return this.compactingNow;
    }

    /** Who the running turn answers: the user, or a flow. */
    mode(): TurnMode {
        return { fromFlow: this.turnFromFlow, ...(this.turnInstructions ? { instructions: this.turnInstructions } : {}) };
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
     * end without a text. Throws when there's no agent to tell yet, or it has too much waiting.
     */
    notice(text: string) {
        if (this.closed) throw new Error("the conversation is shutting down");
        if (!this.deps.settings()) throw new Error("the agent isn't set up yet");
        // a backlog this long means turns aren't keeping up: this one is refused, and whoever sent it shows why
        if (this.notices.length >= MAX_NOTICES) throw new Error(`the agent has ${MAX_NOTICES} things waiting to be read already`);
        this.tell(text);
    }

    /**
     * Tell the agent how one of its requests went: a card the user answered, or one that lapsed (signIn.ts,
     * access.ts, prompts.ts and serverTools.ts). Never held to the backlog, so what the user did always reaches
     * it: these follow the user's own answers, a card at a time, and can't pile up the way routines can.
     * Shutting down, it goes with every other notice.
     */
    tell(text: string) {
        if (this.closed) return;
        this.notices.push(text);
        this.pump();
    }

    /** Add or update a card: a sign-in, access, prompt or tool-server request (signIn.ts, access.ts, prompts.ts and serverTools.ts own them; this only shows them) or a page shown to the user. */
    post(entry: SignInEntry | AccessEntry | PromptEntry | ToolServerEntry | ToolSignInEntry | PageEntry) {
        if (this.closed) return;
        this.put(entry);
    }

    /**
     * Stop the running turn quietly, so the next one reads what the user just said. A compaction isn't stopped
     * (what's sent meanwhile waits for it), and a turn already stopping isn't stopped twice.
     */
    private interrupt() {
        if (!this.running || this.compactingNow || this.switching || this.stopRequested) return;
        this.stopRequested = true;
        // a routine's notice it was on isn't lost: the next turn has it too
        const handedOn = this.turnNotices.splice(0);
        this.notices.unshift(...handedOn);
        this.killTurn().catch((e: Error) => {
            // still running: it has its notices already
            this.notices = this.notices.filter((n) => !handedOn.includes(n));
            this.turnNotices = handedOn;
            this.put({ id: this.newId(), at: Date.now(), kind: "error", title: "Not interrupted", text: `${e.message}. Your message is read once the agent finishes.` });
        });
    }

    /** Start over: stop, forget the conversation and the harness's threads. Asked for explicitly; it can't be undone. */
    async clear() {
        this.notices = [];
        await this.swap(null, () => {
            this.transcript.clear();
            this.threads = {};
            this.setCarry(null);
            fs.rmSync(path.join(this.deps.dir, ATTACHMENTS), { recursive: true, force: true });
            writeFileAtomicSync(path.join(this.deps.dir, THREADS), "{}");
        });
        return { cleared: true };
    }

    /** Put the current conversation in the history and start a new one. An empty one is just left. */
    newConversation() {
        return this.swap(
            () => {
                if (this.entries.length > 0 && this.archive.ids().length >= LIMITS.pastConversations) {
                    throw new Error(`You have ${LIMITS.pastConversations} past conversations; delete some from the history first.`);
                }
            },
            () => {
                if (this.entries.length > 0) this.putAway();
            },
        ).then(() => ({ started: true }));
    }

    /**
     * The current conversation's own id, the one it's put away under; made the first time it's asked for.
     * The UI lists it as CURRENT_CONVERSATION; flows name it by this id, which it keeps when it's reopened.
     */
    id(): string {
        return this.archive.currentId();
    }

    /** The conversation going on now, listed with the history; none while it's empty. Its id is no past one's. */
    current(): PastConversation | null {
        return this.entries.length ? summary(this.entries, CURRENT_CONVERSATION) : null;
    }

    /** The history, newest first. */
    past(): PastConversation[] {
        return this.archive.list();
    }

    /** Make a past conversation the current one, to continue it; the current one goes into the history. */
    async open(id: unknown) {
        await this.swap(
            () => this.archive.find(id),
            () => {
                this.archive.restore(id, () => {
                    if (this.entries.length > 0) this.putAway();
                    // files uploaded and never sent belong to no message: they don't come along
                    else fs.rmSync(path.join(this.deps.dir, ATTACHMENTS), { recursive: true, force: true });
                });
                this.loadCurrent();
            },
        );
        return { opened: true };
    }

    /** Delete a past conversation for good. The current one is never deleted this way. */
    deletePast(id: unknown) {
        this.archive.delete(id);
        return { deleted: true };
    }

    /** A conversation's texts, every one of them, the user's and the agent's, oldest first: the current one, or one in the history. */
    texts(id: string): Said[] {
        return id === this.id() ? said(this.transcript.all()) : this.archive.texts(id);
    }

    /** One text in a conversation, by its id. */
    text(conversation: string, messageId: string): Said {
        const found = this.texts(conversation).find((e) => e.id === messageId);
        if (found) return found;
        throw new Error(`the agent has no message "${messageId}" in that conversation; it may have been cleared`);
    }

    /**
     * The agent's bubble, from its send_message tool: shown at once, mid-turn.
     * Refused (the model sees why) with neither text nor files, or a replyTo that isn't a message in the conversation.
     */
    say(text: string, replyTo: string | null = null, fileIds: string[] = []): { id: string } {
        if (!this.running) throw new Error("there's no conversation going on right now");
        const message = text.trim();
        if (!message && fileIds.length === 0) throw new Error("say something first");
        if (message.length > LIMITS.message) throw new Error(`messages are limited to ${LIMITS.message} characters`);
        if (replyTo !== null) this.checkReplyTarget(replyTo);
        // a file it shows has to be one of the conversation's, or the bubble would show nothing
        for (const m of message.matchAll(/\]\(\s*<?attachment:([^)\s>]*)/g)) this.attachments.get(m[1]);
        const files = this.sentFiles(fileIds);
        // quoting the one message this turn answers says nothing the bubble above doesn't: shown plain, as a text would be
        if (replyTo !== null && this.answering.length === 1 && this.answering[0] === replyTo) replyTo = null;
        const entry: ChatEntry = { id: this.newId(), at: Date.now(), kind: "agent", text: message, ...(replyTo === null ? {} : { replyTo }), ...(files.length ? { attachments: files } : {}) };
        this.unanswered = false;
        this.setTyping(false);
        this.put(entry);
        return { id: entry.id };
    }

    /** A status line from send_status, outside the bubbles: it answers nothing, so a reply is still owed. */
    status(tone: StatusTone, text: string) {
        if (!this.running) throw new Error("there's no conversation going on right now");
        const line = text.trim();
        if (!line) throw new Error("say something first");
        if (line.length > LIMITS.status) throw new Error(`a status is at most ${LIMITS.status} characters; text the rest with send_message`);
        this.put({ id: this.newId(), at: Date.now(), kind: "status", tone, text: line });
    }

    /** A call to one of the panel's tools arrived: it's written, so whatever the agent was typing is done. */
    called(tool: string) {
        this.arrived.set(tool, (this.arrived.get(tool) ?? 0) + 1);
        this.setTyping(false);
    }

    /** The model began a call that isn't written to the user, or one it wrote is done: it's working. */
    working() {
        this.setTyping(false);
    }

    /** The model began a call to one of the panel's tools, or to one of its harness's own (null). */
    private began(tool: string | null) {
        if (tool === null || !this.deps.writes(tool)) return this.setTyping(false);
        const begun = (this.begun.get(tool) ?? 0) + 1;
        this.begun.set(tool, begun);
        this.setTyping(begun > (this.arrived.get(tool) ?? 0));
    }

    private setTyping(on: boolean) {
        const typing = on && this.running !== null;
        if (typing === this.typing) return;
        this.typing = typing;
        this.state();
    }

    async shutdown() {
        this.closed = true;
        this.queue = [];
        this.attachments.closeUploads();
        this.notices = [];
        // a turn still getting ready never starts, and one that runs is waited out: nothing writes after this
        this.stopRequested = true;
        await this.killTurn();
        await this.running;
    }

    // ------------------------------------------------------------- the history

    /**
     * Stop the running turn, then change which conversation is current. Messages waiting for the old one are
     * dropped with it; the service's notices wait for the next turn, in whichever conversation that is. A
     * switch `check` refuses stops, drops and lapses nothing.
     */
    private async swap(check: (() => void) | null, change: () => void) {
        if (this.closed) throw new Error("the conversation is shutting down");
        // quiet: the earlier switch's caller got its failure; this only waits for it to end
        while (this.switching) await this.switching.catch(() => undefined);
        check?.();
        this.deps.onLeave?.();
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

    /** Move the current conversation into the history; what's in memory goes with it. */
    private putAway() {
        this.archive.putAway(this.entries);
        this.transcript.forget();
        this.threads = {};
        this.carry = null;
        this.context = null;
    }

    // ------------------------------------------------------------- turns

    private pump() {
        this.state();
        if (this.running || this.closed || this.switching || (this.queue.length === 0 && this.notices.length === 0)) return;
        // a turn answers the user, or flows with the same instructions, never both: the rest wait for the next
        const first = this.queue[0];
        const other = this.queue.findIndex((m) => (m.fromFlow === true) !== (first?.fromFlow === true) || m.instructions !== first?.instructions);
        const batch = this.queue.splice(0, other < 0 ? this.queue.length : other);
        this.turnFromFlow = first?.fromFlow === true;
        this.turnInstructions = first?.instructions;
        const notices = this.notices.splice(0);
        this.turnNotices = notices;
        this.stopRequested = false; // a stop asked of an earlier turn doesn't silence this one
        this.read(batch);
        const message = [...batch.map((m) => this.forAgent(m)), ...notices.map((n) => `[from Paperboard, not the user] ${n}`)].join("\n\n");
        this.unanswered = batch.length > 0;
        this.plain = [];
        this.answering = batch.map((m) => m.id);
        // nothing is being written yet: the model thinks first
        this.typing = false;
        this.begun.clear();
        this.arrived.clear();
        this.running = this.turn(message)
            .catch((e: Error) => {
                this.put({ id: this.newId(), at: Date.now(), kind: "error", title: "Not answered", text: e.message });
                this.deps.onTurnFailed?.(e.message);
            })
            .then(() => this.compactIfLong())
            .finally(() => {
                this.running = null;
                this.turnNotices = [];
                this.answering = [];
                this.typing = false;
                this.stopRequested = false;
                this.turnFromFlow = false;
                this.turnInstructions = undefined;
                try {
                    this.deps.onTurnEnd?.();
                } catch (e) {
                    // quiet: the turn has ended either way; the next one must still start
                    console.error("[agents] a turn's end couldn't be handled:", errorMessage(e));
                }
                this.pump();
            });
        this.state();
    }

    /** a turn is running now */
    turning(): boolean {
        return this.running !== null;
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
            // a reply left as plain output never reaches the user: the agent is told once, in the same thread, to text it
            const resumed = this.threads[settings.harness];
            if (this.owesReply() && resumed) await this.run(settings, resumed, UNTEXTED);
            if (this.owesReply()) throw new Error("the turn ended without a reply");
        } catch (e) {
            if (carry) this.dropThread(settings.harness);
            throw e;
        }
        if (carry && this.stopRequested) this.dropThread(settings.harness);
        else if (carry) this.setCarry(null);
    }

    /** the turn answers the user's messages, hasn't texted them, and wasn't stopped */
    private owesReply(): boolean {
        return this.unanswered && this.answering.length > 0 && !this.stopRequested;
    }

    private async run(settings: Settings, thread: string | null, message: string) {
        const command = this.deps.resolve(settings.harness);
        if (!command) throw new Error(`${BRAINS[settings.harness].program} isn't installed. Install it in the agent's settings.`);
        const problem = this.deps.problem?.(settings.harness);
        if (problem) throw new Error(problem);
        const mcp = this.deps.mcp();
        const sections = await this.deps.instructions();
        // stopped (or shut down) while it got ready: there is no process to kill yet, so none is started
        if (this.stopRequested) return;
        const env = this.deps.env(settings.harness);
        const launch = turnLaunch({
            harness: settings.harness,
            command,
            model: settings.model,
            name: settings.name,
            thread,
            message,
            mcpUrl: mcp.url,
            sections,
            fromFlow: this.turnFromFlow,
            filesDir: runFilesDir(settings.harness, env, this.runDir()),
            home: this.deps.home(settings.harness),
        });
        if (launch.thread) this.saveThread(settings.harness, launch.thread);
        const log = this.deps.log ?? null;
        if (!log) return this.launched(settings, launch, mcp, message);
        log.begin({
            harness: settings.harness,
            model: settings.model,
            name: settings.name,
            fromFlow: this.turnFromFlow,
            thread,
            message,
            instructions: instructions(settings.name, sections, { harness: settings.harness, model: settings.model, fromFlow: this.turnFromFlow }),
            command: launch.command,
            args: launch.args,
        });
        try {
            await this.launched(settings, launch, mcp, message);
            log.end({ outcome: this.stopRequested ? "stopped" : "done", context: { used: this.context?.used ?? null, size: this.context?.size ?? null } });
        } catch (e) {
            log.end({ outcome: "failed", error: errorMessage(e), context: { used: this.context?.used ?? null, size: this.context?.size ?? null } });
            throw e;
        }
    }

    /** A turn whose harness is ready to start, run until it's over. */
    private async launched(settings: Settings, launch: TurnLaunch, mcp: ReturnType<ConversationDeps["mcp"]>, message: string) {
        const log = this.deps.log ?? null;
        const plain = this.plain;
        const context: Context = { harness: settings.harness, used: null, size: null };
        this.context = context;
        // OpenCode connects to the panel's tools in the background: its prompt waits until it has listed them
        const timers: ReturnType<typeof setTimeout>[] = [];
        let listed!: () => void;
        const tools = new Promise<void>((ok) => (listed = ok));
        const offListed = mcp.onToolsListed(() => listed());
        const ready = () =>
            new Promise<void>((ok, fail) => {
                timers.push(setTimeout(() => fail(new Error("OpenCode didn't connect to the panel's tools")), TOOLS_MS));
                void tools.then(() => timers.push(setTimeout(ok, TOOLS_SETTLE_MS)));
            });
        const turnMs = this.deps.turnMs ?? TURN_MS;
        const cwd = this.workdir();
        const acp =
            settings.harness === "opencode"
                ? { who: BRAINS.opencode.program, cwd, thread: launch.thread, model: settings.model, message, ready }
                : settings.harness === "antigravity"
                  ? {
                        who: BRAINS.antigravity.program,
                        cwd,
                        thread: launch.thread,
                        model: settings.model,
                        message,
                        mcpServers: [{ type: "http" as const, name: MCP_SERVER, url: mcp.url, headers: [{ name: "Authorization", value: `Bearer ${mcp.token}` }] }],
                        sessionParams: launch.acpSession,
                        ready: async () => {},
                    }
                  : null;
        const r = await runHarness({
            host: this.deps.host,
            id: TURN_PROC_ID,
            harness: settings.harness,
            launch,
            cwd,
            env: { ...this.deps.env(settings.harness), ...(launch.tokenEnv ? { [launch.tokenEnv]: mcp.token } : {}) },
            ms: turnMs,
            acp,
            onEvent: (ev) => {
                if (ev.type === "thread") this.saveThread(settings.harness, ev.id);
                else if (ev.type === "context") {
                    if (ev.used !== undefined) context.used = ev.used;
                    if (ev.size !== undefined) context.size = ev.size;
                } else if (ev.type === "message") plain.push(ev.text);
                else if (ev.type === "tool") this.began(ev.name);
                else if (ev.type === "working") this.working();
            },
            stop: () => this.killTurn(),
            unstopped: (e) => this.put({ id: this.newId(), at: Date.now(), kind: "error", title: "Not stopped", text: `The turn ran past ${minutes(turnMs)} and couldn't be stopped: ${errorMessage(e)}` }),
            line: log ? (stream, text) => log.line(stream, text) : undefined,
        }).finally(() => {
            offListed();
            for (const t of timers) clearTimeout(t);
        });
        // Codex says how long its thread is only in its rollout
        let unmeasured: string | null = null;
        const codexThread = this.threads.codex;
        if (settings.harness === "codex" && this.deps.codexHome && codexThread) {
            try {
                Object.assign(context, codexContext(this.deps.codexHome, codexThread));
            } catch (e) {
                unmeasured = errorMessage(e);
            }
        }
        if (this.stopRequested) return;
        if (r.timedOut) throw new Error(`the turn ran past ${minutes(turnMs)}, so it was stopped`);
        const failed = harnessFailure(r, settings.harness, "the turn", "message");
        if (failed) throw new Error(failed);
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
        this.turnFromFlow = false;
        this.turnInstructions = undefined;
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
                title: "Conversation not compacted",
                text: `Couldn't summarize the conversation to save space: ${errorMessage(e)}. It tries again after the next reply; if this keeps happening, set Compaction to Forget in settings.`,
            });
        } finally {
            this.compactingNow = false;
            this.context = null;
        }
    }

    /** The agent's summary of the conversation, written in its own thread (so it knows everything the thread does). */
    private async summarize(): Promise<string> {
        this.plain = [];
        this.unanswered = false;
        await this.turn(SUMMARIZE);
        const summary = this.plain.join("\n\n").trim();
        if (!summary && !this.stopRequested) throw new Error("it wrote nothing");
        return summary;
    }

    /** Drop every harness thread; the next turn starts a fresh one from the summary (if any) and the latest messages. */
    private compact(summary: string | null) {
        const texts = said(this.entries);
        this.setCarry({ summary, from: texts[Math.max(0, texts.length - CARRY_MESSAGES)]?.id ?? null });
        this.threads = {};
        writeFileAtomicSync(path.join(this.deps.dir, THREADS), "{}");
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
        if (carry) writeFileAtomicSync(file, JSON.stringify(carry));
        else fs.rmSync(file, { force: true });
    }

    private dropThread(harness: Harness) {
        const { [harness]: _, ...rest } = this.threads;
        this.threads = rest;
        writeFileAtomicSync(path.join(this.deps.dir, THREADS), JSON.stringify(this.threads));
    }

    private killTurn() {
        return stopProcess(TURN_PROC_ID, { host: this.deps.host });
    }

    /** An empty folder: no project files and no AGENTS.md or CLAUDE.md for the harness to pick up. */
    private workdir() {
        const dir = path.join(this.deps.dir, "workspace");
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    /** Where a turn's instructions file goes (but Codex's, which go in its home): only the turn reads it, while it runs. */
    private runDir() {
        return path.join(this.deps.dir, RUN);
    }

    private saveThread(harness: Harness, id: string) {
        if (this.threads[harness] === id) return;
        this.threads = { ...this.threads, [harness]: id };
        writeFileAtomicSync(path.join(this.deps.dir, THREADS), JSON.stringify(this.threads));
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

    /** Short enough for the model to carry in a reply_to; unique among the transcript's ids and the messages waiting. */
    private newId(): string {
        for (;;) {
            const id = randomUUID().replace(/-/g, "").slice(0, SHORT_ID);
            if (!this.transcript.has(id) && !this.queue.some((m) => m.id === id)) return id;
        }
    }

    private state() {
        // busy only while answering the user: a routine that finds nothing to say shows nothing
        this.deps.onState({
            busy: this.running !== null && this.answering.length > 0,
            typing: this.running !== null && this.typing,
            waiting: this.queue.map((m) => ({ ...m })),
            compacting: this.compactingNow,
        });
    }

    private put(entry: ChatEntry) {
        this.transcript.put(entry);
        this.deps.emit(entry);
    }
}

function minutes(ms: number) {
    const [n, unit] = ms >= 60_000 ? [Math.round(ms / 60_000), "minute"] : [Math.ceil(ms / 1000), "second"];
    return `${n} ${unit}${n === 1 ? "" : "s"}`;
}
