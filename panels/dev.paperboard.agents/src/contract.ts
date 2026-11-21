// What the Agents panel's service and its UI agree on: the contract (every
// call the page makes, every event and the state it mirrors), and the limits
// and ids both check against.
//
// The agent is one ongoing conversation, like texting a friend. Its brain is
// an agent harness Paperboard installs for them (Codex, Claude Code or OpenCode) with every
// built-in tool off except web search; its hands are its own computer, a
// web browser the service runs, reached through the service's MCP endpoint.

import { defineContract, shape, type Infer } from "@mileniumhq/paperapi";
import type { PaperRole } from "@mileniumhq/paperui";
import { serverSpec, toolsView } from "./toolsContract";

export const PANEL_ID = "dev.paperboard.agents";

/**
 * Names that bring a character with them: its look in the UI and its voice in the agent's instructions.
 * The name alone decides, whatever its case or spacing.
 */
export const CHARACTERS = ["verity"] as const;
export type Character = (typeof CHARACTERS)[number];
export const characterOf = (name: string | null | undefined): Character | null =>
    CHARACTERS.find((c) => c === (name ?? "").trim().toLowerCase()) ?? null;

export const HARNESSES = ["codex", "antigravity", "claude-code", "opencode"] as const;
export type Harness = (typeof HARNESSES)[number];

export interface BrainInfo {
    /** Choice label shown in the picker, settings, and dropdown. */
    readonly name: string;
    /** Underlying CLI program name used in sentences about the program. */
    readonly program: string;
    /** How the choice is signed in to, one line. */
    readonly description: string;
}

// "Claude", not "Claude Code": Anthropic's terms ask that products built on it don't carry its product's name
export const BRAINS: Record<Harness, BrainInfo> = {
    codex: {
        name: "ChatGPT",
        program: "Codex",
        description: "Sign in with your ChatGPT account",
    },
    antigravity: {
        name: "Gemini",
        program: "Antigravity",
        description: "Your Google account, shared with this computer's Antigravity",
    },
    "claude-code": {
        name: "Claude",
        program: "Claude",
        description: "Sign in with your Claude account",
    },
    opencode: {
        name: "Other provider",
        program: "OpenCode",
        description: "Free models included, or connect any provider",
    },
};

/** The model a brain is on when none is chosen: whatever the harness is set to use already. Saved as null. */
export const DEFAULT_MODEL = "default";

/**
 * The colors an agent can be, around the color wheel; its face glows in it. Saved by its own name, and
 * drawn in the PaperUI color role beside it, so a renamed role never touches what's saved.
 * Settings saved before the color was a choice are blue.
 */
export const AGENT_COLORS = ["blue", "purple", "pink", "red", "orange", "yellow", "green", "teal"] as const;
export type AgentColor = (typeof AGENT_COLORS)[number];
export const DEFAULT_COLOR: AgentColor = "blue";
export const COLOR_ROLES: Record<AgentColor, PaperRole> = {
    blue: "primary",
    purple: "extra-2",
    pink: "extra-3",
    red: "danger",
    orange: "attention",
    yellow: "warning",
    green: "success",
    teal: "extra-1",
};

export const COMPACTIONS = ["summarize", "forget"] as const;
export type Compaction = (typeof COMPACTIONS)[number];

const text = shape.text;
const number = shape.number;
const boolean = shape.boolean;
const optional = shape.optional;
const nullable = shape.nullable;
const list = shape.list;
const object = shape.object;
const oneOf = shape.oneOf;

const harness = oneOf(...HARNESSES);
const agentColor = oneOf(...AGENT_COLORS);

const settings = object({
    name: text(),
    /** the color its face glows in */
    color: agentColor,
    harness,
    /** null: whatever the harness is set to use already */
    model: nullable(text()),
    /** what happens to a conversation that's grown long: summarized into a fresh thread, or its older part forgotten */
    compaction: oneOf(...COMPACTIONS),
    /** added to what the agent is told when an automation messages or asks it; a block's own instructions replace these */
    automationInstructions: optional(text()),
});
export type Settings = Infer<typeof settings>;

