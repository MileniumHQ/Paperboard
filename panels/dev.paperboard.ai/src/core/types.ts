// Types shared by the service and the UI. Pure data: no SDK imports.

import type { ReasoningLevel } from "./reasoning";

export type RuntimeStatus =
    | "checking" // service booting, not yet looked
    | "missing" // the ollama package is not installed
    | "installing"
    | "stopped"
    | "starting"
    | "ready"
    | "error";

/** A compute device as Ollama itself reports it at startup. */
export interface ComputeDevice {
    library: string; // "CUDA", "ROCm", "Vulkan", "Metal", "cpu"
    name: string;
    totalBytes?: number;
    availableBytes?: number;
}

export interface RuntimeState {
    status: RuntimeStatus;
    /** the ollama package is on this computer (known once checked) */
    packageInstalled?: boolean;
    version?: string;
    error?: string;
    /** last lines of Ollama's output when it failed */
    errorDetail?: string;
    compute: ComputeDevice[];
    install?: { stage: string; percent: number };
}

export interface HardwareGpu {
    name: string;
    vendor: string;
    memoryTotalBytes?: number;
    unifiedMemory?: boolean;
}

export interface HardwareState {
    gpus: HardwareGpu[];
    ramBytes: number;
    /** probes that failed; the GPU list may be incomplete */
    errors: string[];
    loaded: boolean;
}

export interface InstalledModel {
    name: string; // "qwen3:8b"
    /** the provider that serves it: "ollama" today, more later */
    provider: string;
    sizeBytes: number;
    family?: string;
    parameterSize?: string;
    quantization?: string;
    capabilities: string[]; // from /api/show: "completion", "tools", "thinking", "vision"
    contextLength?: number;
    modifiedAt?: string;
    /** attention geometry for exact KV-cache sizing, when readable */
    architecture?: { layers: number; kvHeads: number; headDim: number };
}

export interface PullProgress {
    model: string;
    provider?: string;
    status: string;
    completedBytes: number;
    totalBytes: number;
    error?: string;
}

export interface ModelSpeed {
    tokensPerSecond: number;
    samples: number;
}

export interface Settings {
    defaultModel: string;
    contextLength: number;
    /** reasoning level used for models that can think */
    reasoning: ReasoningLevel;
    /** describe other panels' actions to the model (experimental) */
    panelActions: boolean;
    /** the built-in web search tool */
    webSearch: boolean;
    /** the built-in shell command tool, approved per run */
    shellCommands: boolean;
    /** run inference on the processor even when a GPU could host the model */
    forceCpu: boolean;
    /** which personality the system prompt gives the model */
    promptStyle: PromptStyle;
    customPromptEnabled: boolean;
    /** null until first enabled; empty while enabled is allowed, but enabling the toggle again refills it from the generated prompt. */
    customSystemPrompt: string | null;
}

export type ProviderChoice = "ollama" | "custom";

/**
 * Which provider the panel talks to. The API key never travels here: only
 * whether one is stored in the vault (the key itself stays a vault secret).
 */
export interface ProviderConfig {
    id: ProviderChoice;
    /** the custom endpoint URL, empty for Ollama */
    baseUrl: string;
    /** an API key is stored in the vault for the custom endpoint */
    hasApiKey: boolean;
    /** the user has completed provider setup */
    configured: boolean;
}

export type PromptStyle = "no-nonsense" | "standard" | "quirky" | "over-the-top";

/** A file or image the user attached to a message. */
export interface Attachment {
    id: string;
    name: string;
    kind: "image" | "text";
    mime: string;
    sizeBytes: number;
    /** text attachments: the converted text handed to the model */
    text?: string;
    /** image attachments: a downscaled data URL handed to the model */
    dataUrl?: string;
}

export interface ConversationSummary {
    id: string;
    title: string;
    model: string;
    updatedAt: number;
    messageCount: number;
}

export type ToolCallStatus = "awaiting-approval" | "running" | "done" | "denied" | "error";

