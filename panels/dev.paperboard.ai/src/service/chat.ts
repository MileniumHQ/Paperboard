// The reply loop: stream a model's answer, and when it asks for a tool,
// stop and ask the user before any action runs. A denied, failed or
// interrupted call is handed back to the model as what it is.

import type { MemoryMessage } from "../core/askMemory";
import {
    MAX_MESSAGES,
    MAX_PROJECT_TOOL_ROUNDS,
    MAX_TOOL_ROUNDS,
    MAX_USER_MESSAGE_CHARS,
    inferenceOptions,
    newId,
    titleFrom,
    toOllamaMessages,
    systemPrompt,
} from "../core/conversation";
import {
    BUILTIN_LABELS,
    BuiltinArgumentError,
    builtinArguments,
    builtinAsks,
    builtinTools,
    formatShellResult,
    isBuiltinTool,
} from "../core/builtins";
import { applyToolUpdate, contentText, planFrom, promptBlocks, toolRecordFrom } from "../core/acp";
import { replyText } from "../core/chain";
import { isProjectTool } from "../core/projectTools";
import { validateAttachments } from "../core/attachments";
import { reasoningToThink, type ReasoningLevel } from "../core/reasoning";
import { autoAllowOption, isNoSandboxMode } from "../core/permissionMode";
import {
    APP_ACTION_TOOLS,
    buildActionIndex,
    CALL_APP_ACTION,
    FIND_APP_ACTIONS,
    formatFoundActions,
    resolveActionCall,
    type ActionIndex,
} from "../core/appActions";
import {
    formatToolResult,
    permissionKey,
    prepareArguments,
    ToolArgumentError,
    type RegistryAction,
    type ToolSet,
} from "../core/tools";
import type {
    AssistantMessage,
    Attachment,
    ChatDeltaEvent,
    ChatMessage,
    ChatMessageEvent,
    ChatResetEvent,
    Conversation,
    ConversationSnapshot,
    ConversationSummary,
    AgentPermissionOption,
    PendingApproval,
    Settings,
    ToolCallRecord,
    UserMessage,
} from "../core/types";
import type { Connection } from "../core/providers";
import type { AgentHub, StopReason } from "./agents";
import type { ChatChunk } from "./ollamaClient";
import type { ChatClient } from "./provider";
import { ProjectFiles, type PreparedChange } from "./projectFiles";
import type { ConversationStore } from "./store";

export const MAX_ACTIVE_REPLIES = 3;
export const MAX_CALLS_PER_ROUND = 8;
export const MAX_REPLY_CHARS = 200_000;
/** tool calls an agent turn records in the chat; later ones still run, unrecorded */
export const MAX_AGENT_TOOL_CALLS = 500;
const DELTA_INTERVAL_MS = 60;
const AGENT_MESSAGE_INTERVAL_MS = 150;

export type ApprovalDecision = "once" | "always" | "deny";

export interface ChatDeps {
    ownPanelId: string;
    /** the transport for a conversation's provider */
    clientFor: (providerId: string) => ChatClient;
    /** which connection lists a model name, when the chat names none */
    providerOf: (model: string) => string | undefined;
    store: ConversationStore;
    settings: () => Settings;
    capabilities: (model: string, provider?: string) => string[] | undefined;
    listActions: () => Promise<RegistryAction[]>;
    panelNames: () => Promise<Record<string, string>>;
    callAction: (panelId: string, action: string, args: Record<string, unknown>) => Promise<unknown>;
    isAllowed: (key: string) => boolean;
    rememberAllowed: (key: string) => Promise<void>;
    /** the agent connection a provider id names, if it is one */
    agentConnection: (providerId: string) => Connection | undefined;
    /** the folder an agent works in for a project; throws when it is gone */
    projectPath: (project: string) => Promise<string>;
    agents: Pick<AgentHub, "openSession" | "prompt" | "forget">;
    /** an agent chat's live mode, as its session reports it */
    agentMode: (conversationId: string) => string | undefined;
    /** the built-in tools' effects; `cwd` is the chat's project folder, when it works in one */
    runShell: (command: string, signal: AbortSignal, cwd?: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
    // outputs
    onDelta: (payload: ChatDeltaEvent) => void;
    onMessage: (payload: ChatMessageEvent) => void;
    onReset: (payload: ChatResetEvent) => void;
    onSummaries: (list: ConversationSummary[]) => void;
    onGenerating: (ids: string[]) => void;
    onApprovals: (list: PendingApproval[]) => void;
    onSpeed: (model: string, tokensPerSecond: number) => void;
    onReplyFinished: (payload: { conversationId: string; title: string; model: string; text: string }) => void;
}

interface Active {
    abort: AbortController;
    done: Promise<void>;
    /** the reply's working copy: newer than the last save until it ends */
    conversation: Conversation;
}

interface Waiting {
    approval: PendingApproval;
    resolve: (decision: ApprovalDecision | "cancelled") => void;
    /** an agent's request: answered with one of its own options */
    choose?: (optionId: string) => void;
}

export class ChatEngine {
    private active = new Map<string, Active>();
    /** chats being rewound; a send must not interleave with the rewrite */
    private rewinding = new Set<string>();
    private waiting = new Map<string, Waiting>();
    /** orders every live event against the snapshots `get` hands out */
    private seq = 0;

