// Codex, run through its app server (core/codex.ts reads and writes its
// messages). One `codex app-server` process per connection holds every
// chat's thread: it starts with the first message, stops after it sits
// idle, and every stop is observed through the exit event. A thread stays
// on disk, so a chat's next message after a stop resumes it.

import path from "node:path";
import type { AcpContentBlock } from "../core/acp";
import {
    CODEX_ARGS,
    CODEX_MODES,
    CODEX_QUIET_NOTIFICATIONS,
    codexApprovalToolCall,
    codexAuthFailure,
    codexDecision,
    codexInput,
    codexModelsFrom,
    codexPermissionOptions,
    codexPolicy,
    codexSignedOut,
    codexStopReason,
    CodexTranslator,
    codexVersion,
    changedPaths,
    isCodexMode,
    MAX_TRACKED_ITEMS,
} from "../core/codex";
import { MAX_AGENT_MODELS } from "../core/acp";
import type { Connection } from "../core/providers";
import type { AgentModel, AgentSessionInfo, AgentState } from "../core/types";
import type { AgentHubDeps, AgentRunner, OpenedSession, SessionRequest, StopReason, TurnHandlers } from "./agents";
import type { Launch } from "./executable";
import { JsonRpcError, JsonRpcPeer, METHOD_NOT_FOUND } from "./jsonRpc";
import { killObserved, StderrTail, watchExit, type ExitWatch } from "./processWatch";

/** threads one Codex keeps open for chats; the one idle longest is let go */
export const MAX_CODEX_THREADS = 32;
/** model/list pages read at most */
const MAX_MODEL_PAGES = 10;
const IDLE_MS = 10 * 60_000;
const INIT_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;
const CANCEL_GRACE_MS = 10_000;
const CAPABILITIES = { image: true, embeddedContext: true };
const APPROVALS = new Set(["item/commandExecution/requestApproval", "item/fileChange/requestApproval"]);

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function errorOf(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err));
}

/** A chat's thread in this Codex. */
interface Thread {
    threadId: string;
    cwd: string;
    mode: string;
    /** the chat's model, when Codex offers it; sent with every turn */
    model?: string;
    /** the mode changed since the thread's last turn */
    modeChanged: boolean;
    /** the chat's effort level; sent with every turn */
    effort?: string;
}

interface Turn {
    threadId: string;
    turnId: string | null;
    handlers: TurnHandlers;
    translator: CodexTranslator;
    /** tool calls this turn announced, shown again when Codex asks about them */
    calls: Map<string, Json>;
    /** file change item id → every path it touches (a move's both ends) */
    changes: Map<string, string[]>;
    /** the last error Codex reported without retrying */
    lastError?: Json;
    interrupted: boolean;
    resolve: (reason: StopReason) => void;
    reject: (err: Error) => void;
}

/** A Codex connection: one app server, a thread per chat. */
export class CodexAgent implements AgentRunner {
    private peer: JsonRpcPeer | null = null;
    private starting: Promise<void> | null = null;
    private exited: Promise<number | undefined> | null = null;
    private offs: (() => void)[] = [];
    private stopping = false;
    private stderr = new StderrTail();
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    /** conversation id → its thread, oldest first */
    private threads = new Map<string, Thread>();
    /** thread id → its running turn */
    private turns = new Map<string, Turn>();
    private infos = new Map<string, AgentSessionInfo>();
    private opening = new Map<string, Promise<OpenedSession>>();
    private signedIn = false;
    private modelList: AgentModel[] | null = null;
    private listing: Promise<AgentModel[]> | null = null;
    private state: AgentState = { status: "stopped" };

    constructor(
        readonly deps: AgentHubDeps,
        readonly connection: Connection,
    ) {}

    private get label(): string {
        return this.connection.label;
    }

    private get procId(): string {
        return this.deps.procId(this.connection.id);
    }

    get running(): boolean {
        return this.peer !== null && !this.peer.closed;
    }

    get busy(): boolean {
        return this.running || this.starting !== null || this.turns.size > 0 || this.opening.size > 0;
    }

    hasTurns(): boolean {
        return this.turns.size > 0;
    }

    private publish(patch: Partial<AgentState>): void {
        this.state = { ...this.state, ...patch };
        this.deps.onState(this.connection.id, this.state);
    }

    private patchInfo(conversationId: string, patch: Partial<AgentSessionInfo>): void {
        const next = { ...(this.infos.get(conversationId) ?? { modes: [], commands: [] }), ...patch };
        this.infos.set(conversationId, next);
        this.deps.onSessionInfo(conversationId, next);
    }

