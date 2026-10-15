// Types shared by the service and the UI. Pure data: no SDK imports.

import type { ReasoningLevel } from "./reasoning";
import type { Connection } from "./providers";
import type { FavoriteModel } from "./favorites";

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
    /** what the model is called when its id is not a name (an agent's "opus" is "Opus 5.5") */
    label?: string;
    description?: string;
    /** the connection that serves it ("ollama" or an endpoint id) */
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
    /** the connection serving defaultModel; empty means the first that lists it */
    defaultProvider: string;
    contextLength: number;
    /** reasoning level used for models that can think */
    reasoning: ReasoningLevel;
    /** let the model search other panels' actions and ask to run them */
    panelActions: boolean;
    /** the built-in shell command tool, approved per run */
    shellCommands: boolean;
    /** run inference on the processor even when a GPU could host the model */
    forceCpu: boolean;
    /** which personality the system prompt gives the model */
    promptStyle: PromptStyle;
    customPromptEnabled: boolean;
    /** null until first enabled; empty while enabled is allowed, but enabling the toggle again refills it from the generated prompt. */
    customSystemPrompt: string | null;
    /** ask before a chat turns on No sandbox; off once the user picks "Do not show again" */
    noSandboxWarning: boolean;
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
    provider?: string;
    project?: string;
    updatedAt: number;
    messageCount: number;
}

export type ToolCallStatus = "awaiting-approval" | "running" | "done" | "denied" | "error";

/** the file tools a Local AI chat is offered in a project (core/projectTools.ts) */
export type ProjectToolName = "read_file" | "list_directory" | "search_files" | "write_file" | "edit_file";
/** every built-in kind a chat may have recorded; web_search is no longer offered */
export type BuiltinTool = "web_search" | "run_shell_command" | "find_app_actions" | ProjectToolName;
/** the built-ins a model can be offered */
export type OfferedBuiltin = "run_shell_command" | "find_app_actions" | ProjectToolName;

/** What an agent says a tool call does (ACP ToolKind); picks its icon. */
export type AgentToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other";

/** A file change an agent proposed or made. */
export interface AgentDiff {
    path: string;
    /** null for a new file */
    oldText: string | null;
    newText: string;
    /** the texts were cut to fit the chat */
    truncated?: boolean;
}

/** The parts of a tool call only an agent reports. */
export interface AgentToolDetails {
    kind: AgentToolKind;
    /** files it touches */
    locations: string[];
    diffs: AgentDiff[];
    /** a shell command it runs, when it said so */
    command?: string;
    /** the tool's text output so far */
    output?: string;
}