    constructor(private readonly deps: ChatDeps) {}

    private emitMessage(conversationId: string, message: ChatMessage): void {
        this.deps.onMessage({ seq: ++this.seq, conversationId, message });
    }

    get generating(): string[] {
        return [...this.active.keys()];
    }

    get approvals(): PendingApproval[] {
        return [...this.waiting.values()].map((w) => w.approval);
    }

    private publishActive(): void {
        this.deps.onGenerating(this.generating);
    }

    private publishApprovals(): void {
        this.deps.onApprovals(this.approvals);
    }

    /**
     * A conversation as it is now. A replying chat's file lags its reply
     * (the streaming message is saved when its round ends), so the reply's
     * working copy is the truth; reading the file would drop the streaming
     * message and, worse, mark a mid-reply save as interrupted.
     */
    async get(conversationId: string): Promise<ConversationSnapshot> {
        // taken before the read: an event racing the read is replayed by
        // the opener rather than lost (replaying a full message is idempotent)
        const seq = this.seq;
        const live = this.active.get(conversationId)?.conversation;
        if (live) return { seq, conversation: structuredClone(live) };
        return { seq, conversation: await this.deps.store.get(conversationId) };
    }

    /**
     * Renames a chat. A replying chat is renamed on the reply's working copy,
     * or the reply's next save would write the old title back.
     */
    async rename(conversationId: string, title: string): Promise<void> {
        const conversation = this.active.get(conversationId)?.conversation ?? (await this.deps.store.get(conversationId));
        conversation.title = title;
        this.deps.onSummaries(await this.deps.store.save(conversation));
    }

    /**
     * Saves a chat's mode, on the reply's working copy when it is replying
     * (its next save would write the old mode back). Entering No sandbox
     * answers the chat's open requests the way it answers later ones.
     */
    async setMode(conversationId: string, mode: string): Promise<void> {
        const conversation = this.active.get(conversationId)?.conversation ?? (await this.deps.store.get(conversationId));
        conversation.mode = mode;
        this.deps.onSummaries(await this.deps.store.save(conversation));
        if (!isNoSandboxMode(mode)) return;
        for (const w of [...this.waiting.values()]) {
            if (w.approval.conversationId !== conversationId) continue;
            if (!w.choose) w.resolve("once");
            else if (isNoSandboxMode(this.deps.agentMode(conversationId))) {
                const allow = autoAllowOption(w.approval.options ?? []);
                if (allow) w.choose(allow);
            }
        }
    }

    async create(model: string, provider?: string, project?: string): Promise<Conversation> {
        const now = Date.now();
        const conversation: Conversation = {
            id: newId(),
            title: "New chat",
            model,
            ...(provider ? { provider } : {}),
            ...(project ? { project } : {}),
            createdAt: now,
            updatedAt: now,
            messages: [],
        };
        this.deps.onSummaries(await this.deps.store.save(conversation));
        return conversation;
    }