export const LIMITS = {
    name: 32,
    model: 64,
    message: 16_000,
    /** a status line (send_status) */
    status: 100,
    /** the user's instructions for automations */
    instructions: 4_000,
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
    pages: {
        titleChars: 60,
        descriptionChars: 200,
    },
    signIn: {
        fields: 4,
        labelChars: 40,
        valueChars: 1000,
        /** an unanswered request lapses after this long */
        waitMinutes: 10,
    },
    access: {
        /** folders and commands in one request */
        items: 5,
        reasonChars: 500,
        pathChars: 1024,
        /** arguments in a command, its program included */
        commandArgs: 32,
        argChars: 1024,
        /** an unanswered request lapses after this long */
        waitMinutes: 15,
        /** grants kept for good */
        always: 200,
    },
    toolServers: {
        reasonChars: 500,
        /** an unanswered request lapses after this long */
        waitMinutes: 15,
    },
    prompt: {
        fields: 6,
        titleChars: 60,
        reasonChars: 500,
        labelChars: 40,
        valueChars: 4000,
        prefixChars: 32,
        /** an unanswered request lapses after this long */
        waitMinutes: 30,
    },
} as const;

/** The settings, checked by the service as it saves or reads them; throws with what's wrong with them. */
export function parseSettings(v: unknown): Settings {
    if (!v || typeof v !== "object") throw new Error("there are no settings to save");
    const s = v as Record<string, unknown>;
    const name = typeof s.name === "string" ? s.name.trim() : "";
    if (!name) throw new Error("give the agent a name");
    if (name.length > LIMITS.name) throw new Error(`names are limited to ${LIMITS.name} characters`);
    if (s.color !== undefined && !AGENT_COLORS.includes(s.color as AgentColor)) throw new Error(`"${String(s.color)}" isn't one of the agent's colors`);
    const color = (s.color as AgentColor | undefined) ?? DEFAULT_COLOR;
    if (!HARNESSES.includes(s.harness as Harness)) throw new Error("pick a brain");
    let model: string | null = null;
    if (typeof s.model === "string" && s.model && s.model !== DEFAULT_MODEL) {
        // it lands in argv after -m/--model: it can never be read as a flag
        if (s.model.length > LIMITS.model || !/^\w[\w.:\-/]*$/.test(s.model)) throw new Error(`"${s.model.slice(0, LIMITS.model)}" isn't a model's name`);
        model = s.model;
    }
    // settings saved before compaction was a choice summarize, as it's done since
    if (s.compaction !== undefined && !COMPACTIONS.includes(s.compaction as Compaction)) throw new Error(`compaction is ${COMPACTIONS.join(" or ")}`);
    const compaction = (s.compaction as Compaction | undefined) ?? "summarize";
    if (s.automationInstructions !== undefined && typeof s.automationInstructions !== "string") throw new Error("instructions for automations are text");
    const automationInstructions = s.automationInstructions?.trim() ?? "";
    if (automationInstructions.length > LIMITS.instructions) throw new Error(`instructions for automations are limited to ${LIMITS.instructions} characters`);
    return { name, color, harness: s.harness as Harness, model, compaction, ...(automationInstructions ? { automationInstructions } : {}) };
}

/** the current conversation's id where it's listed with the past ones, whose ids are 12 hex digits */
export const CURRENT_CONVERSATION = "current";

/** A conversation put away in the history. */
const pastConversation = object({
    id: text(),
    /** its first message, cut short */
    title: text(),
    startedAt: number(),
    endedAt: number(),
    messages: number(),
});
export type PastConversation = Infer<typeof pastConversation>;

/** A short durable fact: always in the agent's context. */
const memoryFact = object({ id: text(), text: text() });
export type MemoryFact = Infer<typeof memoryFact>;

/** A note as the index lists it: the body is read on demand. */
const memoryNoteInfo = object({
    key: text(),
    /** when the note is needed */
    when: text(),
});
export type MemoryNoteInfo = Infer<typeof memoryNoteInfo>;

const memoryList = object({ facts: list(memoryFact), notes: list(memoryNoteInfo) });
export type MemoryList = Infer<typeof memoryList>;

/** When a routine runs: once, at a local time on some weekdays, or every so many minutes. */
const routineSchedule = shape.either(
    object({ kind: oneOf("once"), at: number() }),
    // days: 0 (Sunday) to 6, in the computer's time zone
    object({ kind: oneOf("weekly"), time: text(), days: list(number()) }),
    object({ kind: oneOf("every"), minutes: number() }),
);
export type RoutineSchedule = Infer<typeof routineSchedule>;

/** Something the agent does on a schedule. */
const routine = object({
    id: text(),
    /** what to do, in the agent's words to itself */
    what: text(),
    schedule: routineSchedule,
    created: number(),
    lastRun: nullable(number()),
    /** why its last run couldn't happen; cleared by the next one that does */
    lastError: nullable(text()),
    /** null: it has no more runs */
    next: nullable(number()),
});
export type Routine = Infer<typeof routine>;

