import { actionsApi, defineAction, type ActionDefinition } from "@paperboard-dev/paperapi";
import { ACTION_IDS, PANEL_ID, TRIGGER_IDS, UI_ACTION_IDS } from "../contract";
import { isPromptStyle, PROMPT_STYLES, PROMPT_STYLE_DESCRIPTIONS, PROMPT_STYLE_LABELS } from "../core/conversation";
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
    return app.models.list.map((m) => ({ label: m.name, value: m.name }));
}

const personalityOptions = PROMPT_STYLES.map((style) => ({
    label: PROMPT_STYLE_LABELS[style],
    value: style,
    description: PROMPT_STYLE_DESCRIPTIONS[style],
}));

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
                "Asks a local model and returns its answer. The model gets no actions here, since nobody is present to approve them. Fails if the answer takes longer than 28 seconds.",
            template: "Ask AI {prompt}",
            inputs: {
                prompt: { type: "string", label: "Prompt", required: true, placeholder: "Prompt" },
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
            },
            output: { type: "string", label: "Answer" },
            icon: "smart_toy",
            run: async (_ctx, inputs: { prompt?: string; model?: string; personality?: string }) => {
                await app.ready;
                return app.ask(
                    str(inputs?.prompt, "prompt", 32_000),
                    optStr(inputs?.model, "model"),
                    undefined,
                    isPromptStyle(inputs?.personality) ? inputs.personality : undefined,
                );
            },
        }),
        defineAction({
            id: ACTION_IDS.listModels,
            name: "List Models",
            category: "AI",
            description: "Returns the names of the models downloaded in the AI panel, one per line",
            template: "List AI models",
            inputs: {},
            output: { type: "string", label: "Models" },
            icon: "list",
            run: async () => {
                await app.ready;
                app.runtime.requireApi();
                return (await app.models.refresh()).map((m) => m.name).join("\n");
            },
        }),
        defineAction({
            id: ACTION_IDS.downloadModel,
            name: "Download Model",
            category: "AI",
            description:
                "Starts downloading a model from the Ollama library. Returns once the download has started; When Model Downloaded fires when it finishes.",
            template: "Download AI model {model}",
            inputs: { model: { type: "string", label: "Model", required: true, placeholder: "Model ID" } },
            output: { type: "string", label: "Model" },
            icon: "download",
            run: async (_ctx, inputs: { model?: string }) => {
                await app.ready;
                const model = str(inputs?.model, "model");
                app.runtime.requireApi();
                // the download outlives this call; its failure is logged and
                // shown in the panel, and the trigger only fires on success
                void app.models.pull(model).catch((err) => console.error(`[ai] download of ${model} failed:`, String(err)));
                return model;
            },
        }),
        defineAction({
            id: ACTION_IDS.deleteModel,
            name: "Delete Model",
            category: "AI",
            description: "Deletes a downloaded model and frees its disk space",
            template: "Delete AI model {model}",
            inputs: { model: { type: "string", label: "Model", required: true, placeholder: "qwen3:8b", options: models } },
            output: { type: "string", label: "Model" },
            icon: "delete",
            run: async (_ctx, inputs: { model?: string }) => {
                await app.ready;
                const model = str(inputs?.model, "model");
                await app.models.delete(model);
                return model;
            },
        }),
        defineAction({
            id: TRIGGER_IDS.modelDownloaded,
            name: "When Model Downloaded",
            category: "AI",
            description: "Fires when a model finishes downloading. Leave the model as (any) to fire for every model.",
            template: "When AI model {model} finishes downloading",
            inputs: { model: modelInput() },
            // the payload is the model name itself
            match: { field: "$", input: "model" },
            output: { type: "string", label: "Model" },
            icon: "download_done",
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
        ui(UI_ACTION_IDS.startRuntime, "Start Ollama", () => ready(() => app.startRuntime())),
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
        ui(UI_ACTION_IDS.newConversation, "New chat", (i) => ready(() => app.newConversation(optStr(i.model, "model")))),
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
            ready(() => app.setConversationModel(str(i.id, "id", 64), str(i.model, "model"))),
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
            ready(() => app.resolveApproval(str(i.id, "id", 64), str(i.decision, "decision", 16) as ApprovalDecision)),
        ),
        ui(UI_ACTION_IDS.revokePermission, "Revoke permission", (i) => ready(() => app.revoke(str(i.key, "key", 400)))),
        ui(UI_ACTION_IDS.updateSettings, "Update settings", (i) =>
            ready(() =>
                app.updateSettings({
                    ...(typeof i.defaultModel === "string" ? { defaultModel: i.defaultModel } : {}),
                    ...(typeof i.contextLength === "number" ? { contextLength: i.contextLength } : {}),
                    ...(isReasoningLevel(i.reasoning) ? { reasoning: i.reasoning } : {}),
                    ...(typeof i.panelActions === "boolean" ? { panelActions: i.panelActions } : {}),
                    ...(typeof i.webSearch === "boolean" ? { webSearch: i.webSearch } : {}),
                    ...(typeof i.shellCommands === "boolean" ? { shellCommands: i.shellCommands } : {}),
                    ...(isPromptStyle(i.promptStyle) ? { promptStyle: i.promptStyle } : {}),
                }),
            ),
        ),
    ];
}