    /**
     * Saves the user's message, then replies in the background. Resolves once
     * the message is accepted; the reply streams through the event outputs.
     */
    async send(
        conversationId: string,
        text: string,
        opts: { reasoning?: ReasoningLevel; attachments?: Attachment[] } = {},
    ): Promise<{ messageId: string; done: Promise<void> }> {
        const content = text.trim();
        const attachments = opts.attachments ?? [];
        if (!content && attachments.length === 0) throw new Error("Type a message first.");
        if (content.length > MAX_USER_MESSAGE_CHARS) throw new Error(`Messages are limited to ${MAX_USER_MESSAGE_CHARS} characters.`);
        if (this.active.has(conversationId)) throw new Error("This chat is still replying. Stop it or wait for it to finish.");
        if (this.rewinding.has(conversationId)) throw new Error("This chat is being rewound. Try again in a moment.");
        if (this.active.size >= MAX_ACTIVE_REPLIES) throw new Error(`Only ${MAX_ACTIVE_REPLIES} chats can reply at once.`);

        const conversation = await this.deps.store.get(conversationId);
        if (conversation.messages.length >= MAX_MESSAGES) throw new Error("This chat is full. Start a new one.");
        const settings = this.deps.settings();
        const model = conversation.model || settings.defaultModel;
        if (!model) throw new Error("Choose a model for this chat first.");
        // a chat keeps the connection it was given; one without (older chats,
        // flow-picked names) takes the connection that lists the name
        const provider =
            conversation.provider ??
            (!conversation.model && settings.defaultProvider ? settings.defaultProvider : this.deps.providerOf(model));
        const agent = provider ? this.deps.agentConnection(provider) : undefined;
        let capabilities: string[] | undefined;
        if (agent) {
            if (!conversation.project) throw new Error(`Choose a project for ${agent.label} to work in first.`);
            // whether the agent takes images is its answer once the session opens
            validateAttachments(attachments, { vision: true });
        } else {
            capabilities = provider ? this.deps.capabilities(model, provider) : undefined;
            if (!provider || !capabilities) throw new Error(`${model} is not available. Pick a model from Models.`);
            validateAttachments(attachments, { vision: capabilities.includes("vision") });
            this.deps.clientFor(provider); // throws when the provider is not reachable
            // a project that is gone is said now, not after the message is saved
            if (conversation.project && capabilities.includes("tools")) await this.deps.projectPath(conversation.project);
        }

        const user: UserMessage = {
            id: newId(),
            role: "user",
            content,
            ...(attachments.length ? { attachments } : {}),
            createdAt: Date.now(),
        };
        conversation.model = model;
        conversation.provider = provider;
        if (conversation.messages.length === 0) {
            const named = attachments.map((a) => a.name).join(", ");
            conversation.title = titleFrom(content || named);
        }
        conversation.messages.push(user);
        conversation.updatedAt = Date.now();
        this.deps.onSummaries(await this.deps.store.save(conversation));
        this.emitMessage(conversationId, user);

        const reasoning = opts.reasoning ?? this.deps.settings().reasoning;
        const abort = new AbortController();
        const replying = agent
            ? this.agentReply(conversation, agent, user, abort.signal)
            : this.reply(conversation, abort.signal, capabilities!.includes("thinking") ? reasoningToThink(reasoning) : false);
        const done = replying.finally(() => {
            this.active.delete(conversationId);
            this.publishActive();
        });
        this.active.set(conversationId, { abort, done, conversation });
        this.publishActive();
        return { messageId: user.id, done };
    }

    /**
     * Erases a user message and everything after it. A reply in flight is
     * stopped and settled first so its last save cannot resurrect them.
     */
    async rewind(conversationId: string, messageId: string): Promise<Conversation> {
        if (this.rewinding.has(conversationId)) throw new Error("This chat is already being rewound.");
        this.rewinding.add(conversationId);
        try {
            await this.stopAndSettle(conversationId);
            const conversation = await this.deps.store.get(conversationId);
            const i = conversation.messages.findIndex((m) => m.id === messageId);
            if (i < 0 || conversation.messages[i]!.role !== "user") throw new Error("That message is not in this chat.");
            conversation.messages = conversation.messages.slice(0, i);
            // an agent remembers what was erased; its next turn starts a fresh session
            if (conversation.sessionId) {
                delete conversation.sessionId;
                this.deps.agents.forget(conversationId);
            }
            conversation.updatedAt = Date.now();
            this.deps.onSummaries(await this.deps.store.save(conversation));
            // other windows showing this chat still hold the erased messages
            this.deps.onReset({ seq: ++this.seq, conversationId });
            return conversation;
        } finally {
            this.rewinding.delete(conversationId);
        }
    }

    stop(conversationId: string): void {
        const active = this.active.get(conversationId);
        if (!active) return;
        active.abort.abort();
        for (const w of [...this.waiting.values()]) {
            if (w.approval.conversationId === conversationId) w.resolve("cancelled");
        }
    }

    /** Stops a reply and waits until it has saved its final state. */
    async stopAndSettle(conversationId: string): Promise<void> {
        const active = this.active.get(conversationId);
        if (!active) return;
        this.stop(conversationId);
        await active.done.catch((err) => console.debug("[ai] stopped reply ended with:", String(err)));
    }

    resolveApproval(id: string, decision: ApprovalDecision, optionId?: string): void {
        const w = this.waiting.get(id);
        if (!w) throw new Error("That request is no longer waiting for approval.");
        if (w.choose) {
            if (typeof optionId !== "string" || !w.approval.options?.some((o) => o.id === optionId)) {
                throw new Error("Choose one of the answers the agent offered.");
            }
            w.choose(optionId);
            return;
        }
        if (!["once", "always", "deny"].includes(decision)) throw new Error(`Unknown decision ${JSON.stringify(decision)}`);
        const builtin = w.approval.builtin;
        if (decision === "always" && builtin) {
            throw new Error(`${BUILTIN_LABELS[builtin]} asks every time; it cannot be allowed always.`);
        }
        w.resolve(decision);
    }

    /** Stops every reply and waits for them to settle (service shutdown). */
    async stopAll(): Promise<void> {
        const pending = [...this.active.values()].map((a) => a.done.catch(() => undefined));
        for (const id of [...this.active.keys()]) this.stop(id);
        await Promise.all(pending);
    }

