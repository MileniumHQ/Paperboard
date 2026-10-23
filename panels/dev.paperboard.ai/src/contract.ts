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
    installComputer: "ui-install-computer",
    startComputer: "ui-start-computer",
    stopComputer: "ui-stop-computer",
    // the user's view of the computer's windows, and taking control of them
    windows: "ui-windows",
    frame: "ui-frame",
    input: "ui-input",
    closeWindow: "ui-close-window",
    control: "ui-control",
    // waiting messages: take one back, or interrupt the turn to read them now
    unqueue: "ui-unqueue",
    sendNow: "ui-send-now",
    startOver: "ui-start-over",
    setMemory: "ui-set-memory",
    // the models a brain offers, from the harness's own catalog
    models: "ui-models",
    // what the agent remembers, which the user can read and change too
    memory: "ui-memory",
    addFact: "ui-add-fact",
    editFact: "ui-edit-fact",
    deleteFact: "ui-delete-fact",
    readNote: "ui-read-note",
    saveNote: "ui-save-note",
    deleteNote: "ui-delete-note",
    // what the agent does on a schedule, which the user can see and cancel
    routines: "ui-routines",
    deleteRoutine: "ui-delete-routine",
} as const;

export const EVENTS = {
    // an entry was added or changed; the whole entry
    entry: "chat-entry",
    // the user started over: the conversation is empty
    cleared: "chat-cleared",
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
    memory: {
        factChars: 200,
        facts: 100,
        keyChars: 48,
        whenChars: 200,
        bodyBytes: 64 * 1024,
        notes: 200,
    },
    routines: {
        count: 50,
        whatChars: 500,
        /** a routine that repeats runs at most this often */
        minEveryMinutes: 15,
    },
} as const;

/** A short durable fact: always in the agent's context. */
export interface MemoryFact {
    id: string;
    text: string;
}

/** A note as the index lists it: the body is read on demand. */
export interface MemoryNoteInfo {
    key: string;
    /** when the note is needed */
    when: string;
}

export interface MemoryList {
    facts: MemoryFact[];
    notes: MemoryNoteInfo[];
}

/** When a routine runs: once, at a local time on some weekdays, or every so many minutes. */
export type RoutineSchedule =
    | { kind: "once"; at: number }
    // days: 0 (Sunday) to 6, in the computer's time zone
    | { kind: "weekly"; time: string; days: number[] }
    | { kind: "every"; minutes: number };

/** Something the agent does on a schedule. */
export interface Routine {
    id: string;
    /** what to do, in the agent's words to itself */
    what: string;
    schedule: RoutineSchedule;
    created: number;
    lastRun: number | null;
    /** why its last run couldn't happen; cleared by the next one that does */
    lastError: string | null;
    /** null: it has no more runs */
    next: number | null;
}

export interface RoutinesState {
    revision: number;
    /** the routines can't be read; none run until they can */
    error: string | null;
}

export interface MemoryState {
    /** counts every change, the agent's and the user's, so open windows know to read again */
    revision: number;
    /** memory can't be read or written (an unreadable index is never replaced by an empty one) */
    error: string | null;
}

/** A model a harness offers, as its own picker names it. */
export interface BrainModel {
    id: string;
    name: string;
    description: string | null;
    /** listed after the current ones, as the harness's picker does */
    older: boolean;
}

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
    /** a turn answering the user is running: the agent is typing (a routine's turn runs without it) */
    busy: boolean;
    /** messages waiting for the running turn to finish; they join the conversation when a turn reads them */
    waiting: WaitingMessage[];
}

export interface WaitingMessage {
    id: string;
    text: string;
    /** id of the message it answers */
    replyTo?: string;
}

export interface AiState {
    /** null until onboarding has saved them */
    settings: Settings | null;
    computer: ComputerState;
    chat: ChatState;
    memory: MemoryState;
    routines: RoutinesState;
}

export type ChatEntry =
    // replyTo: the id of an earlier user or agent entry this bubble answers
    | { id: string; at: number; kind: "user"; text: string; replyTo?: string }
    | { id: string; at: number; kind: "agent"; text: string; replyTo?: string }
    | { id: string; at: number; kind: "error"; text: string };

export const SETUP_STEPS: SetupStepId[] = ["image", "browser", "disk", "boot", "install"];

export const DEFAULT_STATE: AiState = {
    settings: null,
    computer: { phase: "none", installed: false, budget: null, steps: [], error: null, userControl: false },
    chat: { busy: false, waiting: [] },
    memory: { revision: 0, error: null },
    routines: { revision: 0, error: null },
};
