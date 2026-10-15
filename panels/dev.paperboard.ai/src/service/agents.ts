// Coding agents over ACP. One supervised process per agent connection, run
// through the daemon's process ledger (never a child of this service), and
// one JSON-RPC peer on its stdio. A chat is a session on that process; the
// process starts with the first message, stops after it sits idle, and
// every stop is observed through the exit event.

import {
    ACP_PROTOCOL_VERSION,
    authMethodsFrom,
    commandsFrom,
    modesFrom,
    permissionOptions,
    sessionModelsFrom,
    type SessionModels,
    type AcpContentBlock,
    type PromptCapabilities,
} from "../core/acp";
import { CLAUDE_CODE_ID } from "../core/claudeCode";
import { NO_SANDBOX_MODE_ID, withNoSandbox } from "../core/permissionMode";
import type { Connection } from "../core/providers";
import type { AgentModel, AgentPermissionOption, AgentSessionInfo, AgentState } from "../core/types";
import type { Launch } from "./executable";
import { INVALID_PARAMS, JsonRpcError, JsonRpcPeer, METHOD_NOT_FOUND } from "./jsonRpc";
import { ClaudeCodeAgent } from "./claudeCode";
import { killObserved, StderrTail, watchExit, type ExitWatch } from "./processWatch";

/** ACP's "authentication required" error code */
export const AUTH_REQUIRED = -32000;
export const MAX_SESSIONS_PER_AGENT = 32;
const IDLE_MS = 10 * 60_000;
const INIT_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;
/** how long a cancelled turn may take to wind down before the agent is restarted */
const CANCEL_GRACE_MS = 10_000;

export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

/** The process surface agents need (processApi in production). */
export interface AgentProcessHost {
    start(options: { id: string; command: string; args: string[]; cwd: string; env: Record<string, string> }): Promise<unknown>;
    kill(id: string, signal?: string): Promise<void>;
    exists(id: string): Promise<boolean>;
    write(id: string, data: string): Promise<void>;
    onStdout(id: string, cb: (data: string) => void): () => void;
    onStderr(id: string, cb: (data: string) => void): () => void;
    onExit(id: string, cb: (code?: number) => void): () => void;
}

export interface AgentHubDeps {
    host: AgentProcessHost;
    /** the supervised process id for a connection (namespaced by panel) */
    procId: (connectionId: string) => string;
    /** resolves what to run; throws a readable "not installed" error */
    resolve: (connection: Connection) => Promise<Launch>;
    /** the agent process's own working folder (sessions carry their own) */
    workDir: string;
    clientVersion: string;
    onState: (connectionId: string, state: AgentState | null) => void;
    onSessionInfo: (conversationId: string, info: AgentSessionInfo | null) => void;
    /** the models an agent offers, whenever it tells them anew */
    onModels?: (connectionId: string, models: AgentModel[]) => void;
    idleMs?: number;
    initTimeoutMs?: number;
    stopTimeoutMs?: number;
    cancelGraceMs?: number;
}

/** What a turn hands back to the agent and hears from it. */
export interface TurnHandlers {
    onUpdate: (update: Record<string, unknown>) => void;
    /** resolves the chosen option id, or null when the turn was cancelled */
    requestPermission: (toolCall: Record<string, unknown>, options: AgentPermissionOption[]) => Promise<string | null>;
}

export interface SessionRequest {
    conversationId: string;
    connection: Connection;
    cwd: string;
    /** the chat's earlier session, resumed when the agent can load sessions */
    sessionId?: string;
    mode?: string;
    /** the chat's model, applied when the agent offers it */
    model?: string;
}

export interface OpenedSession {
    sessionId: string;
    /** false when an earlier session could not be resumed and this one starts empty */
    resumed: boolean;
    capabilities: PromptCapabilities;
}