    /**
     * The same offered tools and prompt used by replies and the initial
     * custom editor. `project`: the chat works in a project, so a model that
     * can call tools is offered the file tools.
     */
    async promptForModel(
        model: string,
        settings: Settings = this.deps.settings(),
        provider?: string,
        project = false,
    ): Promise<{ tools: ToolSet; prompt: string }> {
        const capabilities = this.deps.capabilities(model, provider) ?? [];
        const canCall = capabilities.includes("tools");
        // Other panels' actions are never listed here: the model searches
        // them with find_app_actions, so the offered tools stay the same
        // size however many panels are installed.
        const tools: ToolSet = {
            tools: canCall ? [...builtinTools(settings, project), ...(settings.panelActions ? APP_ACTION_TOOLS : [])] : [],
        };
        const offered = new Set(tools.tools.map((t) => t.function.name));
        const prompt = systemPrompt({
            style: settings.promptStyle,
            customPrompt: settings.customPromptEnabled ? settings.customSystemPrompt ?? undefined : undefined,
            model,
            shellCommands: offered.has("run_shell_command"),
            panelActions: offered.has(CALL_APP_ACTION),
            projectTools: offered.has("read_file"),
        });

        return { tools, prompt };
    }

    private async reply(conversation: Conversation, signal: AbortSignal, think: boolean | string): Promise<void> {
        const { deps } = this;
        const save = async () => {
            conversation.updatedAt = Date.now();
            deps.onSummaries(await deps.store.save(conversation));
        };
        let current: AssistantMessage | null = null;
        // the project is fixed while a reply runs (setConversationProject waits for it)
        const maxRounds = conversation.project ? MAX_PROJECT_TOOL_ROUNDS : MAX_TOOL_ROUNDS;
        try {
            for (let round = 0; ; round++) {
                if (round >= maxRounds) {
                    const notice = this.startAssistant(conversation);
                    notice.status = "error";
                    notice.error = `Stopped after ${maxRounds} rounds of actions in one reply.`;
                    this.emitMessage(conversation.id, notice);
                    await save();
                    return;
                }
                const capabilities = deps.capabilities(conversation.model, conversation.provider) ?? [];
                const settings = deps.settings();
                const inProject = Boolean(conversation.project) && capabilities.includes("tools");
                const files = inProject ? await ProjectFiles.open(await deps.projectPath(conversation.project!)) : undefined;
                const { tools, prompt } = await this.promptForModel(conversation.model, settings, conversation.provider, inProject);
                const offered = new Set(tools.tools.map((t) => t.function.name));
                const history = toOllamaMessages(conversation.messages, prompt);

                current = this.startAssistant(conversation);
                const message = current;
                this.emitMessage(conversation.id, message);
                const calls = await this.stream(conversation, message, history, tools, capabilities, think, signal);

                if (calls.length === 0) {
                    message.status = "done";
                    this.emitMessage(conversation.id, message);
                    await save();
                    deps.onReplyFinished({
                        conversationId: conversation.id,
                        title: conversation.title,
                        model: conversation.model,
                        text: message.content,
                    });
                    return;
                }

                const planned = calls.slice(0, MAX_CALLS_PER_ROUND);
                // the registry is read only when the model asks about it
                const index = planned.some((c) => (c.name === FIND_APP_ACTIONS || c.name === CALL_APP_ACTION) && offered.has(c.name))
                    ? buildActionIndex(await deps.listActions(), deps.ownPanelId, await deps.panelNames())
                    : null;
                message.toolCalls = planned.map((c) => this.planCall(c, index, offered));
                this.emitMessage(conversation.id, message);
                await save();
                for (const call of message.toolCalls) {
                    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
                    await this.runCall(conversation, message, call, files, index, signal);
                    this.emitMessage(conversation.id, message);
                    await save();
                }
                message.status = "done";
                this.emitMessage(conversation.id, message);
            }
        } catch (err) {
            if (current && current.status === "streaming") {
                const aborted = signal.aborted || (err as Error)?.name === "AbortError";
                current.status = aborted ? "stopped" : "error";
                if (!aborted) current.error = err instanceof Error ? err.message : String(err);
                for (const t of current.toolCalls ?? []) {
                    if (t.status === "awaiting-approval" || t.status === "running") {
                        t.status = "error";
                        t.result = aborted ? "Stopped by the user before it ran." : "Not run: the reply failed.";
                    }
                }
                this.emitMessage(conversation.id, current);
            }
            await save().catch((saveErr) => console.error("[ai] saving the failed reply failed:", String(saveErr)));
        }
    }

