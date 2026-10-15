// Claude Code, run through its own headless mode (core/claudeCode.ts reads
// and writes its messages). A Claude Code process holds one session, so a
// chat gets its own process in one of a few fixed slots of the daemon's
// process ledger; a slot's process stops after it sits idle, its session
// stays on disk, and the chat's next message resumes it.

import { randomUUID } from "node:crypto";
import type { AcpContentBlock } from "../core/acp";
import {
    CLAUDE_MODES,
    claudeArgs,
    claudeInitFrom,
    claudePermissionAnswer,
    claudePermissionOptions,
    claudeStopReason,
    claudeToolCall,
    ClaudeTranslator,
    claudeUserMessage,
    isClaudeMode,
    type ClaudeInit,
} from "../core/claudeCode";
import type { Connection } from "../core/providers";
import type { AgentModel, AgentSessionInfo, AgentState } from "../core/types";
import type { AgentHubDeps, AgentRunner, OpenedSession, SessionRequest, StopReason, TurnHandlers } from "./agents";
import type { Launch } from "./executable";
import { LineBuffer, LineWriter } from "./jsonRpc";
import { killObserved, StderrTail, watchExit, type ExitWatch } from "./processWatch";

/** Claude Code processes one connection runs at once (each is a whole Claude Code). */
export const MAX_CLAUDE_PROCESSES = 4;
const IDLE_MS = 10 * 60_000;
const INIT_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;
const CANCEL_GRACE_MS = 10_000;
const CAPABILITIES = { image: true, embeddedContext: true };
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A resumed session Claude Code no longer has on disk. */
class SessionGone extends Error {}

interface Turn {
    handlers: TurnHandlers;
    translator: ClaudeTranslator;
    interrupted: boolean;
    resolve: (reason: StopReason) => void;
    reject: (err: Error) => void;
}

/** One Claude Code process in one slot: one session, at most one turn. */
class ClaudeProcess {
    private lines = new LineBuffer();
    private writer: LineWriter;
    private stderr = new StderrTail();
    private control = new Map<string, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
    private nextRequest = 1;
    private offs: (() => void)[] = [];
    private exited: Promise<number | undefined> | null = null;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private stopping = false;
    private alive = false;
    /** initialize answered: the process can take a turn */
    ready = false;
    turn: Turn | null = null;
    lastUsed = Date.now();
    /** the model this process was switched to (it starts on Claude Code's default) */
    model: string | null = null;

    constructor(
        private readonly owner: ClaudeCodeAgent,
        readonly procId: string,
        readonly sessionId: string | null,
        readonly conversationId: string | null,
        readonly cwd: string,
    ) {
        this.writer = new LineWriter((chunk) => owner.deps.host.write(procId, chunk));
    }

    get running(): boolean {
        return this.alive;
    }

    private get label(): string {
        return this.owner.connection.label;
    }