const routinesState = object({
    revision: number(),
    /** the routines can't be read, or couldn't be saved after a run; none run until they can */
    error: nullable(text()),
});
export type RoutinesState = Infer<typeof routinesState>;

const pagesState = object({
    /** counts every change to the pages (made, shown, retitled, deleted), so open lists know to read again */
    revision: number(),
});

const memoryState = object({
    /** counts every change, the agent's and the user's, so open windows know to read again */
    revision: number(),
    /** memory can't be read or written (an unreadable index is never replaced by an empty one) */
    error: nullable(text()),
});

/** A model a harness offers, as its own picker names it. */
const brainModel = object({
    id: text(),
    name: text(),
    description: nullable(text()),
    /** listed after the current ones, as the harness's picker does */
    older: boolean(),
});
export type BrainModel = Infer<typeof brainModel>;

/** One of a plan's limits: a window of time, and how much of it is used. */
const usageWindow = object({
    id: text(),
    /** "Session", "Weekly", "Weekly · Fable" */
    label: text(),
    /** 0–100 */
    used: number(),
    /** ISO time; null when the harness doesn't say */
    resetsAt: nullable(text()),
});
export type UsageWindow = Infer<typeof usageWindow>;

/** How much of a brain's plan is used, as its harness's own usage screen says. No windows: the account has no plan limits (an API key). */
const brainUsage = object({
    /** "Max", "Pro", "Free" */
    plan: nullable(text()),
    windows: list(usageWindow),
});
export type BrainUsage = Infer<typeof brainUsage>;

/** The brains whose plan usage can be read. OpenCode connects other providers' keys, with no plan of its own. */
export const USAGE_HARNESSES: readonly Harness[] = ["claude-code", "codex"];

/** What a sign-in asks of the user, as its harness printed it. */
const loginPrompt = object({
    /** the page to open */
    url: nullable(text()),
    /** a code to type on that page */
    code: nullable(text()),
    /** the page ends in a code to paste back here */
    expectsCode: boolean(),
    /**
     * the loopback address the harness waits on for the browser to come back
     * to (Codex's "http://127.0.0.1:1455/auth/callback"), null when the page
     * ends somewhere else. It's on the brain's computer: a browser on another
     * computer lands on its own loopback, so that address is caught there, or
     * pasted, and finished with brainAddress.
     */
    callback: nullable(text()),
});
export type LoginPrompt = Infer<typeof loginPrompt>;

/**
 * Where a brain stands on this computer. Each is a package Paperboard installs (codex, claude-code,
 * opencode); its sign-in is the harness's own login, kept in a folder only this panel uses.
 */
const brainState = object({
    phase: oneOf(
        "none", // not installed
        "unsupported", // no build for this computer (see error)
        "installing",
        "installed", // there, but it needs signing in to
        "signing-in",
        "ready",
        "failed", // the last install, sign-in or look at its state didn't work (see error)
    ),
    installed: boolean(),
    version: nullable(text()),
    signedIn: boolean(),
    /** who it's signed in as, when the harness says */
    account: nullable(text()),
    /** 0–100 while installing */
    percent: nullable(number()),
    login: nullable(loginPrompt),
    error: nullable(text()),
    /** a newer build is downloaded and waits for the running agent to stop */
    updateWaiting: boolean(),
    /** the program on this computer the person chose for the brain, instead of a downloaded package */
    existing: nullable(text()),
    /** a program on this computer the brain could run, while it has neither that nor a package; offered, never run unasked */
    found: nullable(text()),
});
export type BrainState = Infer<typeof brainState>;

/** OpenCode works with its free models before anything is connected; the others need their sign-in. */
export const SIGN_IN_REQUIRED: Record<Harness, boolean> = { codex: true, antigravity: true, "claude-code": true, opencode: false };

/**
 * Antigravity keeps its sign-in in the OS keyring, one per OS user, whatever its home: the agent uses this
 * computer's own Antigravity sign-in. The panel signs it in when there's none, and never signs it out.
 */
export const SHARED_SIGN_IN: Record<Harness, boolean> = { codex: false, antigravity: true, "claude-code": false, opencode: false };

/** The brains the panel signs out itself: a sign-in of their own, not a shared one. */
export type SignsOut = "codex" | "claude-code";
export const signsOut = (h: Harness): h is SignsOut => SIGN_IN_REQUIRED[h] && !SHARED_SIGN_IN[h];

