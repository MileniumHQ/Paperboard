// Canonical names shared by the service and the UI. A name the UI uses
// that is missing here is a compile error, not a silent no-op at runtime.

import { OLLAMA_PROVIDER } from "./core/providers";

export const PANEL_ID = "dev.paperboard.ai";

// supervised process ids share one daemon-wide namespace
export const OLLAMA_PROC_ID = `${PANEL_ID}.ollama`;
/** an agent connection's process; one per connection */
export function agentProcId(connectionId: string): string {
    return `${PANEL_ID}.agent.${connectionId}`;
}
// the package id is the provider's own fact (core/providers.ts)
export const OLLAMA_PACKAGE = OLLAMA_PROVIDER.runtime!.packageId;

/** What the panel's own page asks its service (bridge.call), by call name. */
export const CALLS = {
    installRuntime: "ui-install-runtime",
    startRuntime: "ui-start-runtime",
    addConnection: "ui-add-connection",
    updateConnection: "ui-update-connection",
    removeConnection: "ui-remove-connection",
    testConnection: "ui-test-connection",
    refreshModels: "ui-refresh-models",
    checkAgent: "ui-check-agent",
    installedAgents: "ui-installed-agents",
    authenticateAgent: "ui-authenticate-agent",
    setConversationProject: "ui-set-conversation-project",
    createProject: "ui-create-project",
    setAgentMode: "ui-set-agent-mode",
    setChatEffort: "ui-set-chat-effort",
    pullModel: "ui-pull-model",
    cancelPull: "ui-cancel-pull",
    deleteModel: "ui-delete-model",
    newConversation: "ui-new-conversation",
    getConversation: "ui-get-conversation",
    renameConversation: "ui-rename-conversation",
    deleteConversation: "ui-delete-conversation",
    deleteAllConversations: "ui-delete-all-conversations",
    rewindConversation: "ui-rewind-conversation",
    setConversationModel: "ui-set-conversation-model",
    sendMessage: "ui-send-message",
    stopGeneration: "ui-stop-generation",
    resolveApproval: "ui-resolve-approval",
    revokePermission: "ui-revoke-permission",
    updateSettings: "ui-update-settings",
    setFavorite: "ui-set-favorite",
    takeOpenRequest: "ui-take-open-request",
} as const;

/** What the Home widgets ask the service (widget.html), by call name. */
export const WIDGET_CALLS = {
    quickAsk: "widget-quick-ask",
    loadedModels: "widget-loaded-models",
    unloadModel: "widget-unload-model",
} as const;

/** Widget ids, as manifest.json declares them. */
export const WIDGET_IDS = {
    quickAsk: "quick-ask",
    loadedModel: "loaded-model",
} as const;

/** This panel's block events. */
export const EVENT_BLOCK_IDS = {
    replyFinished: "reply-finished",
} as const;

/** Service → UI events (besides state sync). */
export const EVENTS = {
    // the text so far (whole, not a diff) of a streaming assistant message
    chatDelta: "chat-delta",
    // a message was created or changed shape (tool calls, status)
    chatMessage: "chat-message",
    // a chat's messages were rewritten (rewind); open copies reload it
    chatReset: "chat-reset",
} as const;