export class AgentAuthError extends Error {
    constructor(label: string) {
        super(`Sign in to ${label} to continue.`);
        this.name = "AgentAuthError";
    }
}

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** What runs an agent connection's chats: an ACP process, or a bridge. */
export interface AgentRunner {
    readonly connection: Connection;
    /** starting, running or mid-turn: replacing it would start a second process under the same id */
    readonly busy: boolean;
    hasTurns(): boolean;
    /** starts the agent without a chat (Test in the picker) */
    check(): Promise<void>;
    /** the models the agent offers (an empty list: it picks its own) */
    models(): Promise<AgentModel[]>;
    openSession(request: SessionRequest): Promise<OpenedSession>;
    prompt(sessionId: string, blocks: AcpContentBlock[], handlers: TurnHandlers, signal: AbortSignal): Promise<StopReason>;
    setMode(conversationId: string, modeId: string): Promise<void>;
    authenticate(methodId: string): Promise<void>;
    forget(conversationId: string): void;
    stop(): Promise<void>;
    stopLeftover(): Promise<void>;
}

interface Initialized {
    capabilities: PromptCapabilities;
    loadSession: boolean;
    name?: string;
    version?: string;
}

/** One agent process: started once, shared by its chats' sessions. */
class AgentProcess implements AgentRunner {
    private peer: JsonRpcPeer | null = null;
    private starting: Promise<Initialized> | null = null;
    private init: Initialized | null = null;
    private offs: (() => void)[] = [];
    private exited: Promise<number | undefined> | null = null;
    private stopping = false;
    private stderr = new StderrTail();
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    /** conversation id → session id, oldest first */
    private sessions = new Map<string, string>();
    private turns = new Map<string, TurnHandlers>();
    /** conversation id → its session's modes and commands */
    private infos = new Map<string, AgentSessionInfo>();
    /** conversation id → how its session picks a model */
    private sessionModels = new Map<string, SessionModels>();
    private modelList: AgentModel[] | null = null;
    private listing: Promise<AgentModel[]> | null = null;
    private state: AgentState = { status: "stopped" };

    constructor(
        private readonly hub: AgentHubDeps,
        readonly connection: Connection,
    ) {}

    private get procId(): string {
        return this.hub.procId(this.connection.id);
    }

    private publish(patch: Partial<AgentState>): void {
        this.state = { ...this.state, ...patch };
        this.hub.onState(this.connection.id, this.state);
    }

    get running(): boolean {
        return this.peer !== null && !this.peer.closed;
    }

    /** starting, running or mid-turn: replacing it would start a second process under the same id */
    get busy(): boolean {
        return this.running || this.starting !== null || this.turns.size > 0;
    }

    hasTurns(): boolean {
        return this.turns.size > 0;
    }

    async check(): Promise<void> {
        await this.ensureStarted();
    }

    /** Starts the process and runs initialize, once; concurrent callers share it. */
    ensureStarted(): Promise<Initialized> {
        if (this.init && this.running) return Promise.resolve(this.init);
        this.starting ??= this.start().finally(() => {
            this.starting = null;
        });
        return this.starting;
    }

    private async start(): Promise<Initialized> {
        const { host } = this.hub;
        this.clearIdle();
        this.publish({ status: "starting", error: undefined, errorDetail: undefined });
        let launch: Launch;
        try {
            launch = await this.hub.resolve(this.connection);
        } catch (err) {
            this.publish({ status: "error", error: err instanceof Error ? err.message : String(err) });
            throw err;
        }
        // a process left by an earlier service run has lost its protocol state
        if (await host.exists(this.procId)) await this.killObserved(this.watchExit());

        this.stopping = false;
        this.stderr.clear();
        const procId = this.procId;
        const peer = new JsonRpcPeer((chunk) => host.write(procId, chunk), {
            onRequest: (method, params) => this.onRequest(method, params),
            onNotification: (method, params) => this.onNotification(method, params),
            onProtocolError: (err) => {
                console.error(`[ai] ${this.connection.label} broke the protocol:`, err.message);
                this.publish({ status: "error", error: `${this.connection.label} sent a message the panel could not read: ${err.message}` });
                void this.stop().catch((stopErr) => console.error("[ai] stopping a broken agent failed:", String(stopErr)));
            },
        });
        this.peer = peer;
        const watch = this.watchExit();
        this.exited = watch.exited;
        this.offs = [
            watch.off,
            host.onStdout(procId, (data) => peer.receive(data)),
            host.onStderr(procId, (data) => this.stderr.push(data)),
        ];
        watch.exited.then((code) => this.onExit(peer, code));

        try {
            await host.start({ id: procId, command: launch.command, args: launch.args, cwd: this.hub.workDir, env: { PATH: launch.pathEnv } });
            const result = await this.withDeadline(
                peer.request("initialize", {
                    protocolVersion: ACP_PROTOCOL_VERSION,
                    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
                    clientInfo: { name: "paperboard", title: "Paperboard", version: this.hub.clientVersion },
                }),
                this.hub.initTimeoutMs ?? INIT_TIMEOUT_MS,
                `${this.connection.label} did not answer within ${Math.round((this.hub.initTimeoutMs ?? INIT_TIMEOUT_MS) / 1000)} seconds.`,
            );
            const init = this.readInitialize(result);
            this.init = init;
            this.publish({ status: "ready", ...(init.name ? { name: init.name } : {}), ...(init.version ? { version: init.version } : {}) });
            return init;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.stop().catch((stopErr) => console.error("[ai] stopping an agent that failed to start:", String(stopErr)));
            this.publish({ status: "error", error: message, ...this.stderr.detail() });
            throw new Error(message);
        }
    }