    /** Starts the app server and runs initialize, once; concurrent callers share it. */
    private ensureStarted(): Promise<void> {
        if (this.starting) return this.starting;
        if (this.running) return Promise.resolve();
        this.starting ??= this.start().finally(() => {
            this.starting = null;
        });
        return this.starting;
    }

    private async start(): Promise<void> {
        const { host } = this.deps;
        this.clearIdle();
        this.publish({ status: "starting", error: undefined, errorDetail: undefined });
        let launch: Launch;
        try {
            launch = await this.deps.resolve(this.connection);
        } catch (err) {
            this.publish({ status: "error", error: errorOf(err).message });
            throw err;
        }
        // a process left by an earlier service run has lost its threads' turns
        if (await host.exists(this.procId)) await this.kill(watchExit(host, this.procId));

        this.stopping = false;
        this.signedIn = false;
        this.stderr.clear();
        const procId = this.procId;
        const peer = new JsonRpcPeer((chunk) => host.write(procId, chunk), {
            onRequest: (method, params) => this.onRequest(method, params),
            onNotification: (method, params) => this.onNotification(method, params),
            onProtocolError: (err) => {
                console.error(`[ai] ${this.label} broke the protocol:`, err.message);
                this.publish({ status: "error", error: `${this.label} sent a message the panel could not read: ${err.message}` });
                void this.stop().catch((stopErr) => console.error("[ai] stopping a broken Codex failed:", String(stopErr)));
            },
        });
        this.peer = peer;
        const watch = watchExit(host, procId);
        this.exited = watch.exited;
        this.offs = [watch.off, host.onStdout(procId, (data) => peer.receive(data)), host.onStderr(procId, (data) => this.stderr.push(data))];
        watch.exited.then((code) => this.onExit(peer, code));

        const timeoutMs = this.deps.initTimeoutMs ?? INIT_TIMEOUT_MS;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await host.start({ id: procId, command: launch.command, args: [...launch.args, ...CODEX_ARGS], cwd: this.deps.workDir, env: { PATH: launch.pathEnv } });
            const result = await Promise.race([
                peer.request("initialize", {
                    clientInfo: { name: "paperboard", title: "Paperboard", version: this.deps.clientVersion },
                    capabilities: { experimentalApi: false, requestAttestation: false, optOutNotificationMethods: [...CODEX_QUIET_NOTIFICATIONS] },
                }),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`${this.label} did not answer within ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs);
                }),
            ]);
            await peer.notify("initialized", {});
            const version = codexVersion(result);
            this.publish({ status: "ready", name: "Codex", ...(version ? { version } : {}) });
        } catch (err) {
            const message = errorOf(err).message;
            await this.stop().catch((stopErr) => console.error("[ai] stopping a Codex that failed to start:", String(stopErr)));
            this.publish({ status: "error", error: message, ...this.stderr.detail() });
            throw new Error(message);
        } finally {
            clearTimeout(timer);
        }
    }

    private signInError(): Error {
        const message = `${this.label} is not signed in. Run "codex login" in a terminal, then try again.`;
        this.signedIn = false;
        this.publish({ status: "auth-required", error: message });
        return new Error(message);
    }

    /** Refuses to go on when nobody is signed in to Codex. */
    private async ensureSignedIn(): Promise<void> {
        if (this.signedIn) return;
        const account = await this.peer!.request("account/read", {});
        if (codexSignedOut(account)) throw this.signInError();
        this.signedIn = true;
        if (this.state.status === "auth-required") this.publish({ status: "ready", error: undefined });
    }

    private onExit(peer: JsonRpcPeer, code: number | undefined): void {
        if (this.peer !== peer) return;
        const expected = this.stopping;
        const said = this.stderr.text();
        const reason = new Error(
            expected
                ? `${this.label} was stopped.`
                : `${this.label} stopped${code !== undefined ? ` (exit code ${code})` : ""}${said ? `: ${said.split("\n").pop()}` : "."}`,
        );
        peer.close(reason);
        this.peer = null;
        this.signedIn = false;
        for (const off of this.offs.splice(0)) off();
        this.clearIdle();
        for (const turn of this.turns.values()) turn.reject(turn.interrupted ? new Error(`${this.label} was stopped.`) : reason);
        for (const conversationId of this.threads.keys()) this.deps.onSessionInfo(conversationId, null);
        this.threads.clear();
        this.infos.clear();
        if (expected) this.publish({ status: "stopped", error: undefined, errorDetail: undefined });
        else this.publish({ status: "error", error: reason.message, ...this.stderr.detail() });
    }

    private threadOf(threadId: string): Thread | undefined {
        for (const t of this.threads.values()) if (t.threadId === threadId) return t;
        return undefined;
    }

    /** Codex's own requests: only approvals are offered. */
    private async onRequest(method: string, params: unknown): Promise<unknown> {
        if (!APPROVALS.has(method) || !isObject(params)) throw new JsonRpcError(METHOD_NOT_FOUND, `${method} is not supported by Paperboard.`);
        const threadId = typeof params.threadId === "string" ? params.threadId : "";
        const turn = this.turns.get(threadId);
        // nobody is there to answer outside a turn
        if (!turn) return codexDecision(null, params);
        const itemId = typeof params.itemId === "string" ? params.itemId : "";
        const call = turn.calls.get(itemId);
        if (method === "item/fileChange/requestApproval" && this.editsWithoutAsking(this.threadOf(threadId), params, turn.changes.get(itemId))) return { decision: "accept" };
        const chosen = await turn.handlers.requestPermission(call ?? codexApprovalToolCall(method, params), codexPermissionOptions(params));
        return codexDecision(chosen, params);
    }

    /**
     * In Accept edits, a file change Codex asks about is accepted when every
     * file it touches is inside the chat's project and it asks for no wider
     * write access; anything else is still asked.
     */
    private editsWithoutAsking(thread: Thread | undefined, params: Json, paths: string[] | undefined): boolean {
        if (thread?.mode !== "acceptEdits" || params.grantRoot || !paths?.length) return false;
        const root = path.resolve(thread.cwd);
        const inside = root.endsWith(path.sep) ? root : root + path.sep;
        return paths.every((p) => path.resolve(root, p).startsWith(inside));
    }

    private onNotification(method: string, params: unknown): void {
        if (!isObject(params) || typeof params.threadId !== "string") return;
        const turn = this.turns.get(params.threadId);
        if (!turn) return;
        if (method === "turn/started") {
            if (!turn.turnId && isObject(params.turn) && typeof params.turn.id === "string") this.turnStarted(turn, params.turn.id);
            return;
        }
        if (method === "error") {
            if (params.willRetry !== true && isObject(params.error)) turn.lastError = params.error;
            return;
        }
        if (method === "turn/completed") {
            const done = isObject(params.turn) ? params.turn : {};
            if (turn.turnId && done.id !== turn.turnId) return;
            this.finish(turn, done);
            return;
        }
        if (method === "item/started" && isObject(params.item) && params.item.type === "fileChange" && typeof params.item.id === "string") {
            turn.changes.set(params.item.id, changedPaths(params.item));
            if (turn.changes.size > MAX_TRACKED_ITEMS) turn.changes.delete(turn.changes.keys().next().value!);
        }
        for (const update of turn.translator.updates(method, params)) {
            if (update.sessionUpdate === "tool_call") {
                turn.calls.set(update.toolCallId as string, update);
                if (turn.calls.size > MAX_TRACKED_ITEMS) turn.calls.delete(turn.calls.keys().next().value!);
            }
            turn.handlers.onUpdate(update);
        }
    }

    private finish(turn: Turn, done: Json): void {
        if (done.status === "failed" && codexAuthFailure(isObject(done.error) ? done.error : turn.lastError)) {
            turn.reject(this.signInError());
            return;
        }
        try {
            const lastError = isObject(turn.lastError) && typeof turn.lastError.message === "string" ? turn.lastError.message : undefined;
            turn.resolve(codexStopReason(done, lastError));
        } catch (err) {
            turn.reject(errorOf(err));
        }
    }

    private turnStarted(turn: Turn, turnId: string): void {
        turn.turnId = turnId;
        if (turn.interrupted) this.interrupt(turn);
    }

    private interrupt(turn: Turn): void {
        if (!turn.turnId || !this.peer) return;
        this.peer.request("turn/interrupt", { threadId: turn.threadId, turnId: turn.turnId }).catch((err) => console.warn("[ai] interrupt did not reach Codex:", String(err)));
    }

    openSession(request: SessionRequest): Promise<OpenedSession> {
        const opening = this.opening.get(request.conversationId);
        if (opening) return opening;
        const next = this.open(request).finally(() => this.opening.delete(request.conversationId));
        this.opening.set(request.conversationId, next);
        return next;
    }

    private offered(model: string | undefined): string | undefined {
        return model && this.modelList?.some((m) => m.id === model) ? model : undefined;
    }

    private async open(request: SessionRequest): Promise<OpenedSession> {
        await this.ensureStarted();
        await this.ensureSignedIn();
        // a chat made before models were listed may still name one
        if (request.model && !this.modelList) await this.models();
        const live = this.threads.get(request.conversationId);
        if (live && live.cwd === request.cwd) {
            live.model = this.offered(request.model) ?? live.model;
            live.effort = request.effort;
            return { sessionId: live.threadId, resumed: true, capabilities: CAPABILITIES };
        }
        if (live) this.forget(request.conversationId);
        const peer = this.peer;
        if (!peer) throw new Error(`${this.label} is not running.`);
        const mode = isCodexMode(request.mode) ? request.mode : "default";
        const policy = codexPolicy(mode);
        const model = this.offered(request.model);
        const settings = { cwd: request.cwd, approvalPolicy: policy.approvalPolicy, sandbox: policy.sandbox, ...(model ? { model } : {}) };
        let result: unknown;
        let resumed = false;
        if (request.sessionId) {
            try {
                result = await peer.request("thread/resume", { threadId: request.sessionId, ...settings, excludeTurns: true });
                resumed = true;
            } catch (err) {
                if (!(err instanceof JsonRpcError) || !/no rollout found/i.test(err.message)) throw err;
                console.warn(`[ai] ${this.label} no longer has this chat's thread; starting a new one.`);
            }
        }
        if (!resumed) result = await peer.request("thread/start", settings);
        const thread = isObject(result) && isObject(result.thread) ? result.thread : {};
        if (typeof thread.id !== "string" || !thread.id) throw new Error(`${this.label} did not start a thread.`);
        this.track(request.conversationId, { threadId: thread.id, cwd: request.cwd, mode, ...(model ? { model } : {}), ...(request.effort ? { effort: request.effort } : {}), modeChanged: false });
        this.patchInfo(request.conversationId, { modes: [...CODEX_MODES], mode, commands: [] });
        this.scheduleIdle();
        return { sessionId: thread.id, resumed, capabilities: CAPABILITIES };
    }