/** A field of a provider's connect form. Only text fields (optionally a list of choices) are supported. */
const providerField = object({
    key: text(),
    title: text(),
    required: boolean(),
    hidden: boolean(),
    placeholder: nullable(text()),
    default: nullable(text()),
    options: nullable(list(object({ value: text(), label: text(), description: nullable(text()) }))),
    /** shown only while another field has (or hasn't) a value */
    when: list(object({ key: text(), op: oneOf("eq", "neq"), value: text() })),
});
export type ProviderField = Infer<typeof providerField>;

/** One way to connect a provider that this panel can drive. */
const providerMethod = object({
    /** null for a key */
    id: nullable(text()),
    kind: oneOf("key", "oauth"),
    label: text(),
    fields: list(providerField),
});
export type ProviderMethod = Infer<typeof providerMethod>;

const providerInfo = object({
    id: text(),
    name: text(),
    connected: boolean(),
    /** the credentials it has, by id, so one can be taken back */
    connections: list(object({ id: text(), label: text() })),
    methods: list(providerMethod),
    /** why it can't be connected here when it has no method this panel supports ("set OPENAI_API_KEY in the environment") */
    unsupported: nullable(text()),
});
export type ProviderInfo = Infer<typeof providerInfo>;

/** A provider sign-in in progress: open the page; `code` mode ends with a code pasted back. */
const providerAttempt = object({ id: text(), url: text(), instructions: text(), mode: oneOf("auto", "code") });
export type ProviderAttempt = Infer<typeof providerAttempt>;

const providerAttemptStatus = shape.either(object({ status: oneOf("pending", "complete", "expired") }), object({ status: oneOf("failed"), message: text() }));
export type ProviderAttemptStatus = Infer<typeof providerAttemptStatus>;

export const SETUP_STEPS = ["download", "unpack"] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number];
const stepStatus = oneOf("waiting", "running", "done", "failed");
export type StepStatus = Infer<typeof stepStatus>;
const setupStep = object({
    id: oneOf(...SETUP_STEPS),
    status: stepStatus,
    /** 0–100 when measurable, null otherwise */
    percent: nullable(number()),
    /** how much has downloaded, while a download says */
    bytes: nullable(object({ done: number(), total: number() })),
});
export type SetupStep = Infer<typeof setupStep>;

const computerPhase = oneOf(
    "none", // never set up
    "unsupported", // this host can't run it (see error)
    "installing",
    "starting",
    "ready",
    "stopping",
    "stopped",
    "failed", // see error; installing again or starting is the way out
);
export type ComputerPhase = Infer<typeof computerPhase>;

const computerState = object({
    phase: computerPhase,
    /** set up and kept: a failure while installed is retried by starting, otherwise by installing again */
    installed: boolean(),
    steps: list(setupStep),
    error: nullable(text()),
    /** the user has taken control: the agent's tool calls are refused until they hand it back */
    userControl: boolean(),
});
export type ComputerState = Infer<typeof computerState>;

/** One of the computer's windows, as the user's view lists it. */
const computerWindow = object({
    id: number(),
    title: text(),
    /** the page's address */
    url: text(),
    app: text(),
    width: number(),
    height: number(),
});
export type ComputerWindow = Infer<typeof computerWindow>;

/** A JavaScript dialog a page is waiting on: the page is paused (and can't be pictured) until it's answered. */
const pageDialog = object({ type: oneOf("alert", "confirm", "prompt", "beforeunload"), message: text() });
export type PageDialog = Infer<typeof pageDialog>;

/** A window's picture: unchanged since the hash asked about, or a new JPEG; and the dialog it waits on, if any. */
const windowFrame = shape.either(
    object({ same: oneOf(true), hash: text(), dialog: nullable(pageDialog) }),
    object({ same: optional(oneOf(false)), frame: text(), hash: text(), width: number(), height: number(), dialog: nullable(pageDialog) }),
);
export type WindowFrame = Infer<typeof windowFrame>;

/** What the user does in a window they control, in window coordinates. */
const inputEvent = shape.either(
    object({ type: oneOf("move"), x: number(), y: number() }),
    object({ type: oneOf("down", "up"), button: oneOf(1, 2, 3), x: optional(number()), y: optional(number()) }),
    object({ type: oneOf("scroll"), x: number(), y: number(), dy: optional(number()), dx: optional(number()) }),
    object({ type: oneOf("key"), keys: text() }),
    object({ type: oneOf("text"), text: text() }),
);
export type InputEvent = Infer<typeof inputEvent>;

