import { actionsApi, defineAction, MAX_WIDGET_OPTION_VALUE_LENGTH, type ActionDefinition } from "@mileniumhq/paperapi";
import { MAX_MEMORY_KEY_CHARS } from "../core/askMemory";
import { ACTION_IDS, PANEL_ID, TRIGGER_IDS, UI_ACTION_IDS, WIDGET_ACTION_IDS } from "../contract";
import { isPromptStyle, MAX_USER_MESSAGE_CHARS, PROMPT_STYLES, PROMPT_STYLE_DESCRIPTIONS, PROMPT_STYLE_LABELS } from "../core/conversation";
import { isReasoningLevel } from "../core/reasoning";
import type { AiApp } from "./app";
import type { ApprovalDecision } from "./chat";

function str(value: unknown, name: string, max = 200): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
    if (value.length > max) throw new Error(`${name} is limited to ${max} characters`);
    return value.trim();
}

function optStr(value: unknown, name: string, max = 200): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    return str(value, name, max);
}

// ─── public: flow blocks and AI-panel services for other apps ───────────────

/**
 * The model inputs' dropdown options. Registered models change (downloads,
 * deletes), so the same builder feeds the initial registration and every
 * republish — one list, never a stale copy.
 */
function modelOptions(app: AiApp): { label: string; value: string }[] {
    // coding agents answer in chats, never in flows
    return app.models.list.filter((m) => !m.capabilities.includes("agent")).map((m) => ({ label: m.name, value: m.name }));
}

const personalityOptions = PROMPT_STYLES.map((style) => ({
    label: PROMPT_STYLE_LABELS[style],
    value: style,
    description: PROMPT_STYLE_DESCRIPTIONS[style],
}));

const MAX_PROMPT_CHARS = 32_000;
const MAX_INSTRUCTIONS_CHARS = 8_000;

export function publicActions(app: AiApp): ActionDefinition[] {
    const models = modelOptions(app);
    const modelInput = (label = "Model") => ({
        type: "string",
        label,
        allowEmpty: true,
        emptyLabel: "(any)",
        options: models,
    });
    return [
        defineAction({
            id: ACTION_IDS.ask,
            name: "Ask AI",
            category: "AI",
            description:
                "Asks a model and returns its answer. Give a memory key to continue a conversation: calls with the same key (a channel, a player, a ticket) see the earlier questions and answers. The model gets no actions here, since nobody is present to approve them. Fails if the answer takes longer than 28 seconds.",
            template: "Ask AI {prompt}",
            inputs: {
                prompt: { type: "string", label: "Prompt", required: true, placeholder: "Prompt", maxLength: MAX_PROMPT_CHARS, multiline: true },
                model: {
                    type: "string",
                    label: "Model",
                    allowEmpty: true,
                    emptyLabel: "Default model",
                    options: models,
                },
                personality: {
                    type: "string",
                    label: "Personality",
                    default: "standard",
                    options: personalityOptions,
                },
                instructions: {
                    type: "string",
                    label: "Instructions",
                    description: "Who the AI is and how it answers here, added to the personality.",
                    placeholder: "You are the helper for our server. Answer in two sentences.",
                    maxLength: MAX_INSTRUCTIONS_CHARS,
                    multiline: true,
                },
                memory: {
                    type: "string",
                    label: "Memory key",
                    description: "Calls with the same key continue one conversation. Leave empty to ask without memory.",
                    placeholder: "No memory",
                    maxLength: MAX_MEMORY_KEY_CHARS,
                },
            },
            output: { type: "string", label: "Answer" },
            icon: "smart_toy",
            run: async (_ctx, inputs: { prompt?: string; model?: string; personality?: string; instructions?: string; memory?: string }) => {
                await app.ready;
                if (inputs?.personality !== undefined && inputs.personality !== "" && !isPromptStyle(inputs.personality)) {
                    throw new Error(`Unknown personality ${JSON.stringify(inputs.personality)}.`);
                }
                return app.ask(
                    str(inputs?.prompt, "prompt", MAX_PROMPT_CHARS),
                    optStr(inputs?.model, "model"),
                    optStr(inputs?.instructions, "instructions", MAX_INSTRUCTIONS_CHARS),
                    isPromptStyle(inputs?.personality) ? inputs.personality : undefined,
                    optStr(inputs?.memory, "memory", MAX_MEMORY_KEY_CHARS),
                );
            },
        }),
        defineAction({
            id: ACTION_IDS.forgetMemory,
            name: "Forget Memory",
            category: "AI",
            description: "Clears what Ask AI remembers for a memory key, so the next ask with it starts a new conversation. Returns whether there was anything to forget.",
            template: "Forget AI memory {memory}",
            inputs: { memory: { type: "string", label: "Memory key", required: true, maxLength: MAX_MEMORY_KEY_CHARS } },
            output: { type: "boolean", label: "Forgot" },
            icon: "history_toggle_off",
            run: async (_ctx, inputs: { memory?: string }) => {
                await app.ready;
                return app.forgetMemory(str(inputs?.memory, "memory", MAX_MEMORY_KEY_CHARS));
            },
        }),
        defineAction({
            id: ACTION_IDS.listModels,
            name: "List Models",
            category: "AI",
            description: "Returns the models Ask AI can use, across every provider in the AI panel.",
            template: "List AI models",
            inputs: {},
            output: { type: "list<string>", label: "Models" },
            icon: "list",
            run: async () => {
                await app.ready;
                return app.flowModels();
            },
        }),
        defineAction({
            id: TRIGGER_IDS.replyFinished,
            name: "When AI Replies",
            category: "AI",
            description: "Fires when a chat in the AI panel finishes a reply. Leave the model as (any) to fire for every reply.",
            template: "When AI model {model} finishes replying",
            inputs: { model: modelInput() },
            match: { field: "model", input: "model" },
            output: { type: "object", label: "Reply" },
            outputFields: {
                text: { type: "string", label: "Text" },
                title: { type: "string", label: "Chat" },
                model: { type: "string", label: "Model" },
                conversationId: { type: "string", label: "Chat id" },
            },
            icon: "forum",
        }),
    ];
}