    private track(conversationId: string, thread: Thread): void {
        this.threads.delete(conversationId);
        this.threads.set(conversationId, thread);
        // the oldest thread no turn is using is let go (it stays on disk)
        while (this.threads.size > MAX_CODEX_THREADS) {
            const oldest = [...this.threads].find(([, t]) => !this.turns.has(t.threadId));
            if (!oldest) break;
            this.forget(oldest[0]);
        }
    }

    prompt(sessionId: string, blocks: AcpContentBlock[], handlers: TurnHandlers, signal: AbortSignal): Promise<StopReason> {
        const peer = this.peer;
        const thread = this.threadOf(sessionId);
        if (!peer || peer.closed || !thread) return Promise.reject(new Error(`${this.label} is not running.`));
        if (this.turns.has(sessionId)) return Promise.reject(new Error("This chat is already waiting on the agent."));
        return this.runTurn(peer, thread, blocks, handlers, signal);
    }

    private async runTurn(peer: JsonRpcPeer, thread: Thread, blocks: AcpContentBlock[], handlers: TurnHandlers, signal: AbortSignal): Promise<StopReason> {
        this.clearIdle();
        let turn!: Turn;
        const done = new Promise<StopReason>((resolve, reject) => {
            turn = { threadId: thread.threadId, turnId: null, handlers, translator: new CodexTranslator(), calls: new Map(), changes: new Map(), interrupted: false, resolve, reject };
        });
        // awaited below; a turn/start that fails first leaves the failure to that error, not an unhandled one
        done.catch(() => undefined);
        this.turns.set(thread.threadId, turn);
        let grace: ReturnType<typeof setTimeout> | undefined;
        const onAbort = () => {
            turn.interrupted = true;
            this.interrupt(turn);
            // a Codex that ignores the interrupt is stopped rather than waited on forever
            grace = setTimeout(() => {
                void this.stop().catch((err) => console.error("[ai] stopping an unresponsive Codex failed:", String(err)));
            }, this.deps.cancelGraceMs ?? CANCEL_GRACE_MS);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        try {
            const policy = codexPolicy(thread.mode);
            const started = await peer.request("turn/start", {
                threadId: thread.threadId,
                input: codexInput(blocks),
                ...(thread.model ? { model: thread.model } : {}),
                ...(thread.effort ? { effort: thread.effort } : {}),
                ...(thread.modeChanged ? { approvalPolicy: policy.approvalPolicy, sandboxPolicy: policy.sandboxPolicy } : {}),
            });
            thread.modeChanged = false;
            const turnId = isObject(started) && isObject(started.turn) && typeof started.turn.id === "string" ? started.turn.id : null;
            if (turnId && !turn.turnId) this.turnStarted(turn, turnId);
            if (signal.aborted && !turn.interrupted) onAbort();
            return await done;
        } finally {
            clearTimeout(grace);
            signal.removeEventListener("abort", onAbort);
            this.turns.delete(thread.threadId);
            this.scheduleIdle();
        }
    }

    async setMode(conversationId: string, modeId: string): Promise<void> {
        const thread = this.threads.get(conversationId);
        if (!thread || !this.running) throw new Error(`${this.label} has no session for this chat yet. Send a message first.`);
        if (!isCodexMode(modeId)) throw new Error(`${this.label} has no mode "${modeId}".`);
        if (thread.mode !== modeId) {
            thread.mode = modeId;
            thread.modeChanged = true;
        }
        this.patchInfo(conversationId, { mode: modeId });
    }

    async authenticate(): Promise<void> {
        throw new Error(`Sign in to ${this.label} by running "codex login" in a terminal.`);
    }

    private learnModels(models: AgentModel[]): void {
        if (this.modelList && JSON.stringify(this.modelList) === JSON.stringify(models)) return;
        this.modelList = models;
        this.deps.onModels?.(this.connection.id, models);
    }

    /** The models Codex offers (model/list, every page up to a bound). */
    models(): Promise<AgentModel[]> {
        if (this.modelList) return Promise.resolve(this.modelList);
        this.listing ??= this.listModels().finally(() => {
            this.listing = null;
        });
        return this.listing;
    }

    private async listModels(): Promise<AgentModel[]> {
        await this.ensureStarted();
        const models: AgentModel[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_MODEL_PAGES && models.length < MAX_AGENT_MODELS; page++) {
            const peer = this.peer;
            if (!peer) throw new Error(`${this.label} is not running.`);
            const listed = codexModelsFrom(await peer.request("model/list", cursor ? { cursor } : {}));
            models.push(...listed.models);
            cursor = listed.next;
            if (!cursor) break;
        }
        this.learnModels(models.slice(0, MAX_AGENT_MODELS));
        this.scheduleIdle();
        return this.modelList ?? [];
    }

    async check(): Promise<void> {
        await this.ensureStarted();
        await this.ensureSignedIn();
        this.scheduleIdle();
    }

    /** The chat's thread is dropped; Codex lets it go (it stays on disk). */
    forget(conversationId: string): void {
        const thread = this.threads.get(conversationId);
        if (!thread) return;
        this.threads.delete(conversationId);
        this.infos.delete(conversationId);
        this.deps.onSessionInfo(conversationId, null);
        if (this.peer && !this.turns.has(thread.threadId)) {
            this.peer.request("thread/unsubscribe", { threadId: thread.threadId }).catch((err) => console.warn(`[ai] ${this.label} could not let a thread go:`, String(err)));
        }
    }

    private clearIdle(): void {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = null;
    }

    private scheduleIdle(): void {
        this.clearIdle();
        if (this.turns.size > 0 || !this.running) return;
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (this.turns.size === 0) void this.stop().catch((err) => console.error("[ai] stopping an idle Codex failed:", String(err)));
        }, this.deps.idleMs ?? IDLE_MS);
    }

    /** Stops the app server and waits until its exit is observed. */
    async stop(): Promise<void> {
        this.clearIdle();
        const exited = this.exited;
        if (!this.running || !exited) return;
        this.stopping = true;
        await this.kill({ exited, off: () => {} });
    }

    private kill(watch: ExitWatch): Promise<void> {
        return killObserved(this.deps.host, this.procId, watch, this.deps.stopTimeoutMs ?? STOP_TIMEOUT_MS, this.label);
    }

    /** An app server an earlier service run left, stopped. */
    async stopLeftover(): Promise<void> {
        if (await this.deps.host.exists(this.procId)) await this.kill(watchExit(this.deps.host, this.procId));
    }
}