export type BuiltinTool = "web_search" | "run_shell_command";

export interface ToolCallRecord {
    id: string;
    /** set for the panel's own tools; panelId and action are then empty */
    builtin?: BuiltinTool;
    /** the function name the model used */
    tool: string;
    panelId: string;
    action: string;
    /** human label: "Start Server" */
    label: string;
    arguments: Record<string, unknown>;
    status: ToolCallStatus;
    /** stringified result or error, as it was handed back to the model */
    result?: string;
    decision?: "once" | "always" | "remembered" | "deny";
}

export interface UserMessage {
    id: string;
    role: "user";
    content: string;
    attachments?: Attachment[];
    createdAt: number;
}

export type AssistantStatus = "streaming" | "done" | "stopped" | "error";

export interface AssistantMessage {
    id: string;
    role: "assistant";
    model: string;
    content: string;
    thinking?: string;
    toolCalls?: ToolCallRecord[];
    status: AssistantStatus;
    error?: string;
    createdAt: number;
    stats?: {
        tokens: number;
        tokensPerSecond: number;
        /** prompt tokens read this round, when the provider reports them */
        promptTokens?: number;
        /** the context window the round ran with */
        contextLength?: number;
    };
}

export type ChatMessage = UserMessage | AssistantMessage;

export interface Conversation {
    id: string;
    title: string;
    model: string;
    createdAt: number;
    updatedAt: number;
    messages: ChatMessage[];
}

// Live chat events. `seq` orders every event the service emits against the
// snapshot an opening window loads: events at or below a snapshot's `seq`
// are already in it, later ones are not.

/** A message was created or changed shape (tool calls, status). */
export interface ChatMessageEvent {
    seq: number;
    conversationId: string;
    message: ChatMessage;
}

/** The streaming text so far (whole, not a diff) of an assistant message. */
export interface ChatDeltaEvent {
    seq: number;
    conversationId: string;
    messageId: string;
    content: string;
    thinking?: string;
}

/** A chat's messages were rewritten (rewind); open copies must reload. */
export interface ChatResetEvent {
    seq: number;
    conversationId: string;
}

/** A conversation as it is right now, ordered against the live events. */
export interface ConversationSnapshot {
    seq: number;
    conversation: Conversation;
}

export interface PendingApproval {
    id: string; // the tool call id
    conversationId: string;
    messageId: string;
    panelId: string;
    action: string;
    label: string;
    arguments: Record<string, unknown>;
    /** a built-in tool; its approval rules are fixed (BUILTIN_APPROVAL) */
    builtin?: BuiltinTool;
}

export interface AiState {
    runtime: RuntimeState;
    /** the active provider and how the panel reaches it */
    provider: ProviderConfig;
    hardware: HardwareState;
    models: InstalledModel[];
    pulls: PullProgress[];
    speeds: Record<string, ModelSpeed>;
    conversations: ConversationSummary[];
    /** conversation ids with a reply in flight */
    generating: string[];
    approvals: PendingApproval[];
    /** "panelId:action" keys the user allowed always */
    alwaysAllowed: string[];
    settings: Settings;
    /** conversation history could not be read; writes are refused */
    storageError?: string;
}

export const DEFAULT_SETTINGS: Settings = {
    defaultModel: "",
    contextLength: 32768,
    reasoning: "off",
    panelActions: false,
    webSearch: true,
    shellCommands: true,
    forceCpu: false,
    promptStyle: "standard",
    customPromptEnabled: false,
    customSystemPrompt: null,
};

export function initialState(): AiState {
    return {
        runtime: { status: "checking", compute: [] },
        provider: { id: "ollama", baseUrl: "", hasApiKey: false, configured: false },
        hardware: { gpus: [], ramBytes: 0, errors: [], loaded: false },
        models: [],
        pulls: [],
        speeds: {},
        conversations: [],
        generating: [],
        approvals: [],
        alwaysAllowed: [],
        settings: { ...DEFAULT_SETTINGS },
    };
}