/**
 * Re-registers the public actions so their model dropdowns track the
 * installed-model list. Called on every model-list change (download finished,
 * delete, refresh): one schema source, republished as data changes.
 */
export async function republishPublicActions(app: AiApp): Promise<void> {
    for (const def of publicActions(app)) {
        try {
            await actionsApi.register(def, undefined, PANEL_ID);
        } catch (err) {
            console.error(`[ai] failed to republish action "${def.id}":`, String(err));
        }
    }
}

// ─── internal: this panel's UI ──────────────────────────────────────────────

function ui(id: string, name: string, run: (inputs: any) => Promise<unknown>): ActionDefinition {
    return defineAction({ id, name, internal: true, description: name, inputs: {}, run: async (_ctx, inputs) => run(inputs ?? {}) });
}

export function uiActions(app: AiApp): ActionDefinition[] {
    const ready = async <T>(fn: () => Promise<T> | T) => {
        await app.ready;
        return fn();
    };
    return [
        ui(UI_ACTION_IDS.installRuntime, "Install Ollama", () => ready(() => app.installRuntime())),
        ui(UI_ACTION_IDS.startRuntime, "Start Ollama", () =>
            ready(() => {
                // the boot can outlive a request/response deadline; readiness
                // and failure travel through state.runtime, so acknowledge now
                void app.startIfInstalled().catch((err) => console.error("[ai] Ollama did not start:", String(err)));
                return { started: true };
            }),
        ),
        ui(UI_ACTION_IDS.addConnection, "Add provider", (i) =>
            ready(() =>
                app.addConnection({ kind: i.kind, label: i.label, baseUrl: i.baseUrl, apiKey: i.apiKey, agent: i.agent, command: i.command, args: i.args }),
            ),
        ),
        ui(UI_ACTION_IDS.updateConnection, "Change provider", (i) =>
            ready(() =>
                app.updateConnection({
                    id: i.id,
                    label: i.label,
                    baseUrl: i.baseUrl,
                    apiKey: i.apiKey,
                    clearApiKey: i.clearApiKey,
                    command: i.command,
                    args: i.args,
                }),
            ),
        ),
        ui(UI_ACTION_IDS.removeConnection, "Remove provider", (i) => ready(() => app.removeConnection(str(i.id, "id", 64)))),
        ui(UI_ACTION_IDS.refreshModels, "Refresh models", () => ready(async () => void (await app.models.refresh()))),
        ui(UI_ACTION_IDS.installedAgents, "Find installed agents", () => ready(() => app.installedAgents())),
        ui(UI_ACTION_IDS.checkAgent, "Check agent", (i) => ready(() => app.checkAgent(i.id))),
        ui(UI_ACTION_IDS.authenticateAgent, "Sign in to agent", (i) => ready(() => app.authenticateAgent(i.id, i.methodId))),
        ui(UI_ACTION_IDS.setConversationFolder, "Set chat folder", (i) => ready(() => app.setConversationFolder(str(i.id, "id", 64), i.folder))),
        ui(UI_ACTION_IDS.setAgentMode, "Set agent mode", (i) => ready(() => app.setAgentMode(str(i.id, "id", 64), i.mode))),
        ui(UI_ACTION_IDS.testConnection, "Test provider", (i) =>
            ready(() => app.testConnection({ id: i.id, baseUrl: i.baseUrl, apiKey: i.apiKey })),
        ),
        ui(UI_ACTION_IDS.pullModel, "Download model", (i) =>
            ready(() => {
                // resolves when accepted; progress and failure travel in state
                const model = str(i.model, "model");
                app.runtime.requireApi();
                void app.models.pull(model).catch((err) => console.error(`[ai] download of ${model} failed:`, String(err)));
                return model;
            }),
        ),
        ui(UI_ACTION_IDS.cancelPull, "Cancel download", (i) => ready(() => app.models.cancel(str(i.model, "model")))),
        ui(UI_ACTION_IDS.deleteModel, "Delete model", (i) => ready(() => app.models.delete(str(i.model, "model")))),
        ui(UI_ACTION_IDS.newConversation, "New chat", (i) => ready(() => app.newConversation(optStr(i.model, "model"), optStr(i.provider, "provider", 64)))),
        ui(UI_ACTION_IDS.getConversation, "Open chat", (i) => ready(() => app.getConversation(str(i.id, "id", 64)))),
        ui(UI_ACTION_IDS.renameConversation, "Rename chat", (i) =>
            ready(() => app.renameConversation(str(i.id, "id", 64), str(i.title, "title", 200))),
        ),
        ui(UI_ACTION_IDS.rewindConversation, "Undo to a message", (i) =>
            ready(() => app.rewindConversation(str(i.id, "id", 64), str(i.messageId, "messageId", 64))),
        ),
        ui(UI_ACTION_IDS.deleteConversation, "Delete chat", (i) => ready(() => app.deleteConversation(str(i.id, "id", 64)))),
        ui(UI_ACTION_IDS.deleteAllConversations, "Delete all chats", () => ready(() => app.deleteAllConversations())),
        ui(UI_ACTION_IDS.setConversationModel, "Set chat model", (i) =>
            ready(() => app.setConversationModel(str(i.id, "id", 64), str(i.model, "model"), optStr(i.provider, "provider", 64))),
        ),
        ui(UI_ACTION_IDS.sendMessage, "Send message", (i) =>
            ready(async () => {
                const attachments = Array.isArray(i.attachments) ? i.attachments.filter((a: unknown) => a && typeof a === "object") : [];
                const { messageId } = await app.chat.send(str(i.id, "id", 64), typeof i.text === "string" ? i.text : "", {
                    ...(isReasoningLevel(i.reasoning) ? { reasoning: i.reasoning } : {}),
                    ...(attachments.length ? { attachments } : {}),
                });
                return { messageId };
            }),
        ),
        ui(UI_ACTION_IDS.stopGeneration, "Stop reply", (i) => ready(() => app.chat.stop(str(i.id, "id", 64)))),
        ui(UI_ACTION_IDS.resolveApproval, "Answer approval", (i) =>
            ready(() =>
                app.resolveApproval(str(i.id, "id", 64), (optStr(i.decision, "decision", 16) ?? "") as ApprovalDecision, optStr(i.optionId, "optionId", 200)),
            ),
        ),
        ui(UI_ACTION_IDS.revokePermission, "Revoke permission", (i) => ready(() => app.revoke(str(i.key, "key", 400)))),
        ui(UI_ACTION_IDS.takeOpenRequest, "Take chat to open", () => ready(() => app.takeOpenRequest())),
        ui(WIDGET_ACTION_IDS.quickAsk, "Quick ask", (i) =>
            ready(() => app.quickAsk(str(i.text, "text", MAX_USER_MESSAGE_CHARS), optStr(i.model, "model", MAX_WIDGET_OPTION_VALUE_LENGTH))),
        ),
        ui(WIDGET_ACTION_IDS.loadedModels, "Loaded models", () => ready(() => app.loadedModels())),
        ui(WIDGET_ACTION_IDS.unloadModel, "Unload model", (i) => ready(() => app.unloadModel(str(i.model, "model")))),
        ui(UI_ACTION_IDS.updateSettings, "Update settings", (i) =>
            ready(() =>
                app.updateSettings({
                    ...(typeof i.defaultModel === "string" ? { defaultModel: i.defaultModel } : {}),
                    ...(typeof i.defaultProvider === "string" ? { defaultProvider: i.defaultProvider } : {}),
                    ...(typeof i.contextLength === "number" ? { contextLength: i.contextLength } : {}),
                    ...(isReasoningLevel(i.reasoning) ? { reasoning: i.reasoning } : {}),
                    ...(typeof i.panelActions === "boolean" ? { panelActions: i.panelActions } : {}),
                    ...(typeof i.shellCommands === "boolean" ? { shellCommands: i.shellCommands } : {}),
                    ...(typeof i.forceCpu === "boolean" ? { forceCpu: i.forceCpu } : {}),
                    ...(isPromptStyle(i.promptStyle) ? { promptStyle: i.promptStyle } : {}),
                    ...(typeof i.customPromptEnabled === "boolean" ? { customPromptEnabled: i.customPromptEnabled } : {}),
                    ...(typeof i.customSystemPrompt === "string" ? { customSystemPrompt: i.customSystemPrompt } : {}),
                }),
            ),
        ),
    ];
}