/** A file in the conversation: one the user attached, or one the agent shared from its computer. */
const attachment = object({
    id: text(),
    name: text(),
    /** how it's shown: decided from its bytes, not its name */
    kind: oneOf("image", "video", "audio", "file"),
    /** its media type, from its bytes; application/octet-stream when they don't say */
    type: text(),
    bytes: number(),
});
export type Attachment = Infer<typeof attachment>;

/**
 * In an agent's message, `![caption](attachment:<id>)` shows one of the conversation's files inline,
 * and `[name](attachment:<id>)` names one in a sentence, as a chip that opens it.
 */
export const ATTACHMENT_SCHEME = "attachment:";
export const ATTACHMENT_ID = /^[a-f0-9]{12}$/;

const waitingMessage = object({
    id: text(),
    text: text(),
    /** id of the message it answers */
    replyTo: optional(text()),
    attachments: optional(list(attachment)),
    /** sent by a flow (the Send Message block): it's answered in a turn of its own, for the flow */
    fromFlow: optional(boolean()),
    /** the flow's instructions for its turn, in place of the ones in settings */
    instructions: optional(text()),
});
export type WaitingMessage = Infer<typeof waitingMessage>;

const chatState = object({
    /** a turn answering the user is running: the agent is on it (a routine's turn runs without it) */
    busy: boolean(),
    /** the agent is writing a message right now, rather than working with its tools */
    typing: boolean(),
    /** messages the agent hasn't read yet: the turn they stopped picks them up next, or a compaction finishes first; they join the conversation then */
    waiting: list(waitingMessage),
    /** the conversation is being compacted (see Settings.compaction): messages sent meanwhile wait for it */
    compacting: boolean(),
});
export type ChatState = Infer<typeof chatState>;

/** The first meeting's steps; the last is the answer to the computer: setting it up, or not yet. */
export const ONBOARDING_STEP = { name: 0, brain: 1, signIn: 2, model: 3, computer: 4, last: 5 } as const;

/**
 * How far the first meeting got before its settings were saved: the step and
 * what was answered, so leaving the panel and coming back picks it up there.
 * Kept by the service while it runs; saving the settings clears it. The last
 * step saves, so the computer's step is the furthest one picked up.
 */
const onboardingDraft = object({ step: number(), name: text(), color: agentColor, harness: nullable(harness), model: nullable(text()) });
export type OnboardingDraft = Infer<typeof onboardingDraft>;
export const NO_ONBOARDING: OnboardingDraft = { step: 0, name: "", color: DEFAULT_COLOR, harness: null, model: null };

const aiState = object({
    /** null until onboarding has saved them */
    settings: nullable(settings),
    onboarding: onboardingDraft,
    brains: object({ codex: brainState, antigravity: brainState, "claude-code": brainState, opencode: brainState }),
    computer: computerState,
    chat: chatState,
    memory: memoryState,
    routines: routinesState,
    pages: pagesState,
});
export type AiState = Infer<typeof aiState>;

/**
 * What a page is: an app is something to use (a planner, a tracker); a document is something to read, print or
 * keep (a birthday card, a letter, a report), and its view has Print and Save as PDF.
 */
export const PAGE_KINDS = ["app", "document"] as const;
const pageKind = oneOf(...PAGE_KINDS);
export type PageKind = Infer<typeof pageKind>;

/** A page the agent made, as the user's list shows it. */
const pageInfo = object({
    /** its folder in ~/Pages, and its address */
    name: text(),
    /** what the agent calls it, like "Assignment planner" */
    title: text(),
    /** one line on what it's for */
    description: text(),
    kind: pageKind,
    /** a picture of it was taken when the agent last showed it */
    picture: boolean(),
    /** when that picture was taken (ms since the epoch), 0 if there is none: a new one is a new stamp */
    pictureAt: number(),
});
export type PageInfo = Infer<typeof pageInfo>;

const entryHead = { id: text(), at: number() };

/**
 * The agent showing the user one of its pages: a card with its picture that opens it beside the chat. Pages were
 * called apps, and conversations keep these entries: the stored kind and field keep that name.
 */
const pageEntry = object({
    ...entryHead,
    kind: oneOf("app"),
    /** the page's name */
    app: text(),
    /** its title and description when it was shown; the page may have changed or gone since */
    title: text(),
    description: text(),
});
export type PageEntry = Infer<typeof pageEntry>;

/**
 * The agent asking the user to sign in on a site in its browser. The values the user types are never part
 * of it: they go once to the computer, which types them in and presses submit.
 */
