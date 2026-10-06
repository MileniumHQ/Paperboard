// Canonical names shared by the service and the UI. A name the UI uses
// that is missing here is a compile error, not a silent no-op at runtime.

import { OLLAMA_PROVIDER_ID, providerById } from "./core/providers";

export const PANEL_ID = "dev.paperboard.ai";

// supervised process ids share one daemon-wide namespace
export const OLLAMA_PROC_ID = `${PANEL_ID}.ollama`;
// the package id is the provider's own fact (core/providers.ts)
export const OLLAMA_PACKAGE = providerById(OLLAMA_PROVIDER_ID)!.runtime!.packageId;

/** Public actions: flow blocks other panels can call. */
export const ACTION_IDS = {
    ask: "ask",
    listModels: "list-models",
    downloadModel: "download-model",
    deleteModel: "delete-model",
} as const;

/** Control plane for this panel's own UI (internal, never flow blocks). */
export const UI_ACTION_IDS = {
    installRuntime: "ui-install-runtime",
    startRuntime: "ui-start-runtime",
    setProvider: "ui-set-provider",
    testProvider: "ui-test-provider",
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
} as const;

export const TRIGGER_IDS = {
    modelDownloaded: "model-downloaded",
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