    /**
     * One prompt turn on a coding agent. The agent runs its own tools; what
     * it reports becomes rounds the chain already reads: text after tool
     * calls starts a new round, so the reply reads in the order it happened.
     * Permission requests wait in the approvals list like any action.
     */
    private async agentReply(conversation: Conversation, connection: Connection, user: UserMessage, signal: AbortSignal): Promise<void> {
        const { deps } = this;
        const label = connection.label;
        // the user's stop, or the turn's own failure (a reply that grew too
        // large): either cancels the agent's turn
        const turn = new AbortController();
        const onStop = () => turn.abort();
        signal.addEventListener("abort", onStop, { once: true });
        let failure: Error | null = null;
        const fail = (err: unknown) => {
            failure ??= err instanceof Error ? err : new Error(String(err));
            turn.abort();
        };

        const save = async () => {
            conversation.updatedAt = Date.now();
            deps.onSummaries(await deps.store.save(conversation));
        };
        const hadHistory = conversation.messages.length > 1;
        let round = this.startAssistant(conversation);
        const first = round;
        this.emitMessage(conversation.id, round);
        const calls = new Map<string, { record: ToolCallRecord; round: AssistantMessage }>();
        let recorded = 0;
        let unrecorded = 0;

        // text streams as deltas; structural changes as whole messages, coalesced
        let deltaTimer: ReturnType<typeof setTimeout> | null = null;
        const flushDelta = () => {
            if (deltaTimer) clearTimeout(deltaTimer);
            deltaTimer = null;
            deps.onDelta({
                seq: ++this.seq,
                conversationId: conversation.id,
                messageId: round.id,
                content: round.content,
                ...(round.thinking ? { thinking: round.thinking } : {}),
            });
        };
        const dirty = new Set<AssistantMessage>();
        let messageTimer: ReturnType<typeof setTimeout> | null = null;
        const flushMessages = () => {
            if (messageTimer) clearTimeout(messageTimer);
            messageTimer = null;
            for (const m of dirty) this.emitMessage(conversation.id, m);
            dirty.clear();
        };
        const changed = (m: AssistantMessage, now = false) => {
            dirty.add(m);
            if (now) flushMessages();
            else messageTimer ??= setTimeout(flushMessages, AGENT_MESSAGE_INTERVAL_MS);
        };

        const nextRoundForText = () => {
            if (!round.toolCalls?.length || conversation.messages.length >= MAX_MESSAGES) return;
            flushDelta();
            round.status = "done";
            changed(round, true);
            round = this.startAssistant(conversation);
            changed(round, true);
            save().catch((err) => console.error("[ai] saving an agent round failed:", String(err)));
        };

        const trackCall = (update: Record<string, unknown>, force: boolean): { record: ToolCallRecord; round: AssistantMessage } | undefined => {
            const agentId = typeof update.toolCallId === "string" ? update.toolCallId : "";
            const known = calls.get(agentId);
            if (known) {
                applyToolUpdate(known.record, update);
                return known;
            }
            if (!force && recorded >= MAX_AGENT_TOOL_CALLS) {
                unrecorded++;
                return undefined;
            }
            const record = toolRecordFrom(update);
            if (!record) return undefined;
            // agents number calls per session; the chat needs ids unique across chats
            record.id = newId();
            recorded++;
            flushDelta();
            (round.toolCalls ??= []).push(record);
            const entry = { record, round };
            calls.set(agentId, entry);
            return entry;
        };

        const onUpdate = (update: Record<string, unknown>) => {
            if (turn.signal.aborted) return;
            try {
                switch (update.sessionUpdate) {
                    case "agent_message_chunk":
                    case "agent_thought_chunk": {
                        const text = contentText(update.content);
                        if (!text) return;
                        nextRoundForText();
                        if (update.sessionUpdate === "agent_message_chunk") round.content += text;
                        else round.thinking = (round.thinking ?? "") + text;
                        if (round.content.length + (round.thinking?.length ?? 0) > MAX_REPLY_CHARS) {
                            throw new Error(`The reply passed ${MAX_REPLY_CHARS} characters and was stopped.`);
                        }
                        deltaTimer ??= setTimeout(flushDelta, DELTA_INTERVAL_MS);
                        return;
                    }
                    case "tool_call":
                    case "tool_call_update": {
                        const entry = trackCall(update, false);
                        if (entry) changed(entry.round, update.sessionUpdate === "tool_call");
                        return;
                    }
                    case "plan":
                        // one plan per turn, kept where the turn starts
                        first.plan = planFrom(update);
                        changed(first);
                        return;
                    default:
                        // user_message_chunk (replays), usage, session info: nothing to show
                        return;
                }
            } catch (err) {
                // never thrown into the protocol reader: the turn is cancelled instead
                fail(err);
            }
        };

        const requestPermission = async (toolCall: Record<string, unknown>, options: AgentPermissionOption[]): Promise<string | null> => {
            if (turn.signal.aborted) return null;
            const entry = trackCall(toolCall, true);
            if (!entry) return null;
            const { record } = entry;
            // No sandbox: the service answers for the user, with the agent's own allow option
            const allow = isNoSandboxMode(deps.agentMode(conversation.id)) ? autoAllowOption(options) : null;
            if (allow) {
                record.status = "running";
                flushDelta();
                changed(entry.round, true);
                return allow;
            }
            record.status = "awaiting-approval";
            flushDelta();
            changed(entry.round, true);
            save().catch((err) => console.error("[ai] saving a permission request failed:", String(err)));
            const answer = await new Promise<string | "cancelled">((resolve) => {
                const approval: PendingApproval = {
                    id: record.id,
                    conversationId: conversation.id,
                    messageId: entry.round.id,
                    panelId: "",
                    action: "",
                    label: record.label,
                    arguments: {},
                    options,
                };
                const settle = (d: string | "cancelled") => {
                    if (!this.waiting.delete(record.id)) return;
                    turn.signal.removeEventListener("abort", onAbort);
                    this.publishApprovals();
                    resolve(d);
                };
                const onAbort = () => settle("cancelled");
                this.waiting.set(record.id, {
                    approval,
                    // stop() cancels; an agent's request is never answered with once/always/deny
                    resolve: () => settle("cancelled"),
                    choose: (optionId) => settle(optionId),
                });
                turn.signal.addEventListener("abort", onAbort, { once: true });
                this.publishApprovals();
            });
            if (answer === "cancelled") {
                record.status = "error";
                record.result = "Stopped before you answered.";
                changed(entry.round, true);
                return null;
            }
            const kind = options.find((o) => o.id === answer)!.kind;
            if (kind === "reject_once" || kind === "reject_always") {
                record.status = "denied";
                record.decision = "deny";
            } else {
                record.status = "running";
                record.decision = kind === "allow_always" ? "always" : "once";
            }
            changed(entry.round, true);
            return answer;
        };

        let stopReason: StopReason | null = null;
        try {
            const opened = await deps.agents.openSession({
                conversationId: conversation.id,
                connection,
                cwd: await deps.projectPath(conversation.project!),
                ...(conversation.sessionId ? { sessionId: conversation.sessionId } : {}),
                ...(conversation.mode ? { mode: conversation.mode } : {}),
                ...(conversation.model ? { model: conversation.model } : {}),
            });
            if (!opened.resumed && hadHistory) {
                first.notice = `${label} started a new session here: it doesn't remember this chat's earlier messages.`;
                changed(first, true);
            }
            if (conversation.sessionId !== opened.sessionId) {
                conversation.sessionId = opened.sessionId;
                await save();
            }
            const blocks = promptBlocks(user.content, user.attachments ?? [], opened.capabilities, label);
            stopReason = await deps.agents.prompt(connection, opened.sessionId, blocks, { onUpdate, requestPermission }, turn.signal);
        } catch (err) {
            fail(err);
        } finally {
            signal.removeEventListener("abort", onStop);
            if (deltaTimer) flushDelta();
            flushMessages();
        }

        const endings: Partial<Record<StopReason, string>> = {
            refusal: `${label} declined to continue.`,
            max_tokens: `${label} ran out of room for this turn.`,
            max_turn_requests: `${label} reached its limit of steps for this turn.`,
        };
        // a failure outranks the "cancelled" it caused; the user's stop is not a failure
        const failed = failure ? (failure as Error).message : stopReason ? endings[stopReason] : undefined;
        if (failed && !(signal.aborted && !failure)) {
            round.status = "error";
            round.error = failed;
        } else {
            round.status = signal.aborted || stopReason === "cancelled" ? "stopped" : "done";
        }
        // a call the agent never closed is not shown as still running
        for (const { record } of calls.values()) {
            if (record.status === "running" || record.status === "awaiting-approval") {
                record.status = "error";
                record.result = round.status === "stopped" ? "Stopped by the user." : "The agent didn't report how this ended.";
            }
        }
        if (unrecorded > 0) {
            first.notice = [first.notice, `${unrecorded} more tool calls ran but are not recorded in this chat.`].filter(Boolean).join(" ");
            this.emitMessage(conversation.id, first);
        }
        for (const m of conversation.messages.slice(conversation.messages.indexOf(first))) {
            if (m.role === "assistant") this.emitMessage(conversation.id, m);
        }
        try {
            await save();
        } catch (err) {
            console.error("[ai] saving the agent's reply failed:", String(err));
            throw err;
        }
        if (round.status === "done") {
            const rounds = conversation.messages.slice(conversation.messages.indexOf(first)).filter((m): m is AssistantMessage => m.role === "assistant");
            deps.onReplyFinished({ conversationId: conversation.id, title: conversation.title, model: conversation.model, text: replyText(rounds) });
        }
    }