export interface ToolCallRecord {
    id: string;
    /** set when a coding agent ran the tool itself; panelId and action are then empty */
    agent?: AgentToolDetails;
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

export type PlanStatus = "pending" | "in_progress" | "completed";

export interface PlanEntry {
    content: string;
    status: PlanStatus;
}

export interface AssistantMessage {
    id: string;
    role: "assistant";
    model: string;
    content: string;
    thinking?: string;
    toolCalls?: ToolCallRecord[];
    /** an agent's plan for the turn, as it last reported it */
    plan?: PlanEntry[];
    /** something the reader should know about this reply (an agent's session restarted) */
    notice?: string;
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
    /** the connection the chat runs on; set at the first message when absent */
    provider?: string;
    /** the project the chat works in (files/agent/<project>): an agent's folder, or Local AI's file tools' */
    project?: string;
    /** agent chats: the agent's session, resumed when the agent can load it */
    sessionId?: string;
    /** the mode the user picked: an agent's own mode ids, or Local AI's (LOCAL_MODES) */
    mode?: string;
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
    /** a built-in tool; it asks by its kind and the chat's mode (builtinAsks) */
    builtin?: OfferedBuiltin;
    /** an agent's permission request: the answers it offers, in its order */
    options?: AgentPermissionOption[];
}

export type AgentPermissionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

export interface AgentPermissionOption {
    id: string;
    name: string;
    kind: AgentPermissionKind;
}

export type AgentStatus =
    | "stopped" // not running; starts with the next message
    | "starting"
    | "ready"
    | "auth-required"
    | "error";

/** A way an agent offers to sign in (ACP authMethods). */
export interface AgentAuthMethod {
    id: string;
    name: string;
    description?: string;
}

/** An agent connection's process, as the service observes it. */
export interface AgentState {
    status: AgentStatus;
    error?: string;
    /** last lines the agent printed to stderr when it failed */
    errorDetail?: string;
    authMethods?: AgentAuthMethod[];
    /** what the agent says it is (initialize's agentInfo) */
    name?: string;
    version?: string;
}

export interface AgentMode {
    id: string;
    name: string;
    description?: string;
}

export interface AgentCommand {
    name: string;
    description: string;
    /** what to type after the command, when it takes input */
    hint?: string;
}

/** A live agent session's extras, for the chat that owns it. */
/** A model a coding agent offers, as the agent names it. */
export interface AgentModel {
    id: string;
    name: string;
    description?: string;
}

export interface AgentSessionInfo {
    modes: AgentMode[];
    mode?: string;
    commands: AgentCommand[];
}

/** A model Ollama holds in memory right now (its /api/ps). */
export interface LoadedModel {
    name: string;
    /** bytes in memory, on the GPU and in RAM together */
    sizeBytes: number;
    /** the part of sizeBytes on the GPU */
    vramBytes: number;
    /** when Ollama unloads it if it stays idle */
    expiresAt?: string;
}

/**
 * What the Loaded model widget can show. Only Ollama reports and unloads the
 * models in memory; a URL endpoint is `unsupported`, never "nothing loaded".
 */
export type LoadedModelsReport =
    | { status: "ok"; models: LoadedModel[] }
    | { status: "stopped"; runtime: RuntimeStatus }
    | { status: "unsupported"; provider: string };

export interface AiState {
    runtime: RuntimeState;
    /** the providers the user added; none means setup has not run */
    connections: Connection[];
    hardware: HardwareState;
    models: InstalledModel[];
    /** connection id → why its models could not be listed */
    modelErrors: Record<string, string>;
    pulls: PullProgress[];
    speeds: Record<string, ModelSpeed>;
    conversations: ConversationSummary[];
    /** conversation ids with a reply in flight */
    generating: string[];
    approvals: PendingApproval[];
    /** agent connection id → its process */
    agents: Record<string, AgentState>;
    /** conversation id → its live agent session's modes and commands */
    agentSessions: Record<string, AgentSessionInfo>;
    /** the projects agent chats can work in, by name */
    projects: string[];
    /** more projects exist than are listed */
    projectsTruncated: boolean;
    /** the project the next agent chat starts in */
    lastProject?: string;
    /** "panelId:action" keys the user allowed always */
    alwaysAllowed: string[];
    /** hearted models, any connection; the choices outside chat */
    favorites: FavoriteModel[];
    settings: Settings;
    /** conversation history could not be read; writes are refused */
    storageError?: string;
    /**
     * A chat started from outside the panel (the Quick ask widget) that a
     * panel window should open; the window that takes it clears it.
     */
    openRequest: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
    defaultModel: "",
    defaultProvider: "",
    contextLength: 32768,
    reasoning: "off",
    panelActions: false,
    shellCommands: true,
    forceCpu: false,
    promptStyle: "standard",
    customPromptEnabled: false,
    customSystemPrompt: null,
    noSandboxWarning: true,
};

export function initialState(): AiState {
    return {
        runtime: { status: "checking", compute: [] },
        connections: [],
        hardware: { gpus: [], ramBytes: 0, errors: [], loaded: false },
        models: [],
        modelErrors: {},
        pulls: [],
        speeds: {},
        conversations: [],
        generating: [],
        approvals: [],
        agents: {},
        agentSessions: {},
        projects: [],
        projectsTruncated: false,
        alwaysAllowed: [],
        favorites: [],
        settings: { ...DEFAULT_SETTINGS },
        openRequest: null,
    };
}
