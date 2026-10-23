// What the AI panel's service and its UI agree on: ids, state, events.
//
// The agent is one ongoing conversation, like texting a friend. Its brain is
// an agent harness the user already has (Codex or Claude Code) with every
// built-in tool off except web search; its hands are its own computer, a
// web browser the service runs, reached through the service's MCP endpoint.

export const PANEL_ID = "dev.paperboard.ai";

export const UI_ACTION_IDS = {
    // onboarding: name and brain
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
    go: "ui-go",
    control: "ui-control",
    // waiting messages: take one back, or interrupt the turn to read them now
    unqueue: "ui-unqueue",
    sendNow: "ui-send-now",
    startOver: "ui-start-over",
    // past conversations: start a new one (the current one is kept), list, reopen or delete them
    newConversation: "ui-new-conversation",
    conversations: "ui-conversations",
    openConversation: "ui-open-conversation",
    deleteConversation: "ui-delete-conversation",
    // files in the conversation: the user's are uploaded in chunks, then sent with a message; either side's are read in chunks
    attachBegin: "ui-attach-begin",
    attachPut: "ui-attach-put",
    attachFinish: "ui-attach-finish",
    attachCancel: "ui-attach-cancel",
    attachRead: "ui-attach-read",
    // the models a brain offers, from the harness's own catalog
    models: "ui-models",
    // what the agent remembers, which the user can read and change too
    memory: "ui-memory",
    deleteFact: "ui-delete-fact",
    readNote: "ui-read-note",
    deleteNote: "ui-delete-note",
    // what the agent does on a schedule, which the user can see and cancel
    routines: "ui-routines",
    deleteRoutine: "ui-delete-routine",
    // a sign-in the agent asked for: its picture, the user's values (never kept), or a no
    signInShot: "ui-sign-in-shot",
    signIn: "ui-sign-in",
    declineSignIn: "ui-decline-sign-in",
} as const;

export const EVENTS = {
    // an entry was added or changed; the whole entry
    entry: "chat-entry",
    // the user started over: the conversation is empty
    cleared: "chat-cleared",
    // another conversation is the current one now: read its history again
    switched: "chat-switched",
} as const;

/**
 * Names that bring a character with them: its look in the UI and its voice in the agent's instructions.
 * The name alone decides, whatever its case or spacing.
 */
export const CHARACTERS = ["verity"] as const;
export type Character = (typeof CHARACTERS)[number];
export const characterOf = (name: string | null | undefined): Character | null =>
    CHARACTERS.find((c) => c === (name ?? "").trim().toLowerCase()) ?? null;

export const HARNESSES = ["codex", "claude-code", "opencode"] as const;
export type Harness = (typeof HARNESSES)[number];

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
    history: 200,
    /** past conversations kept; past this, starting a new one asks to delete some first */
    pastConversations: 200,
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
    attachments: {
        /** one file, either side's */
        fileBytes: 25 * 1024 * 1024,
        /** files sent with one message */
        perMessage: 4,
        /** every file in one conversation */
        conversationBytes: 1024 * 1024 * 1024,
        conversationFiles: 1000,
        /** uploads begun and not yet finished; one left alone this long is dropped */
        uploading: 8,
        uploadIdleMinutes: 10,
        /** one chunk of an upload or a read, before base64 */
        chunkBytes: 1024 * 1024,
        nameChars: 120,
        /** what the agent can look at directly; bigger images go to its computer */
        viewBytes: 4 * 1024 * 1024,
    },
    signIn: {
        fields: 4,
        labelChars: 40,
        valueChars: 1000,
        /** an unanswered request lapses after this long */
        waitMinutes: 10,
    },
} as const;

/** A conversation put away in the history. */
export interface PastConversation {
    id: string;
    /** its first message, cut short */
    title: string;
    startedAt: number;
    endedAt: number;
    messages: number;
}

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