    private startAssistant(conversation: Conversation): AssistantMessage {
        const message: AssistantMessage = {
            id: newId(),
            role: "assistant",
            model: conversation.model,
            content: "",
            status: "streaming",
            createdAt: Date.now(),
        };
        conversation.messages.push(message);
        return message;
    }

    /** Streams one model turn; returns the tool calls it asked for. */
    private async stream(
        conversation: Conversation,
        message: AssistantMessage,
        history: ReturnType<typeof toOllamaMessages>,
        tools: ToolSet,
        capabilities: string[],
        think: boolean | string,
        signal: AbortSignal,
    ): Promise<{ name: string; arguments: unknown }[]> {
        const calls: { name: string; arguments: unknown }[] = [];
        let timer: ReturnType<typeof setTimeout> | null = null;
        const flush = () => {
            timer = null;
            this.deps.onDelta({
                seq: ++this.seq,
                conversationId: conversation.id,
                messageId: message.id,
                content: message.content,
                ...(message.thinking ? { thinking: message.thinking } : {}),
            });
        };
        const schedule = () => {
            if (!timer) timer = setTimeout(flush, DELTA_INTERVAL_MS);
        };
        try {
            // send() stamped the connection before any reply runs
            await this.deps.clientFor(conversation.provider ?? "").chat(
                {
                    model: conversation.model,
                    messages: history,
                    ...(tools.tools.length ? { tools: tools.tools } : {}),
                    ...(capabilities.includes("thinking") ? { think } : {}),
                    options: inferenceOptions(this.deps.settings().contextLength, this.deps.settings().forceCpu),
                },
                signal,
                (chunk: ChatChunk) => {
                    const m = chunk.message;
                    if (m?.content) message.content += m.content;
                    // Some templates (DeepSeek-R1 with tools, for example)
                    // reason even when think:false asked them not to. Keeping
                    // that reasoning would make the Think toggle a lie, so it
                    // is only recorded when the user asked for it.
                    if (think && m?.thinking) message.thinking = (message.thinking ?? "") + m.thinking;
                    for (const call of m?.tool_calls ?? []) {
                        if (call.function?.name) calls.push({ name: call.function.name, arguments: call.function.arguments });
                    }
                    if (message.content.length + (message.thinking?.length ?? 0) > MAX_REPLY_CHARS) {
                        throw new Error(`The reply passed ${MAX_REPLY_CHARS} characters and was stopped.`);
                    }
                    if (chunk.done && chunk.eval_count && chunk.eval_duration) {
                        const tps = chunk.eval_count / (chunk.eval_duration / 1e9);
                        message.stats = {
                            tokens: chunk.eval_count,
                            tokensPerSecond: Math.round(tps * 10) / 10,
                            ...(chunk.prompt_eval_count ? { promptTokens: chunk.prompt_eval_count } : {}),
                            contextLength: this.deps.settings().contextLength,
                        };
                        this.deps.onSpeed(conversation.model, tps);
                    }
                    schedule();
                },
            );
        } finally {
            if (timer) clearTimeout(timer);
            flush();
        }
        return calls;
    }