    private readInitialize(result: unknown): Initialized {
        if (!isObject(result)) throw new Error(`${this.connection.label} answered initialize with nothing usable.`);
        if (result.protocolVersion !== ACP_PROTOCOL_VERSION) {
            throw new Error(`${this.connection.label} speaks ACP version ${String(result.protocolVersion)}; the panel speaks version ${ACP_PROTOCOL_VERSION}.`);
        }
        const caps = isObject(result.agentCapabilities) ? result.agentCapabilities : {};
        const prompt = isObject(caps.promptCapabilities) ? caps.promptCapabilities : {};
        const info = isObject(result.agentInfo) ? result.agentInfo : {};
        const methods = authMethodsFrom(result.authMethods);
        if (methods.length) this.state = { ...this.state, authMethods: methods };
        return {
            capabilities: { image: prompt.image === true, embeddedContext: prompt.embeddedContext === true },
            loadSession: caps.loadSession === true,
            ...(typeof info.title === "string" || typeof info.name === "string" ? { name: String(info.title ?? info.name).slice(0, 100) } : {}),
            ...(typeof info.version === "string" ? { version: info.version.slice(0, 50) } : {}),
        };
    }

    private async withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([work, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)))]);
        } finally {
            clearTimeout(timer);
        }
    }

    private watchExit(): ExitWatch {
        return watchExit(this.hub.host, this.procId);
    }

    private onExit(peer: JsonRpcPeer, code: number | undefined): void {
        if (this.peer !== peer) return;
        const expected = this.stopping;
        const reason = new Error(
            expected ? `${this.connection.label} was stopped.` : `${this.connection.label} stopped unexpectedly${code !== undefined ? ` (exit code ${code})` : ""}.`,
        );
        peer.close(reason);
        this.peer = null;
        this.init = null;
        for (const off of this.offs.splice(0)) off();
        for (const conversationId of this.sessions.keys()) this.hub.onSessionInfo(conversationId, null);
        this.sessions.clear();
        this.infos.clear();
        this.sessionModels.clear();
        this.clearIdle();
        if (expected) this.publish({ status: "stopped", error: undefined, errorDetail: undefined });
        else this.publish({ status: "error", error: reason.message, ...this.stderr.detail() });
    }

    private async onRequest(method: string, params: unknown): Promise<unknown> {
        if (method !== "session/request_permission") {
            // fs/* and terminal/* are not offered in initialize
            throw new JsonRpcError(METHOD_NOT_FOUND, `${method} is not supported by Paperboard.`);
        }
        if (!isObject(params) || typeof params.sessionId !== "string" || !isObject(params.toolCall)) {
            throw new JsonRpcError(INVALID_PARAMS, "session/request_permission needs a sessionId and a toolCall.");
        }
        let options: AgentPermissionOption[];
        try {
            options = permissionOptions(params.options);
        } catch (err) {
            throw new JsonRpcError(INVALID_PARAMS, err instanceof Error ? err.message : String(err));
        }
        const turn = this.turns.get(params.sessionId);
        // nobody is there to answer outside a turn
        if (!turn) return { outcome: { outcome: "cancelled" } };
        const chosen = await turn.requestPermission(params.toolCall, options);
        return chosen ? { outcome: { outcome: "selected", optionId: chosen } } : { outcome: { outcome: "cancelled" } };
    }

    private conversationOf(sessionId: string): string | undefined {
        for (const [conversationId, id] of this.sessions) if (id === sessionId) return conversationId;
        return undefined;
    }

    private patchInfo(conversationId: string, patch: Partial<AgentSessionInfo>): void {
        const next = { ...(this.infos.get(conversationId) ?? { modes: [], commands: [] }), ...patch };
        this.infos.set(conversationId, next);
        this.hub.onSessionInfo(conversationId, next);
    }

    private onNotification(method: string, params: unknown): void {
        if (method !== "session/update" || !isObject(params) || typeof params.sessionId !== "string" || !isObject(params.update)) return;
        const update = params.update;
        const conversationId = this.conversationOf(params.sessionId);
        if (update.sessionUpdate === "available_commands_update") {
            if (conversationId) this.patchInfo(conversationId, { commands: commandsFrom(update.availableCommands) });
            return;
        }
        if (update.sessionUpdate === "config_option_update") {
            const models = sessionModelsFrom({ configOptions: update.configOptions });
            if (conversationId && models) {
                this.sessionModels.set(conversationId, models);
                this.learnModels(models.models);
            }
            return;
        }
        if (update.sessionUpdate === "current_mode_update") {
            if (conversationId && typeof update.currentModeId === "string") this.patchInfo(conversationId, { mode: update.currentModeId });
            return;
        }
        // replayed history (session/load) arrives with no turn listening
        this.turns.get(params.sessionId)?.onUpdate(update);
    }

    private authError(err: unknown): Error {
        if (err instanceof JsonRpcError && err.code === AUTH_REQUIRED) {
            this.publish({ status: "auth-required", error: undefined });
            return new AgentAuthError(this.connection.label);
        }
        return err instanceof Error ? err : new Error(String(err));
    }

    async openSession(request: SessionRequest): Promise<OpenedSession> {
        const init = await this.ensureStarted();
        const peer = this.peer!;
        const live = this.sessions.get(request.conversationId);
        if (live) {
            await this.applyModel(request.conversationId, request.model);
            return { sessionId: live, resumed: true, capabilities: init.capabilities };
        }
        let sessionId: string | undefined;
        let resumed = false;
        let result: unknown;
        if (request.sessionId && init.loadSession) {
            try {
                // registered first: the replayed history is addressed to it
                this.track(request.conversationId, request.sessionId);
                result = await peer.request("session/load", { sessionId: request.sessionId, cwd: request.cwd, mcpServers: [] });
                sessionId = request.sessionId;
                resumed = true;
            } catch (err) {
                this.sessions.delete(request.conversationId);
                if (err instanceof JsonRpcError && err.code === AUTH_REQUIRED) throw this.authError(err);
                console.warn(`[ai] ${this.connection.label} could not resume its session; starting a new one:`, String(err));
            }
        }
        if (!sessionId) {
            try {
                result = await peer.request("session/new", { cwd: request.cwd, mcpServers: [] });
            } catch (err) {
                throw this.authError(err);
            }
            if (!isObject(result) || typeof result.sessionId !== "string" || !result.sessionId) {
                throw new Error(`${this.connection.label} did not start a session.`);
            }
            sessionId = result.sessionId;
            this.track(request.conversationId, sessionId);
        }
        if (this.state.status === "auth-required") this.publish({ status: "ready" });
        const offered = modesFrom(isObject(result) ? result.modes : undefined);
        const { current } = offered;
        const modes = withNoSandbox(offered.modes);
        this.patchInfo(request.conversationId, { modes, ...(current ? { mode: current } : {}) });
        if (request.mode && request.mode !== current && modes.some((m) => m.id === request.mode)) {
            await this.setMode(request.conversationId, request.mode);
        }
        const models = sessionModelsFrom(result);
        if (models) {
            this.sessionModels.set(request.conversationId, models);
            this.learnModels(models.models);
        }
        await this.applyModel(request.conversationId, request.model);
        return { sessionId, resumed, capabilities: init.capabilities };
    }

    private track(conversationId: string, sessionId: string): void {
        this.sessions.delete(conversationId);
        this.sessions.set(conversationId, sessionId);
        // the oldest idle session is forgotten (the agent keeps it on disk if it can)
        while (this.sessions.size > MAX_SESSIONS_PER_AGENT) {
            const oldest = [...this.sessions].find(([, id]) => !this.turns.has(id));
            if (!oldest) break;
            this.forget(oldest[0]);
        }
    }

    forget(conversationId: string): void {
        if (!this.sessions.delete(conversationId)) return;
        this.infos.delete(conversationId);
        this.sessionModels.delete(conversationId);
        this.hub.onSessionInfo(conversationId, null);
    }

    private learnModels(models: AgentModel[]): void {
        if (this.modelList && JSON.stringify(this.modelList) === JSON.stringify(models)) return;
        this.modelList = models;
        this.hub.onModels?.(this.connection.id, models);
    }

    /** Switches the chat's session to its model, when the agent offers that model. */
    private async applyModel(conversationId: string, model: string | undefined): Promise<void> {
        const choice = this.sessionModels.get(conversationId);
        const sessionId = this.sessions.get(conversationId);
        if (!model || !choice || !sessionId || !this.peer || choice.current === model || !choice.models.some((m) => m.id === model)) return;
        if (choice.via === "legacy") await this.peer.request("session/set_model", { sessionId, modelId: model });
        else await this.peer.request("session/set_config_option", { sessionId, configId: choice.via.configId, value: model });
        choice.current = model;
    }

    /**
     * The models the agent offers. ACP lists them only per session, so the
     * first ask opens a session that no chat uses.
     */
    models(): Promise<AgentModel[]> {
        if (this.modelList) return Promise.resolve(this.modelList);
        this.listing ??= this.listModels().finally(() => {
            this.listing = null;
        });
        return this.listing;
    }

    private async listModels(): Promise<AgentModel[]> {
        await this.ensureStarted();
        let result: unknown;
        try {
            result = await this.peer!.request("session/new", { cwd: this.hub.workDir, mcpServers: [] });
        } catch (err) {
            throw this.authError(err);
        }
        this.learnModels(sessionModelsFrom(result)?.models ?? []);
        this.scheduleIdle();
        return this.modelList ?? [];
    }

    async setMode(conversationId: string, modeId: string): Promise<void> {
        const sessionId = this.sessions.get(conversationId);
        if (!sessionId || !this.peer) throw new Error(`${this.connection.label} has no session for this chat yet. Send a message first.`);
        // No sandbox is the panel's: the agent keeps its own mode and the chat answers its permission requests
        if (modeId !== NO_SANDBOX_MODE_ID) await this.peer.request("session/set_mode", { sessionId, modeId });
        this.patchInfo(conversationId, { mode: modeId });
    }

    async authenticate(methodId: string): Promise<void> {
        await this.ensureStarted();
        if (!this.state.authMethods?.some((m) => m.id === methodId)) throw new Error("That sign-in method is not offered.");
        await this.peer!.request("authenticate", { methodId });
        this.publish({ status: "ready", error: undefined });
    }

    /** Runs one prompt turn; resolves with the agent's stop reason. */
    async prompt(sessionId: string, blocks: AcpContentBlock[], handlers: TurnHandlers, signal: AbortSignal): Promise<StopReason> {
        const peer = this.peer;
        if (!peer || peer.closed) throw new Error(`${this.connection.label} is not running.`);
        if (this.turns.has(sessionId)) throw new Error("This chat is already waiting on the agent.");
        this.clearIdle();
        this.turns.set(sessionId, handlers);
        let grace: ReturnType<typeof setTimeout> | undefined;
        const onAbort = () => {
            void peer.notify("session/cancel", { sessionId }).catch((err) => console.warn("[ai] cancel did not reach the agent:", String(err)));
            // an agent that ignores cancel is restarted rather than waited on forever
            grace = setTimeout(() => {
                void this.stop().catch((err) => console.error("[ai] restarting an unresponsive agent failed:", String(err)));
            }, this.hub.cancelGraceMs ?? CANCEL_GRACE_MS);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
        try {
            const result = await peer.request("session/prompt", { sessionId, prompt: blocks });
            const reason = isObject(result) ? result.stopReason : undefined;
            const known: StopReason[] = ["end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"];
            return known.includes(reason as StopReason) ? (reason as StopReason) : "end_turn";
        } catch (err) {
            throw this.authError(err);
        } finally {
            clearTimeout(grace);
            signal.removeEventListener("abort", onAbort);
            this.turns.delete(sessionId);
            this.scheduleIdle();
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
            if (this.turns.size === 0) void this.stop().catch((err) => console.error("[ai] stopping an idle agent failed:", String(err)));
        }, this.hub.idleMs ?? IDLE_MS);
    }

    /** Stops the process and waits until its exit is observed. */
    async stop(): Promise<void> {
        this.clearIdle();
        const exited = this.exited;
        if (!this.running || !exited) {
            this.peer = null;
            this.init = null;
            return;
        }
        this.stopping = true;
        await this.killObserved({ exited, off: () => {} });
    }

    private killObserved(watch: ExitWatch): Promise<void> {
        return killObserved(this.hub.host, this.procId, watch, this.hub.stopTimeoutMs ?? STOP_TIMEOUT_MS, this.connection.label);
    }

    /** A connection's process left by an earlier service run, stopped. */
    async stopLeftover(): Promise<void> {
        if (await this.hub.host.exists(this.procId)) await this.killObserved(this.watchExit());
    }
}