export type SetupStepId = "download" | "unpack" | "start";
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
    steps: SetupStep[];
    error: string | null;
    /** the user has taken control: the agent's tool calls are refused until they hand it back */
    userControl: boolean;
}

/** One of the computer's windows, as the user's view lists it. */
export interface ComputerWindow {
    id: number;
    title: string;
    /** the page's address */
    url: string;
    app: string;
    width: number;
    height: number;
}

/** A JavaScript dialog a page is waiting on: the page is paused (and can't be pictured) until it's answered. */
export interface PageDialog {
    type: "alert" | "confirm" | "prompt" | "beforeunload";
    message: string;
}

/** A window's picture: unchanged since the hash asked about, or a new JPEG; and the dialog it waits on, if any. */
export type WindowFrame =
    | { same: true; hash: string; dialog: PageDialog | null }
    | { same?: false; frame: string; hash: string; width: number; height: number; dialog: null };

/** What the user does in a window they control, in window coordinates. */
export type InputEvent =
    | { type: "move"; x: number; y: number }
    | { type: "down" | "up"; button: 1 | 2 | 3; x?: number; y?: number }
    | { type: "scroll"; x: number; y: number; dy?: number; dx?: number }
    | { type: "key"; keys: string }
    | { type: "text"; text: string };

export interface ChatState {
    /** a turn answering the user is running: the agent is on it (a routine's turn runs without it) */
    busy: boolean;
    /** the agent is writing a message right now, rather than working with its tools */
    typing: boolean;
    /** messages waiting for the running turn to finish; they join the conversation when a turn reads them */
    waiting: WaitingMessage[];
}

export interface WaitingMessage {
    id: string;
    text: string;
    /** id of the message it answers */
    replyTo?: string;
    attachments?: Attachment[];
}

export interface AiState {
    /** null until onboarding has saved them */
    settings: Settings | null;
    computer: ComputerState;
    chat: ChatState;
    memory: MemoryState;
    routines: RoutinesState;
}

/** A file in the conversation: one the user attached, or one the agent shared from its computer. */
export interface Attachment {
    id: string;
    name: string;
    /** how it's shown: decided from its bytes, not its name */
    kind: "image" | "video" | "file";
    /** its media type, from its bytes; application/octet-stream when they don't say */
    type: string;
    bytes: number;
}

/** In an agent's message, `![caption](attachment:<id>)` shows one of the conversation's files inline. */
export const ATTACHMENT_SCHEME = "attachment:";
export const ATTACHMENT_ID = /^[a-f0-9]{12}$/;

export type ChatEntry =
    // replyTo: the id of an earlier user or agent entry this bubble answers
    | { id: string; at: number; kind: "user"; text: string; replyTo?: string; attachments?: Attachment[] }
    | { id: string; at: number; kind: "agent"; text: string; replyTo?: string }
    | { id: string; at: number; kind: "error"; text: string }
    | SignInEntry;

/**
 * The agent asking the user to sign in on a site in its browser. The values the user types are never part
 * of it: they go once to the computer, which types them in and presses submit.
 */
export interface SignInEntry {
    id: string;
    at: number;
    kind: "sign-in";
    /** the page's host, from the browser itself ("http://" in front when it isn't https) */
    site: string;
    /** what the agent says each field is; secret ones are password fields */
    fields: { label: string; secret: boolean }[];
    /** submitted: the values were typed in and submit pressed, not that the site let them in */
    status: "waiting" | "submitting" | "submitted" | "declined" | "expired" | "failed";
    error?: string;
}

export const SETUP_STEPS: SetupStepId[] = ["download", "unpack", "start"];

export const DEFAULT_STATE: AiState = {
    settings: null,
    computer: { phase: "none", installed: false, steps: [], error: null, userControl: false },
    chat: { busy: false, typing: false, waiting: [] },
    memory: { revision: 0, error: null },
    routines: { revision: 0, error: null },
};