    private planCall(call: { name: string; arguments: unknown }, index: ActionIndex | null, offered: Set<string>): ToolCallRecord {
        const base = { id: newId(), tool: call.name };
        if (isBuiltinTool(call.name) && offered.has(call.name)) {
            const builtin = call.name;
            const record = { ...base, builtin, panelId: "", action: "", label: BUILTIN_LABELS[builtin] };
            try {
                return { ...record, arguments: builtinArguments(builtin, call.arguments), status: "awaiting-approval" };
            } catch (err) {
                if (!(err instanceof BuiltinArgumentError)) throw err;
                return { ...record, arguments: {}, status: "error", result: `Error: invalid arguments, ${err.message}.` };
            }
        }
        if (call.name !== CALL_APP_ACTION || !offered.has(call.name) || !index) {
            return {
                ...base,
                panelId: "",
                action: "",
                label: call.name,
                arguments: {},
                status: "error",
                result: `Error: there is no tool named "${call.name}".`,
            };
        }
        let resolved: ReturnType<typeof resolveActionCall>;
        try {
            resolved = resolveActionCall(index, call.arguments);
        } catch (err) {
            if (!(err instanceof ToolArgumentError)) throw err;
            return { ...base, panelId: "", action: "", label: "Unknown app action", arguments: {}, status: "error", result: `Error: ${err.message}.` };
        }
        const { target } = resolved;
        try {
            const args = prepareArguments(target, resolved.rawArguments);
            return { ...base, panelId: target.panelId, action: target.action, label: target.label, arguments: args, status: "awaiting-approval" };
        } catch (err) {
            if (!(err instanceof ToolArgumentError)) throw err;
            return {
                ...base,
                panelId: target.panelId,
                action: target.action,
                label: target.label,
                arguments: {},
                status: "error",
                result: `Error: invalid arguments, ${err.message}.`,
            };
        }
    }

