import { MAX_WIDGET_OPTION_VALUE_LENGTH, type ServiceCall } from "@mileniumhq/paperapi";
import { CALLS, WIDGET_CALLS } from "../contract";
import { isPromptStyle, MAX_USER_MESSAGE_CHARS } from "../core/conversation";
import { isReasoningLevel } from "../core/reasoning";
import type { AiState } from "../core/types";
import type { AiApp } from "./app";
import { optStr, str } from "./blocks";
import type { ApprovalDecision } from "./chat";

type Call = [name: string, handler: ServiceCall<AiState>];

function ui(name: string, _label: string, run: (inputs: any) => Promise<unknown>): Call {
    return [name, async (_ctx, input) => run(input ?? {})];
}

/** What the panel's page and widgets ask the service (bridge.call), by name. */
export function uiCalls(app: AiApp): Record<string, ServiceCall<AiState>> {
    const ready = async <T>(fn: () => Promise<T> | T) => {
        await app.ready;
        return fn();
    };
    return Object.fromEntries([
        ui(CALLS.installRuntime, "Install Local AI", () => ready(() => app.installRuntime())),
        ui(CALLS.startRuntime, "Start Local AI", () =>
            ready(() => {
                // the boot can outlive a request/response deadline; readiness
                // and failure travel through state.runtime, so acknowledge now
                void app.startIfInstalled().catch((err) => console.error("[ai] Ollama did not start:", String(err)));
                return { started: true };
            }),
        ),
        ui(CALLS.addConnection, "Add provider", (i) =>
            ready(() =>
                app.addConnection({ kind: i.kind, label: i.label, baseUrl: i.baseUrl, apiKey: i.apiKey, agent: i.agent, command: i.command, args: i.args }),
            ),
        ),
        ui(CALLS.updateConnection, "Change provider", (i) =>
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
        ui(CALLS.removeConnection, "Remove provider", (i) => ready(() => app.removeConnection(str(i.id, "id", 64)))),
        ui(CALLS.refreshModels, "Refresh models", () => ready(async () => void (await app.models.refresh()))),
        ui(CALLS.installedAgents, "Find installed agents", () => ready(() => app.installedAgents())),
        ui(CALLS.checkAgent, "Check agent", (i) => ready(() => app.checkAgent(i.id))),
        ui(CALLS.authenticateAgent, "Sign in to agent", (i) => ready(() => app.authenticateAgent(i.id, i.methodId))),
        ui(CALLS.setConversationProject, "Set chat project", (i) => ready(() => app.setConversationProject(str(i.id, "id", 64), i.project))),
        ui(CALLS.createProject, "Create project", (i) => ready(() => app.createProject(i.name))),
        ui(CALLS.setAgentMode, "Set agent mode", (i) => ready(() => app.setAgentMode(str(i.id, "id", 64), i.mode))),
        ui(CALLS.testConnection, "Test provider", (i) =>
            ready(() => app.testConnection({ id: i.id, baseUrl: i.baseUrl, apiKey: i.apiKey })),
        ),
        ui(CALLS.pullModel, "Download model", (i) =>
            ready(() => {
                // resolves when accepted; progress and failure travel in state
                const model = str(i.model, "model");
                app.runtime.requireApi();
                void app.models.pull(model).catch((err) => console.error(`[ai] download of ${model} failed:`, String(err)));
                return model;
            }),
        ),
        ui(CALLS.cancelPull, "Cancel download", (i) => ready(() => app.models.cancel(str(i.model, "model")))),
        ui(CALLS.deleteModel, "Delete model", (i) => ready(() => app.models.delete(str(i.model, "model")))),
        ui(CALLS.newConversation, "New chat", (i) => ready(() => app.newConversation(optStr(i.model, "model"), optStr(i.provider, "provider", 64)))),
        ui(CALLS.getConversation, "Open chat", (i) => ready(() => app.getConversation(str(i.id, "id", 64)))),
        ui(CALLS.renameConversation, "Rename chat", (i) =>
            ready(() => app.renameConversation(str(i.id, "id", 64), str(i.title, "title", 200))),
        ),
        ui(CALLS.rewindConversation, "Undo to a message", (i) =>
            ready(() => app.rewindConversation(str(i.id, "id", 64), str(i.messageId, "messageId", 64))),
        ),
        ui(CALLS.deleteConversation, "Delete chat", (i) => ready(() => app.deleteConversation(str(i.id, "id", 64)))),
        ui(CALLS.deleteAllConversations, "Delete all chats", () => ready(() => app.deleteAllConversations())),
        ui(CALLS.setConversationModel, "Set chat model", (i) =>
            ready(() => app.setConversationModel(str(i.id, "id", 64), str(i.model, "model"), optStr(i.provider, "provider", 64))),
        ),
        ui(CALLS.sendMessage, "Send message", (i) =>
            ready(async () => {
                const attachments = Array.isArray(i.attachments) ? i.attachments.filter((a: unknown) => a && typeof a === "object") : [];
                const { messageId } = await app.chat.send(str(i.id, "id", 64), typeof i.text === "string" ? i.text : "", {
                    ...(isReasoningLevel(i.reasoning) ? { reasoning: i.reasoning } : {}),
                    ...(attachments.length ? { attachments } : {}),
                });
                return { messageId };
            }),
        ),
        ui(CALLS.setChatEffort, "Set thinking level", (i) => ready(() => app.chat.setEffort(str(i.id, "id", 64), str(i.effort, "effort", 16)))),
        ui(CALLS.stopGeneration, "Stop reply", (i) => ready(() => app.chat.stop(str(i.id, "id", 64)))),
        ui(CALLS.resolveApproval, "Answer approval", (i) =>
            ready(() =>
                app.resolveApproval(str(i.id, "id", 64), (optStr(i.decision, "decision", 16) ?? "") as ApprovalDecision, optStr(i.optionId, "optionId", 200)),
            ),
        ),
        ui(CALLS.revokePermission, "Revoke permission", (i) => ready(() => app.revoke(str(i.key, "key", 400)))),
        ui(CALLS.setFavorite, "Favorite model", (i) =>
            ready(() => app.setFavorite({ provider: i.provider, model: i.model, favorite: i.favorite })),
        ),
        ui(CALLS.takeOpenRequest, "Take chat to open", () => ready(() => app.takeOpenRequest())),
        ui(WIDGET_CALLS.quickAsk, "Quick ask", (i) =>
            ready(() => app.quickAsk(str(i.text, "text", MAX_USER_MESSAGE_CHARS), optStr(i.model, "model", MAX_WIDGET_OPTION_VALUE_LENGTH))),
        ),
        ui(WIDGET_CALLS.loadedModels, "Loaded models", () => ready(() => app.loadedModels())),
        ui(WIDGET_CALLS.unloadModel, "Unload model", (i) => ready(() => app.unloadModel(str(i.model, "model")))),
        ui(CALLS.updateSettings, "Update settings", (i) =>
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
                    ...(typeof i.noSandboxWarning === "boolean" ? { noSandboxWarning: i.noSandboxWarning } : {}),
                }),
            ),
        ),
    ]);
}