const signInEntry = object({
    ...entryHead,
    kind: oneOf("sign-in"),
    /** the page's host, from the browser itself ("http://" in front when it isn't https) */
    site: text(),
    /** what the agent says each field is; secret ones are password fields */
    fields: list(object({ label: text(), secret: boolean() })),
    /** submitted: the values were typed in and submit pressed, not that the site let them in */
    status: oneOf("waiting", "submitting", "submitted", "declined", "expired", "failed"),
    error: optional(text()),
});
export type SignInEntry = Infer<typeof signInEntry>;

/**
 * A field the agent asks the user to fill in. A secret one (a key, a token) is saved in the vault for one of the
 * agent's tool servers, under the name its config uses; the agent learns only that it was saved.
 */
const promptField = object({
    label: text(),
    /** prefix: put before what the user types, like "Bearer " for a header that holds the whole value */
    secret: nullable(object({ server: text(), name: text(), prefix: optional(text()) })),
});
export type PromptField = Infer<typeof promptField>;

/** The agent asking the user for things only they know, typed into the chat. */
const promptEntry = object({
    ...entryHead,
    kind: oneOf("prompt"),
    title: text(),
    reason: text(),
    fields: list(promptField),
    status: oneOf("waiting", "sending", "sent", "declined", "expired", "failed"),
    error: optional(text()),
});
export type PromptEntry = Infer<typeof promptEntry>;

/**
 * The agent asking to add (or change) a tool server that runs a program on the user's computer. Nothing runs
 * until the user allows it on this card.
 */
const toolServerEntry = object({
    ...entryHead,
    kind: oneOf("tool-server"),
    server: text(),
    /** it changes a server the agent already has, rather than adding one */
    change: boolean(),
    /** what it is and why, in the agent's words */
    reason: text(),
    /** the program and its arguments, as they run */
    command: list(text()),
    /** its environment: a plain value, or null for a secret the vault holds */
    env: list(object({ name: text(), value: nullable(text()) })),
    status: oneOf("waiting", "allowed", "declined", "expired", "failed"),
    error: optional(text()),
});
export type ToolServerEntry = Infer<typeof toolServerEntry>;

/** The agent asking the user to sign in to one of its tool servers. How it's going is read live from the tools. */
const toolSignInEntry = object({
    ...entryHead,
    kind: oneOf("tool-sign-in"),
    server: text(),
    /** the server's address, for the card */
    url: text(),
});
export type ToolSignInEntry = Infer<typeof toolSignInEntry>;

const folderItem = { kind: oneOf("folder"), path: text() };
const commandItem = {
    kind: oneOf("command"),
    /** the program and the arguments the grant covers, as run: one program, never a shell line */
    command: list(text()),
    /** it also covers the same command with more arguments after these */
    anyArguments: boolean(),
};

/** Something on the user's computer the agent asks for: a folder to work in, or a command to run. */
const accessItem = shape.either(object(folderItem), object(commandItem));
export type AccessItem = Infer<typeof accessItem>;

/** The agent asking for access to the user's computer: answered on its card, once or for good. */
const accessEntry = object({
    ...entryHead,
    kind: oneOf("access"),
    /** what it wants to do and why, in its words */
    reason: text(),
    items: list(accessItem),
    /** allowed: for this time; always: kept until the user takes it back on the Access page */
    status: oneOf("waiting", "allowed", "always", "declined", "expired"),
});
export type AccessEntry = Infer<typeof accessEntry>;

/** A grant, as the Access page lists it. */
const granted = { at: number(), once: boolean() };
const accessGrant = shape.either(object({ ...folderItem, ...granted }), object({ ...commandItem, ...granted }));
export type AccessGrant = Infer<typeof accessGrant>;

const accessView = object({
    grants: list(accessGrant),
    /** the grants file couldn't be read: nothing it held is allowed, and nothing is written over it */
    error: nullable(text()),
});
export type AccessView = Infer<typeof accessView>;

/** A status line's icon: a step done, one that failed, what the agent is on, or something to know. */
export const STATUS_TONES = ["done", "failed", "info", "warning"] as const;
const statusTone = oneOf(...STATUS_TONES);
export type StatusTone = Infer<typeof statusTone>;

/** A short line from the agent outside the bubbles, on how its work is going (send_status). */
const statusEntry = object({ ...entryHead, kind: oneOf("status"), tone: statusTone, text: text() });
export type StatusEntry = Infer<typeof statusEntry>;