    private async runCall(
        conversation: Conversation,
        message: AssistantMessage,
        call: ToolCallRecord,
        files: ProjectFiles | undefined,
        index: ActionIndex | null,
        signal: AbortSignal,
    ): Promise<void> {
        if (call.status !== "awaiting-approval") return; // already failed in planning
        const builtin = call.builtin;
        // planning only records offered built-ins; a retired kind never runs
        if (builtin && !isBuiltinTool(builtin)) throw new Error(`${BUILTIN_LABELS[builtin]} is no longer available.`);
        // file tools are only offered in a project
        if (builtin && isProjectTool(builtin) && !files) throw new Error(`${BUILTIN_LABELS[builtin]} needs a project.`);
        // a file change is worked out before anyone is asked: the card shows
        // the exact diff, and a change that can't apply fails without asking
        let change: PreparedChange | undefined;
        if (builtin === "write_file" || builtin === "edit_file") {
            try {
                change = await files!.prepareChange(builtin, call.arguments);
            } catch (err) {
                // handed back to the model as the failed call it is, like any tool error
                call.status = "error";
                call.result = `Error: ${err instanceof Error ? err.message : String(err)}`;
                return;
            }
            call.agent = change.details;
        } else if (builtin && isProjectTool(builtin)) {
            call.agent = { kind: builtin === "search_files" ? "search" : "read", locations: [String(call.arguments.path)], diffs: [] };
        }
        const key = builtin ? "" : permissionKey(call.panelId, call.action);
        let decision: ApprovalDecision | "cancelled" | "remembered" | "unasked";
        // the mode is read now, not when the reply started: a switch applies to the next call
        if (builtin ? !builtinAsks(builtin, conversation.mode) : isNoSandboxMode(conversation.mode)) {
            decision = "unasked";
        } else if (!builtin && this.deps.isAllowed(key)) {
            decision = "remembered";
        } else {
            this.emitMessage(conversation.id, message);
            decision = await new Promise<ApprovalDecision | "cancelled">((resolve) => {
                const approval: PendingApproval = {
                    id: call.id,
                    conversationId: conversation.id,
                    messageId: message.id,
                    panelId: call.panelId,
                    action: call.action,
                    label: call.label,
                    arguments: call.arguments,
                    ...(builtin ? { builtin } : {}),
                };
                const settle = (d: ApprovalDecision | "cancelled") => {
                    if (!this.waiting.delete(call.id)) return;
                    signal.removeEventListener("abort", onAbort);
                    this.publishApprovals();
                    resolve(d);
                };
                const onAbort = () => settle("cancelled");
                this.waiting.set(call.id, { approval, resolve: settle });
                signal.addEventListener("abort", onAbort, { once: true });
                this.publishApprovals();
            });
        }
        if (decision === "cancelled") throw new DOMException("Stopped", "AbortError");
        if (decision === "deny") {
            call.status = "denied";
            call.decision = "deny";
            call.result = "The user denied this action. Do not retry it; ask what they would like instead.";
            return;
        }
        if (decision === "always") await this.deps.rememberAllowed(key);
        if (decision !== "unasked") call.decision = decision;
        call.status = "running";
        this.emitMessage(conversation.id, message);
        try {
            if (builtin === "find_app_actions") {
                if (!index) throw new Error("The app actions were not read for this round.");
                call.result = formatToolResult(formatFoundActions(index, call.arguments.query as string));
            } else if (builtin === "run_shell_command") {
                call.result = formatToolResult(formatShellResult(await this.deps.runShell(call.arguments.command as string, signal, files?.root)));
            } else if (change) {
                call.result = formatToolResult(await change.apply());
            } else if (builtin === "read_file") {
                call.result = formatToolResult(await files!.readFile(call.arguments.path as string, (call.arguments.start_line as number | undefined) ?? 1));
            } else if (builtin === "list_directory") {
                call.result = formatToolResult(await files!.listDirectory(call.arguments.path as string));
            } else if (builtin === "search_files") {
                const { pattern, text } = call.arguments as { pattern?: string; text?: string };
                call.result = formatToolResult(await files!.search(call.arguments.path as string, { pattern, text }, signal));
            } else {
                call.result = formatToolResult(await this.deps.callAction(call.panelId, call.action, call.arguments));
            }
            call.status = "done";
        } catch (err) {
            call.status = "error";
            call.result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
    }
}

/**
 * One-shot answer for flows: no tools (nobody is there to approve them),
 * and a hard deadline under the action-call timeout so a slow model fails
 * loudly instead of being abandoned mid-generation.
 */
export async function askOnce(
    api: ChatClient,
    request: { model: string; prompt: string; system?: string; history?: readonly MemoryMessage[]; contextLength: number; forceCpu?: boolean },
    deadlineMs: number,
): Promise<string> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), deadlineMs);
    let text = "";
    try {
        await api.chat(
            {
                model: request.model,
                messages: [
                    ...(request.system?.trim() ? [{ role: "system" as const, content: request.system }] : []),
                    ...(request.history ?? []),
                    { role: "user" as const, content: request.prompt },
                ],
                options: inferenceOptions(request.contextLength, request.forceCpu ?? false),
            },
            abort.signal,
            (chunk) => {
                text += chunk.message?.content ?? "";
                if (text.length > MAX_REPLY_CHARS) throw new Error(`The answer passed ${MAX_REPLY_CHARS} characters.`);
            },
        );
    } catch (err) {
        if (abort.signal.aborted) {
            throw new Error(`${request.model} did not finish within ${Math.round(deadlineMs / 1000)} seconds.`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
    return text.trim();
}
