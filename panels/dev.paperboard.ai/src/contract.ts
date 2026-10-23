// What the AI panel's service and its UI agree on: ids, state, events.
//
// The agent is one ongoing conversation, like texting a friend. Its brain is
// an agent harness the user already has (Codex or Claude Code) with every
// built-in tool off except web search; its hands are its own computer, a
// Debian VM the service runs, reached through the service's MCP endpoint.

export const PANEL_ID = "dev.paperboard.ai";

export const UI_ACTION_IDS = {
    // onboarding: name, brain and (optionally) the computer's budget
    setup: "ui-setup",
    detect: "ui-detect",
    history: "ui-history",
    send: "ui-send",
    stop: "ui-stop",
    installComputer: "ui-install-computer",
    startComputer: "ui-start-computer",
    stopComputer: "ui-stop-computer",
    // the user's view of the computer's windows, and taking control of them
    windows: "ui-windows",
    frame: "ui-frame",
    input: "ui-input",
    closeWindow: "ui-close-window",
    control: "ui-control",
} as const;

export const EVENTS = {
    // an entry was added or changed (a tool call finishing); the whole entry
    entry: "chat-entry",
} as const;

export const HARNESSES = ["codex", "claude-code"] as const;
export type Harness = (typeof HARNESSES)[number];

export interface ComputerBudget {
    memoryGb: number;
    diskGb: number;
}

export interface Settings {
    name: string;
    harness: Harness;
    /** null: whatever the harness is set to use already */
    model: string | null;
}

export const LIMITS = {
    name: 32,
    model: 64,
    message: 16_000,
    memoryGb: { min: 2, max: 32 },
    diskGb: { min: 8, max: 128 },
    history: 200,
} as const;

export interface HarnessInfo {
    id: Harness;
    installed: boolean;
    version: string | null;
}

export type SetupStepId = "image" | "browser" | "disk" | "boot" | "install";
export type StepStatus = "waiting" | "running" | "done" | "failed";
export interface SetupStep {
    id: SetupStepId;
    status: StepStatus;
    /** 0–100 when measurable, null otherwise */
    percent: number | null;
}

export type ComputerPhase =
    | "none" // never set up
    | "unsupported" // this host can't run it (see error)
    | "installing"
    | "starting"
    | "ready"
    | "stopping"
    | "stopped"
    | "failed"; // see error; installing again or starting is the way out

export interface ComputerState {
    phase: ComputerPhase;
    /** set up and kept: a failure while installed is retried by starting, otherwise by installing again */
    installed: boolean;
    budget: ComputerBudget | null;
    steps: SetupStep[];
    error: string | null;
    /** the user has taken control: the agent's tool calls are refused until they hand it back */
    userControl: boolean;
}

/** One of the computer's windows, as the user's view lists it. */
export interface ComputerWindow {
    id: number;
    title: string;
    app: string;
    width: number;
    height: number;
}

/** A window's picture: unchanged since the hash asked about, or a new JPEG. */
export type WindowFrame =
    | { same: true; hash: string }
    | { same?: false; frame: string; hash: string; width: number; height: number };

/** What the user does in a window they control, in window coordinates. */
export type InputEvent =
    | { type: "move"; x: number; y: number }
    | { type: "down" | "up"; button: 1 | 2 | 3; x?: number; y?: number }
    | { type: "scroll"; x: number; y: number; dy?: number; dx?: number }
    | { type: "key"; keys: string }
    | { type: "text"; text: string };

export interface ChatState {
    /** a turn is running */
    busy: boolean;
    /** messages waiting for the running turn to finish */
    queued: number;
}

export interface AiState {
    /** null until onboarding has saved them */
    settings: Settings | null;
    computer: ComputerState;
    chat: ChatState;
}

export type ChatEntry =
    | { id: string; at: number; kind: "user"; text: string }
    | { id: string; at: number; kind: "agent"; text: string }
    | { id: string; at: number; kind: "tool"; tool: string; summary: string; status: "running" | "done" | "failed"; detail: string | null }
    | { id: string; at: number; kind: "error"; text: string };

export const SETUP_STEPS: SetupStepId[] = ["image", "browser", "disk", "boot", "install"];

export const DEFAULT_STATE: AiState = {
    settings: null,
    computer: { phase: "none", installed: false, budget: null, steps: [], error: null, userControl: false },
    chat: { busy: false, queued: 0 },
};