const chatEntry = shape.either(
    // replyTo: the id of an earlier user or agent entry this bubble answers
    object({ ...entryHead, kind: oneOf("user"), text: text(), replyTo: optional(text()), attachments: optional(list(attachment)) }),
    // attachments: files sent along with the text, the way a reply to a flow sends them
    object({ ...entryHead, kind: oneOf("agent"), text: text(), replyTo: optional(text()), attachments: optional(list(attachment)) }),
    // title: the operation that didn't happen, like "Not answered"; entries written before it have none
    object({ ...entryHead, kind: oneOf("error"), title: optional(text()), text: text() }),
    signInEntry,
    accessEntry,
    promptEntry,
    toolServerEntry,
    toolSignInEntry,
    pageEntry,
    statusEntry,
);
export type ChatEntry = Infer<typeof chatEntry>;

const NO_BRAIN: BrainState = { phase: "none", installed: false, version: null, signedIn: false, account: null, percent: null, login: null, error: null, updateWaiting: false, existing: null, found: null };

export const DEFAULT_STATE: AiState = {
    settings: null,
    onboarding: NO_ONBOARDING,
    brains: { codex: { ...NO_BRAIN }, antigravity: { ...NO_BRAIN }, "claude-code": { ...NO_BRAIN }, opencode: { ...NO_BRAIN } },
    computer: { phase: "none", installed: false, steps: [], error: null, userControl: false },
    chat: { busy: false, typing: false, waiting: [], compacting: false },
    memory: { revision: 0, error: null },
    routines: { revision: 0, error: null },
    pages: { revision: 0 },
};

const nothing = shape.nothing;
const byId = object({ id: text() });
const byHarness = object({ harness });
const byName = object({ name: text() });
const byWindow = object({ window: number() });
const picture = object({ image: text() });

/**
 * Everything the panel's page asks its service, and hears from it. The same
 * things a person automates are blocks (service/flowBlocks.ts).
 */
