// The reply loop: stream a model's answer, and when it asks for a tool,
// stop and ask the user before any action runs. A denied, failed or
// interrupted call is handed back to the model as what it is.

import {
    MAX_MESSAGES,
    MAX_TOOL_ROUNDS,
    MAX_USER_MESSAGE_CHARS,
    newId,
    titleFrom,
    toOllamaMessages,
    systemPrompt,
} from "../core/conversation";
import {
    BUILTIN_APPROVAL,
    BUILTIN_LABELS,
    BuiltinArgumentError,
    builtinArguments,
    builtinTools,
    formatSearchResults,
    formatShellResult,
    isBuiltinTool,
    type SearchResult,
} from "../core/builtins";
import { validateAttachments } from "../core/attachments";
import { reasoningToThink, type ReasoningLevel } from "../core/reasoning";
import {
    buildToolSet,
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
    PendingApproval,
    Settings,
    ToolCallRecord,
} from "../core/types";
import type { ChatChunk } from "./ollamaClient";
import type { ChatClient } from "./provider";
import type { ConversationStore } from "./store";

export const MAX_ACTIVE_REPLIES = 3;
export const MAX_CALLS_PER_ROUND = 8;
export const MAX_REPLY_CHARS = 200_000;
const DELTA_INTERVAL_MS = 60;

export type ApprovalDecision = "once" | "always" | "deny";

export interface ChatDeps {
    ownPanelId: string;
    /** the transport for a conversation's provider */
    clientFor: (providerId: string) => ChatClient;
    /** which provider serves a model name */
    providerOf: (model: string) => string;
    store: ConversationStore;
    settings: () => Settings;
    capabilities: (model: string) => string[] | undefined;
    listActions: () => Promise<RegistryAction[]>;
    panelNames: () => Promise<Record<string, string>>;
    callAction: (panelId: string, action: string, args: Record<string, unknown>) => Promise<unknown>;
    isAllowed: (key: string) => boolean;
    rememberAllowed: (key: string) => Promise<void>;
    /** the built-in tools' effects */
    webSearch: (query: string, signal: AbortSignal) => Promise<SearchResult[]>;
    runShell: (command: string, signal: AbortSignal) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
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

    async create(model: string): Promise<Conversation> {
        const now = Date.now();
        const conversation: Conversation = { id: newId(), title: "New chat", model, createdAt: now, updatedAt: now, messages: [] };
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
        const model = conversation.model || this.deps.settings().defaultModel;
        if (!model) throw new Error("Choose a model for this chat first.");
        const capabilities = this.deps.capabilities(model);
        if (!capabilities) throw new Error(`${model} is not installed. Download it from Models.`);
        validateAttachments(attachments, { vision: capabilities.includes("vision") });
        this.deps.clientFor(this.deps.providerOf(model)); // throws when the provider is not reachable

        const user: ChatMessage = {
            id: newId(),
            role: "user",
            content,
            ...(attachments.length ? { attachments } : {}),
            createdAt: Date.now(),
        };
        conversation.model = model;
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
        const done = this.reply(conversation, abort.signal, capabilities.includes("thinking") ? reasoningToThink(reasoning) : false).finally(() => {
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

    resolveApproval(id: string, decision: ApprovalDecision): void {
        const w = this.waiting.get(id);
        if (!w) throw new Error("That request is no longer waiting for approval.");
        if (!["once", "always", "deny"].includes(decision)) throw new Error(`Unknown decision ${JSON.stringify(decision)}`);
        const builtin = w.approval.builtin;
        if (decision === "always" && builtin && !BUILTIN_APPROVAL[builtin].remember) {
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

    private async reply(conversation: Conversation, signal: AbortSignal, think: boolean | string): Promise<void> {
        const { deps } = this;
        const save = async () => {
            conversation.updatedAt = Date.now();
            deps.onSummaries(await deps.store.save(conversation));
        };
        let current: AssistantMessage | null = null;
        try {
            for (let round = 0; ; round++) {
                if (round >= MAX_TOOL_ROUNDS) {
                    const notice = this.startAssistant(conversation);
                    notice.status = "error";
                    notice.error = `Stopped after ${MAX_TOOL_ROUNDS} rounds of actions in one reply.`;
                    this.emitMessage(conversation.id, notice);
                    await save();
                    return;
                }
                const capabilities = deps.capabilities(conversation.model) ?? [];
                const settings = deps.settings();
                const canCall = capabilities.includes("tools");
                const panels: ToolSet =
                    canCall && settings.panelActions
                        ? buildToolSet(await deps.listActions(), deps.ownPanelId, await deps.panelNames())
                        : { tools: [], targets: new Map() };
                // built-ins first: they are the tools a model should reach for
                const tools: ToolSet = {
                    tools: [...(canCall ? builtinTools(settings) : []), ...panels.tools],
                    targets: panels.targets,
                };
                const offered = new Set(tools.tools.map((t) => t.function.name));
                const history = toOllamaMessages(
                    conversation.messages,
                    systemPrompt({
                        style: settings.promptStyle,
                        model: conversation.model,
                        webSearch: offered.has("web_search"),
                        shellCommands: offered.has("run_shell_command"),
                        panelActions: panels.tools.length > 0,
                    }),
                );

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

                message.toolCalls = calls.slice(0, MAX_CALLS_PER_ROUND).map((c) => this.planCall(c, tools, offered));
                this.emitMessage(conversation.id, message);
                await save();
                for (const call of message.toolCalls) {
                    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
                    await this.runCall(conversation, message, call, tools, signal);
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
            await this.deps.clientFor(this.deps.providerOf(conversation.model)).chat(
                {
                    model: conversation.model,
                    messages: history,
                    ...(tools.tools.length ? { tools: tools.tools } : {}),
                    ...(capabilities.includes("thinking") ? { think } : {}),
                    options: { num_ctx: this.deps.settings().contextLength },
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

    private planCall(call: { name: string; arguments: unknown }, tools: ToolSet, offered: Set<string>): ToolCallRecord {
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
        const target = tools.targets.get(call.name);
        if (!target) {
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
        try {
            const args = prepareArguments(target, call.arguments);
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
        _tools: ToolSet,
        signal: AbortSignal,
    ): Promise<void> {
        if (call.status !== "awaiting-approval") return; // already failed in planning
        const builtin = call.builtin;
        const key = builtin ? "" : permissionKey(call.panelId, call.action);
        let decision: ApprovalDecision | "cancelled" | "remembered" | "unasked";
        if (builtin && !BUILTIN_APPROVAL[builtin].ask) {
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
            if (builtin === "web_search") {
                const query = call.arguments.query as string;
                call.result = formatToolResult(formatSearchResults(query, await this.deps.webSearch(query, signal)));
            } else if (builtin === "run_shell_command") {
                call.result = formatToolResult(formatShellResult(await this.deps.runShell(call.arguments.command as string, signal)));
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
    request: { model: string; prompt: string; system?: string; contextLength: number },
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
                    { role: "user" as const, content: request.prompt },
                ],
                options: { num_ctx: request.contextLength },
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