    /** Starts the process and runs initialize; a failed start leaves nothing running. */
    async start(launch: Launch, args: string[]): Promise<ClaudeInit> {
        const { host } = this.owner.deps;
        // a process left by an earlier service run has lost its turn
        if (await host.exists(this.procId)) await this.kill(watchExit(host, this.procId));
        const watch = watchExit(host, this.procId);
        this.exited = watch.exited;
        this.offs = [
            watch.off,
            host.onStdout(this.procId, (data) => this.receive(data)),
            host.onStderr(this.procId, (data) => this.stderr.push(data)),
        ];
        let failedEarly: (err: Error) => void = () => {};
        const early = new Promise<never>((_, reject) => (failedEarly = reject));
        early.catch(() => undefined);
        watch.exited.then((code) => {
            failedEarly(this.exitError(code));
            this.onExit(code);
        });
        const timeoutMs = this.owner.deps.initTimeoutMs ?? INIT_TIMEOUT_MS;
        let timer: ReturnType<typeof setTimeout> | undefined;
        this.alive = true;
        try {
            await host.start({ id: this.procId, command: launch.command, args: [...launch.args, ...args], cwd: this.cwd, env: { PATH: launch.pathEnv } });
        } catch (err) {
            // nothing ran, so there is no exit to wait for
            this.alive = false;
            for (const off of this.offs.splice(0)) off();
            throw err;
        }
        try {
            const response = await Promise.race([
                this.request("initialize"),
                early,
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`${this.label} did not answer within ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs);
                }),
            ]);
            this.ready = true;
            this.scheduleIdle();
            return claudeInitFrom(response);
        } catch (err) {
            await this.stop().catch((stopErr) => console.error("[ai] stopping a Claude Code that failed to start:", String(stopErr)));
            throw err instanceof Error ? err : new Error(String(err));
        } finally {
            clearTimeout(timer);
        }
    }

    private exitError(code: number | undefined): Error {
        const said = this.stderr.text();
        if (/No conversation found/i.test(said)) return new SessionGone(said);
        return new Error(`${this.label} stopped${code !== undefined ? ` (exit code ${code})` : ""}${said ? `: ${said.split("\n").pop()}` : "."}`);
    }

    /** Sends a control request and resolves its answer. */
    request(subtype: string, fields: Json = {}): Promise<Json> {
        if (!this.alive) return Promise.reject(new Error(`${this.label} is not running.`));
        const requestId = `pb-${this.nextRequest++}`;
        const answer = new Promise<Json>((resolve, reject) => this.control.set(requestId, { resolve, reject }));
        this.writer.send({ type: "control_request", request_id: requestId, request: { subtype, ...fields } }).catch((err) => {
            this.settle(requestId, undefined, new Error(`${this.label} could not be reached: ${String(err)}`));
        });
        return answer;
    }

    private settle(requestId: string, value: Json | undefined, error?: Error): void {
        const pending = this.control.get(requestId);
        if (!pending) return;
        this.control.delete(requestId);
        if (error) pending.reject(error);
        else pending.resolve(value ?? {});
    }

    private receive(chunk: string): void {
        let lines: string[] = [];
        try {
            lines = this.lines.push(chunk);
        } catch (err) {
            // an oversized line breaks the process; nothing after it is read
            this.broken(err instanceof Error ? err.message : String(err));
        }
        for (const line of lines) {
            if (!line.trim()) continue;
            let message: unknown;
            try {
                message = JSON.parse(line);
            } catch {
                this.broken(`not JSON: ${line.slice(0, 200)}`);
                return;
            }
            if (isObject(message)) this.onMessage(message);
        }
    }

    private broken(reason: string): void {
        console.error(`[ai] ${this.label} broke the protocol:`, reason);
        this.owner.publish({ status: "error", error: `${this.label} sent a message the panel could not read: ${reason}` });
        void this.stop().catch((err) => console.error("[ai] stopping a broken Claude Code failed:", String(err)));
    }

    private onMessage(message: Json): void {
        if (message.type === "control_response" && isObject(message.response)) {
            const r = message.response;
            if (typeof r.request_id !== "string") return;
            if (r.subtype === "success") this.settle(r.request_id, isObject(r.response) ? r.response : {});
            else this.settle(r.request_id, undefined, new Error(typeof r.error === "string" ? r.error : `${this.label} refused the request.`));
            return;
        }
        if (message.type === "control_request" && typeof message.request_id === "string" && isObject(message.request)) {
            void this.answer(message.request_id, message.request);
            return;
        }
        if (message.type === "system" && message.subtype === "status" && isClaudeMode(message.permissionMode) && this.conversationId) {
            this.owner.patchInfo(this.conversationId, { mode: message.permissionMode });
            return;
        }
        const turn = this.turn;
        if (!turn) return;
        if (message.type === "result") {
            try {
                turn.resolve(claudeStopReason(message, turn.interrupted));
            } catch (err) {
                turn.reject(err instanceof Error ? err : new Error(String(err)));
            }
            return;
        }
        for (const update of turn.translator.updates(message)) turn.handlers.onUpdate(update);
    }

    /** Claude Code's own requests: only permission prompts are offered. */
    private async answer(requestId: string, request: Json): Promise<void> {
        let response: Json;
        if (request.subtype === "can_use_tool" && typeof request.tool_name === "string") {
            const toolCallId = typeof request.tool_use_id === "string" ? request.tool_use_id : `permission-${requestId}`;
            const input = isObject(request.input) ? request.input : {};
            const turn = this.turn;
            // nobody is there to answer outside a turn
            const chosen = turn ? await turn.handlers.requestPermission(claudeToolCall(toolCallId, request.tool_name, input), claudePermissionOptions(request.permission_suggestions)) : null;
            response = { subtype: "success", request_id: requestId, response: claudePermissionAnswer(chosen, request) };
        } else {
            response = { subtype: "error", request_id: requestId, error: `${String(request.subtype)} is not supported by Paperboard.` };
        }
        if (!this.alive) return;
        await this.writer.send({ type: "control_response", response }).catch((err) => {
            console.error(`[ai] answering ${this.label} failed:`, String(err));
            this.turn?.reject(new Error(`${this.label} could not be reached: ${String(err)}`));
        });
    }

    /** Runs one turn; resolves with its stop reason. */
    async prompt(blocks: AcpContentBlock[], handlers: TurnHandlers, signal: AbortSignal): Promise<StopReason> {
        if (!this.alive || !this.sessionId) throw new Error(`${this.label} is not running.`);
        if (this.turn) throw new Error("This chat is already waiting on the agent.");
        this.clearIdle();
        this.lastUsed = Date.now();
        let grace: ReturnType<typeof setTimeout> | undefined;
        const done = new Promise<StopReason>((resolve, reject) => {
            this.turn = { handlers, translator: new ClaudeTranslator(), interrupted: false, resolve, reject };
        });
        const turn = this.turn!;
        const onAbort = () => {
            turn.interrupted = true;
            this.request("interrupt").catch((err) => console.warn("[ai] interrupt did not reach Claude Code:", String(err)));
            // a Claude Code that ignores the interrupt is stopped rather than waited on forever
            grace = setTimeout(() => {
                void this.stop().catch((err) => console.error("[ai] stopping an unresponsive Claude Code failed:", String(err)));
            }, this.owner.deps.cancelGraceMs ?? CANCEL_GRACE_MS);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        try {
            await this.writer.send(claudeUserMessage(this.sessionId, blocks));
            if (signal.aborted) onAbort();
            return await done;
        } finally {
            clearTimeout(grace);
            signal.removeEventListener("abort", onAbort);
            this.turn = null;
            this.lastUsed = Date.now();
            this.scheduleIdle();
        }
    }

    private clearIdle(): void {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = null;
    }

    private scheduleIdle(): void {
        this.clearIdle();
        if (this.turn || !this.alive) return;
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (!this.turn) void this.stop().catch((err) => console.error("[ai] stopping an idle Claude Code failed:", String(err)));
        }, this.owner.deps.idleMs ?? IDLE_MS);
    }

    private onExit(code: number | undefined): void {
        const expected = this.stopping;
        this.alive = false;
        this.clearIdle();
        for (const off of this.offs.splice(0)) off();
        const reason = expected ? new Error(`${this.label} was stopped.`) : this.exitError(code);
        for (const requestId of [...this.control.keys()]) this.settle(requestId, undefined, reason);
        this.turn?.reject(this.turn.interrupted ? new Error(`${this.label} was stopped.`) : reason);
        this.owner.exited(this, expected ? null : { error: reason.message, ...this.stderr.detail() });
    }

    /** Stops the process and waits until its exit is observed. */
    async stop(): Promise<void> {
        this.clearIdle();
        if (!this.alive || !this.exited) return;
        this.stopping = true;
        await this.kill({ exited: this.exited, off: () => {} });
    }

    private kill(watch: ExitWatch): Promise<void> {
        return killObserved(this.owner.deps.host, this.procId, watch, this.owner.deps.stopTimeoutMs ?? STOP_TIMEOUT_MS, this.label);
    }
}

/** A Claude Code connection: up to MAX_CLAUDE_PROCESSES chats live at once. */
export class ClaudeCodeAgent implements AgentRunner {
    private slots: (ClaudeProcess | null)[] = Array.from({ length: MAX_CLAUDE_PROCESSES }, () => null);
    /** slots promised to a start that has not put its process there yet */
    private reserved = new Set<number>();
    private opening = new Map<string, Promise<OpenedSession>>();
    private infos = new Map<string, AgentSessionInfo>();
    private state: AgentState = { status: "stopped" };
    private modelList: AgentModel[] | null = null;
    private listing: Promise<AgentModel[]> | null = null;

    constructor(
        readonly deps: AgentHubDeps,
        readonly connection: Connection,
    ) {}

    get busy(): boolean {
        return this.opening.size > 0 || this.reserved.size > 0 || this.slots.some((p) => p?.running);
    }

    hasTurns(): boolean {
        return this.slots.some((p) => p?.turn);
    }

    publish(patch: Partial<AgentState>): void {
        this.state = { ...this.state, ...patch };
        this.deps.onState(this.connection.id, this.state);
    }

    patchInfo(conversationId: string, patch: Partial<AgentSessionInfo>): void {
        const next = { ...(this.infos.get(conversationId) ?? { modes: [], commands: [] }), ...patch };
        this.infos.set(conversationId, next);
        this.deps.onSessionInfo(conversationId, next);
    }

    private slotId(slot: number): string {
        return `${this.deps.procId(this.connection.id)}.${slot}`;
    }

    private live(conversationId: string): ClaudeProcess | undefined {
        return this.slots.find((p): p is ClaudeProcess => p !== null && p.running && p.conversationId === conversationId);
    }

    /**
     * A free slot, or the one whose process sat idle longest (stopped
     * first). The slot is reserved before anything is awaited, so two
     * starts never share one; the caller releases it.
     */
    private async claimSlot(): Promise<number> {
        const free = this.slots.findIndex((p, slot) => p === null && !this.reserved.has(slot));
        if (free !== -1) {
            this.reserved.add(free);
            return free;
        }
        const idle = this.slots
            .map((p, slot) => ({ p, slot }))
            .filter((e): e is { p: ClaudeProcess; slot: number } => e.p !== null && e.p.ready && !e.p.turn && !this.reserved.has(e.slot))
            .sort((a, b) => a.p.lastUsed - b.p.lastUsed)[0];
        if (!idle) throw new Error(`${this.connection.label} is already busy in ${MAX_CLAUDE_PROCESSES} chats. Wait for one to finish.`);
        this.reserved.add(idle.slot);
        try {
            await idle.p.stop();
        } catch (err) {
            this.reserved.delete(idle.slot);
            throw err;
        }
        if (this.slots[idle.slot] === idle.p) this.slots[idle.slot] = null;
        return idle.slot;
    }

    private async launch(): Promise<Launch> {
        try {
            return await this.deps.resolve(this.connection);
        } catch (err) {
            this.publish({ status: "error", error: err instanceof Error ? err.message : String(err) });
            throw err;
        }
    }

    /** Starts a process in a claimed slot. */
    private async startIn(launch: Launch, session: { id: string; resume: boolean } | null, conversationId: string | null, cwd: string, mode?: string): Promise<{ process: ClaudeProcess; init: ClaudeInit }> {
        const slot = await this.claimSlot();
        const process = new ClaudeProcess(this, this.slotId(slot), session?.id ?? null, conversationId, cwd);
        this.slots[slot] = process;
        this.reserved.delete(slot);
        try {
            const init = await process.start(launch, claudeArgs(session, mode));
            this.learnModels(init.models);
            this.publish({ status: "ready", name: "Claude Code", error: undefined, errorDetail: undefined, ...(init.version ? { version: init.version } : {}) });
            return { process, init };
        } catch (err) {
            if (this.slots[slot] === process) this.slots[slot] = null;
            throw err;
        }
    }

    /** A process ended; its slot frees, and a crash is shown. */
    exited(process: ClaudeProcess, failure: { error: string; errorDetail?: string } | null): void {
        const slot = this.slots.indexOf(process);
        if (slot !== -1) this.slots[slot] = null;
        if (process.conversationId) {
            this.infos.delete(process.conversationId);
            this.deps.onSessionInfo(process.conversationId, null);
        }
        if (failure) this.publish({ status: "error", ...failure });
        else if (!this.slots.some((p) => p?.running)) this.publish({ status: "stopped", error: undefined, errorDetail: undefined });
    }

    private learnModels(models: AgentModel[]): void {
        if (this.modelList && JSON.stringify(this.modelList) === JSON.stringify(models)) return;
        this.modelList = models;
        this.deps.onModels?.(this.connection.id, models);
    }

    /** Switches a process to the chat's model, when Claude Code offers that model. */
    private async applyModel(process: ClaudeProcess, model: string | undefined): Promise<void> {
        if (!model || process.model === model || !this.modelList?.some((m) => m.id === model)) return;
        await process.request("set_model", { model });
        process.model = model;
    }

    /** The models Claude Code offers; the first ask starts it once without a session. */
    models(): Promise<AgentModel[]> {
        if (this.modelList) return Promise.resolve(this.modelList);
        this.listing ??= this.check()
            .then(() => this.modelList ?? [])
            .finally(() => {
                this.listing = null;
            });
        return this.listing;
    }

    async check(): Promise<void> {
        if (this.modelList && this.slots.some((p) => p?.running)) return;
        this.publish({ status: "starting", error: undefined, errorDetail: undefined });
        const { process } = await this.startIn(await this.launch(), null, null, this.deps.workDir);
        await process.stop();
    }

    openSession(request: SessionRequest): Promise<OpenedSession> {
        const opening = this.opening.get(request.conversationId);
        if (opening) return opening;
        const next = this.open(request).finally(() => this.opening.delete(request.conversationId));
        this.opening.set(request.conversationId, next);
        return next;
    }

    private async open(request: SessionRequest): Promise<OpenedSession> {
        const live = this.live(request.conversationId);
        if (live && live.cwd === request.cwd) {
            await this.applyModel(live, request.model);
            return { sessionId: live.sessionId!, resumed: true, capabilities: CAPABILITIES };
        }
        if (live) await live.stop();
        if (!this.slots.some((p) => p?.running)) this.publish({ status: "starting", error: undefined, errorDetail: undefined });
        const launch = await this.launch();
        const mode = isClaudeMode(request.mode) ? request.mode : undefined;
        let started: { process: ClaudeProcess; init: ClaudeInit } | undefined;
        let resumed = false;
        if (request.sessionId && SESSION_ID.test(request.sessionId)) {
            try {
                started = await this.startIn(launch, { id: request.sessionId, resume: true }, request.conversationId, request.cwd, mode);
                resumed = true;
            } catch (err) {
                if (!(err instanceof SessionGone)) throw err;
                console.warn(`[ai] ${this.connection.label} no longer has this chat's session; starting a new one.`);
            }
        }
        started ??= await this.startIn(launch, { id: randomUUID(), resume: false }, request.conversationId, request.cwd, mode);
        this.patchInfo(request.conversationId, { modes: [...CLAUDE_MODES], mode: started.init.mode ?? mode ?? "default", commands: started.init.commands });
        await this.applyModel(started.process, request.model);
        return { sessionId: started.process.sessionId!, resumed, capabilities: CAPABILITIES };
    }

    prompt(sessionId: string, blocks: AcpContentBlock[], handlers: TurnHandlers, signal: AbortSignal): Promise<StopReason> {
        const process = this.slots.find((p) => p?.running && p.sessionId === sessionId);
        if (!process) return Promise.reject(new Error(`${this.connection.label} is not running.`));
        return process.prompt(blocks, handlers, signal);
    }

    async setMode(conversationId: string, modeId: string): Promise<void> {
        const process = this.live(conversationId);
        if (!process) throw new Error(`${this.connection.label} has no session for this chat yet. Send a message first.`);
        if (!isClaudeMode(modeId)) throw new Error(`${this.connection.label} has no mode "${modeId}".`);
        await process.request("set_permission_mode", { mode: modeId });
        this.patchInfo(conversationId, { mode: modeId });
    }

    async authenticate(): Promise<void> {
        throw new Error(`Sign in to ${this.connection.label} by running "claude" in a terminal.`);
    }

    /** The chat's session is dropped: its process stops (the session stays on disk). */
    forget(conversationId: string): void {
        const process = this.live(conversationId);
        this.infos.delete(conversationId);
        this.deps.onSessionInfo(conversationId, null);
        if (process) void process.stop().catch((err) => console.error("[ai] stopping a forgotten Claude Code session failed:", String(err)));
    }

    async stop(): Promise<void> {
        await Promise.all(this.slots.map((p) => p?.stop()));
    }

    /** Processes an earlier service run left in this connection's slots, stopped. */
    async stopLeftover(): Promise<void> {
        const { host } = this.deps;
        const timeoutMs = this.deps.stopTimeoutMs ?? STOP_TIMEOUT_MS;
        await Promise.all(
            this.slots.map(async (p, slot) => {
                const id = this.slotId(slot);
                if (p || !(await host.exists(id))) return;
                await killObserved(host, id, watchExit(host, id), timeoutMs, this.connection.label);
            }),
        );
    }
}