/** Every agent connection's process, keyed by connection id. */
export class AgentHub {
    private agents = new Map<string, AgentRunner>();

    constructor(private readonly deps: AgentHubDeps) {}

    private agent(connection: Connection): AgentRunner {
        let agent = this.agents.get(connection.id);
        // a renamed or re-pointed connection runs as its new self
        if (agent && agent.connection !== connection && !agent.busy) {
            this.agents.delete(connection.id);
            agent = undefined;
        }
        if (!agent) {
            agent = connection.agent === CLAUDE_CODE_ID ? new ClaudeCodeAgent(this.deps, connection) : new AgentProcess(this.deps, connection);
            this.agents.set(connection.id, agent);
        }
        return agent;
    }

    openSession(request: SessionRequest): Promise<OpenedSession> {
        return this.agent(request.connection).openSession(request);
    }

    prompt(connection: Connection, sessionId: string, blocks: AcpContentBlock[], handlers: TurnHandlers, signal: AbortSignal): Promise<StopReason> {
        return this.agent(connection).prompt(sessionId, blocks, handlers, signal);
    }

    setMode(connection: Connection, conversationId: string, modeId: string): Promise<void> {
        return this.agent(connection).setMode(conversationId, modeId);
    }

    authenticate(connection: Connection, methodId: string): Promise<void> {
        return this.agent(connection).authenticate(methodId);
    }

    models(connection: Connection): Promise<AgentModel[]> {
        return this.agent(connection).models();
    }

    /** Starts an agent without a chat (Test in the picker). */
    async check(connection: Connection): Promise<void> {
        await this.agent(connection).check();
    }

    /** The chat's session is dropped (rewound, moved, deleted); the next message starts another. */
    forget(conversationId: string): void {
        for (const agent of this.agents.values()) agent.forget(conversationId);
    }

    /** Stops a connection's agent and forgets it (removed or changed). */
    async stop(connectionId: string): Promise<void> {
        const agent = this.agents.get(connectionId);
        if (!agent) return;
        if (agent.hasTurns()) throw new Error(`${agent.connection.label} is replying. Stop it first.`);
        await agent.stop();
        this.agents.delete(connectionId);
        this.deps.onState(connectionId, null);
    }

    /** Agents an earlier service run left running lost their sessions; stop them. */
    async stopLeftovers(connections: readonly Connection[]): Promise<void> {
        await Promise.all(connections.map((c) => this.agent(c).stopLeftover()));
    }

    async stopAll(): Promise<void> {
        await Promise.all([...this.agents.values()].map((a) => a.stop()));
    }
}