export const agentsContract = defineContract(PANEL_ID, {
    calls: {
        // onboarding and settings: the settings are saved whole
        setup: { input: object({ settings }), output: nothing() },
        /** the first meeting's answers so far, kept until the settings are saved */
        keepOnboarding: { input: onboardingDraft, output: nothing() },
        // the brains (Codex, Claude, OpenCode): install one (the one found on the computer, or its own package), sign in to it, sign out, stop a sign-in
        installBrain: { input: object({ harness, from: optional(oneOf("computer", "package")) }), output: nothing() },
        signInBrain: { input: object({ harness, method: optional(oneOf("browser", "code")) }), output: nothing() },
        /** the code the brain's sign-in page showed */
        brainCode: { input: object({ harness, code: text() }), output: nothing() },
        /** finishes a brain's sign-in at the address the browser ended on */
        brainAddress: { input: object({ harness, address: text() }), output: nothing() },
        cancelBrainSignIn: { input: byHarness, output: nothing() },
        signOutBrain: { input: byHarness, output: nothing() },
        /** the models a brain offers, from the harness's own catalog */
        models: { input: byHarness, output: list(brainModel) },
        /** how much of a brain's plan is used (Claude and Codex) */
        usage: { input: byHarness, output: brainUsage },
        // OpenCode's providers: list them, connect one by key or by a sign-in page, take it back
        providers: { output: list(providerInfo) },
        connectKey: { input: object({ provider: text(), key: text(), answer: optional(shape.record(text())) }), output: nothing() },
        beginProvider: { input: object({ provider: text(), method: text(), answer: optional(shape.record(text())) }), output: providerAttempt },
        /** checks a provider sign-in, or finishes it with the code its page showed */
        providerAttempt: { input: object({ provider: text(), attempt: text(), code: optional(text()) }), output: providerAttemptStatus },
        cancelProvider: { input: object({ provider: text(), attempt: text() }), output: nothing() },
        disconnectProvider: { input: object({ credential: text() }), output: nothing() },
        // the conversation: what's been said, and the user's next message
        history: { input: object({ limit: number() }), output: list(chatEntry) },
        /** attachments are ids from attachFinish; waiting: the agent reads it once its turn ends */
        send: { input: object({ text: text(), replyTo: optional(text()), attachments: list(text()) }), output: object({ id: text(), waiting: boolean() }) },
        // past conversations: start over (it can't be undone), start a new one (the current one is kept), list, reopen or delete them
        startOver: { output: nothing() },
        newConversation: { output: nothing() },
        conversations: { output: object({ current: nullable(pastConversation), past: list(pastConversation) }) },
        openConversation: { input: byId, output: nothing() },
        deleteConversation: { input: byId, output: nothing() },
        // files in the conversation: the user's are uploaded in chunks (base64), then sent with a message; either side's are read in chunks
        attachBegin: { input: object({ name: text(), bytes: number() }), output: object({ id: text() }) },
        attachPut: { input: object({ id: text(), offset: number(), data: text() }), output: nothing() },
        attachFinish: { input: byId, output: attachment },
        attachCancel: { input: byId, output: nothing() },
        attachRead: { input: object({ id: text(), offset: number() }), output: object({ data: text(), done: boolean(), file: attachment }) },
        attachInfo: { input: byId, output: attachment },
        /** a web picture an agent's message shows, fetched by the service under the browser's network rule; its bytes in base64 */
        webImage: { input: object({ url: text() }), output: object({ type: text(), data: text() }) },
        // the agent's computer: set it up, start it, stop it
        installComputer: { output: nothing() },
        startComputer: { output: nothing() },
        stopComputer: { output: nothing() },
        // the user's view of the computer's windows, and taking control of them
        windows: { output: list(computerWindow) },
        /** since: the hash of the picture the page has */
        frame: { input: object({ window: number(), since: optional(text()) }), output: windowFrame },
        input: { input: object({ window: number(), events: list(inputEvent) }), output: nothing() },
        closeWindow: { input: byWindow, output: nothing() },
        go: { input: object({ window: number(), to: text() }), output: nothing() },
        /** take (or renew) control with take: true; hand it back with take: false */
        control: { input: object({ take: boolean() }), output: nothing() },
        // what the agent remembers, which the user can read and change too
        memory: { output: memoryList },
        deleteFact: { input: byId, output: nothing() },
        readNote: { input: object({ key: text() }), output: object({ key: text(), when: text(), body: text() }) },
        deleteNote: { input: object({ key: text() }), output: nothing() },
        // what the agent does on a schedule, which the user can see and cancel
        routines: { output: list(routine) },
        deleteRoutine: { input: byId, output: nothing() },
        // a sign-in the agent asked for: its picture, the user's values (never kept), or a no
        signInShot: { input: byId, output: picture },
        signIn: { input: object({ id: text(), values: list(text()) }), output: nothing() },
        declineSignIn: { input: byId, output: nothing() },
        // what the agent asked the user: their answers (secret ones go to the vault), or a no
        answerPrompt: { input: object({ id: text(), values: list(text()) }), output: nothing() },
        declinePrompt: { input: byId, output: nothing() },
        // the user's computer: answer a permission request, read what's allowed, take a grant back
        access: { output: accessView },
        answerAccess: { input: object({ id: text(), how: oneOf("once", "always", "decline") }), output: nothing() },
        revokeAccess: { input: object({ grant: accessItem }), output: accessView },
        /** a program the agent asks to run as one of its tool servers: allowed or not */
        answerToolServer: { input: object({ id: text(), allow: boolean() }), output: nothing() },
        // the pages the agent made: list them, open one (its address), its picture, save one as a PDF, or delete it
        pages: { output: list(pageInfo) },
        openPage: { input: byName, output: object({ url: text(), title: text(), kind: pageKind }) },
        pagePicture: { input: byName, output: picture },
        /** the page printed to a PDF in the agent's browser: `file` is its path in the panel's storage, for saving */
        pagePdf: { input: byName, output: object({ file: text(), name: text() }) },
        discardPagePdf: { input: object({ file: text() }), output: nothing() },
        deletePage: { input: byName, output: nothing() },
        // the agent's tool servers (Tools): each change answers with the whole view
        tools: { output: toolsView },
        /** tools.json read again, as after the person fixed it: its servers, or why it still can't be read */
        readToolsFile: { output: toolsView },
        saveServer: { input: object({ server: serverSpec }), output: toolsView },
        removeServer: { input: byName, output: toolsView },
        restartServer: { input: byName, output: toolsView },
        /** may the agent use other panels' blocks */
        setBlocks: { input: object({ on: boolean() }), output: toolsView },
        /** a server's secret, into the vault */
        setSecret: { input: object({ server: text(), name: text(), value: text() }), output: toolsView },
        signInServer: { input: byName, output: toolsView },
        /** finishes a server's sign-in at the address the browser came back to */
        finishServerSignIn: { input: object({ name: text(), address: text() }), output: toolsView },
        cancelServerSignIn: { input: byName, output: toolsView },
    },
    events: {
        /** an entry was added or changed: the whole entry */
        entry: chatEntry,
        /** the user started over: the conversation is empty */
        cleared: nothing(),
        /** another conversation is the current one now: read its history again */
        switched: nothing(),
        /** what the agent may do on the user's computer changed */
        access: accessView,
        /** a tool server's status changed */
        tools: toolsView,
    },
    state: { shape: aiState, initial: DEFAULT_STATE },
});
