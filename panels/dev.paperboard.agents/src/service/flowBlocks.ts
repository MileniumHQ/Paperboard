// What the Blocks panel can do with the agent (Actions API v2). The actions
// (v1, flowActions.ts) stay as they are; both run the same FlowHost.

import type { BlockSet } from "@mileniumhq/paperapi";
import { DEFAULT_MODEL, HARNESSES, LIMITS, SIGN_IN_REQUIRED, type AppInfo, type BrainModel, type BrainState, type Harness, type Routine } from "../contract";
import type { ServerStatus } from "../toolsContract";
import { DAY_NAMES, describeSchedule, localStamp } from "../routineText";
import type { FlowHost, MessageReceived } from "./flowActions";
import { HARNESS_NAMES } from "./harness";
import type { Memory } from "./memory";
import { parseSchedule, type Routines } from "./routines";

/** A conversation as its type's fields read it. */
export interface ConversationFacts {
    title: string;
    messages: number;
}

export interface BlocksHost extends FlowHost {
    /** the id of the conversation the agent texts in */
    currentConversation(): string;
    /** the current conversation once it has messages, then the history, newest first */
    conversations(): string[];
    /** throws for a conversation the agent doesn't have */
    conversation(id: string): ConversationFacts;
    /** a conversation's texts, the user's and the agent's, oldest first */
    messages(conversation: string): string[];
    /** throws for a text in none of the agent's conversations */
    message(id: string): MessageFacts;
    /** a conversation in the history, for good */
    deleteConversation(id: string): unknown;
    /** the current conversation's messages and files, for good */
    clearConversation(): Promise<unknown>;
    memory: Pick<Memory, "list" | "readNote" | "addFact" | "editFact" | "deleteFact" | "saveNote" | "deleteNote">;
    routines: Pick<Routines, "list" | "add" | "remove">;
    computerRunning(): boolean;
    /** resolves once the computer is on; throws when it can't start */
    startComputer(): Promise<void>;
    stopComputer(): Promise<void>;
    models: {
        /** the current brain's models, as its own picker lists them; throws when it can't list them */
        list(): Promise<BrainModel[]>;
        /** the current brain's model, DEFAULT_MODEL when none is chosen; throws before the agent is set up */
        current(): string;
        /** saves the model, DEFAULT_MODEL for none, the way the agent's settings do */
        choose(model: string): Promise<void>;
    };
    brains: {
        state(): Record<Harness, BrainState>;
        /** throws before the agent is set up */
        current(): Harness;
        /** saves the brain the agent thinks with, on its default model; refused for one that isn't ready */
        choose(harness: Harness): Promise<void>;
        /** downloads its package; resolves once it's installed, throws when it couldn't be */
        install(harness: Harness): Promise<void>;
        /** has it run the program already on this computer; throws when there's none */
        useFound(harness: Harness): Promise<void>;
        signOut(harness: Harness): Promise<void>;
    };
    toolServers: {
        list(): ToolServerFacts[];
        setEnabled(name: string, on: boolean): Promise<unknown>;
        restart(name: string): Promise<unknown>;
    };
    apps: {
        list(): AppInfo[];
        remove(name: string): unknown;
    };
}

/** A tool server as its type's fields read it. */
export interface ToolServerFacts extends ServerStatus {
    enabled: boolean;
}

/** A text as its type's fields read it. */
export interface MessageFacts {
    text: string;
    from: "user" | "agent";
}

export const CATEGORY = { agent: "Agent", brain: "Brain", memory: "Memory", routines: "Routines", computer: "Computer", tools: "Tool Servers", apps: "Apps" };

const L = LIMITS.memory;

/** The days a daily routine runs on, as its dropdown offers them. */
const DAYS: Record<string, { label: string; days: readonly string[] }> = {
    "every-day": { label: "Every Day", days: DAY_NAMES },
    weekdays: { label: "Weekdays", days: ["mon", "tue", "wed", "thu", "fri"] },
    weekends: { label: "Weekends", days: ["sat", "sun"] },
    ...Object.fromEntries(
        ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"].map((label, i) => [DAY_NAMES[i]!, { label, days: [DAY_NAMES[i]!] }]),
    ),
};

const routineTask = { type: "text", name: "Task", description: "What the agent does when it's due, in words to the agent", maxLength: LIMITS.routines.whatChars } as const;

const instructions = {
    type: "text",
    name: "Instructions",
    description: "Added to what the agent is told for this, in place of the instructions for automations in the Agent panel's settings",
    optional: true,
    maxLength: LIMITS.instructions,
} as const;

const brainChoices = (only: (h: Harness) => boolean = () => true) => HARNESSES.filter(only).map((h) => ({ label: HARNESS_NAMES[h], value: h }));

const brainInput = { type: "brain", name: "Brain", choices: brainChoices() } as const;

export function flowBlocks(host: BlocksHost): BlockSet {
    const ready = async <T>(fn: () => Promise<T> | T) => {
        await host.ready();
        return fn();
    };
    const fact = async (id: string) => {
        const found = (await host.memory.list()).facts.find((f) => f.id === id);
        if (!found) throw new Error(`the agent has no fact "${id}"; it may have been forgotten`);
        return found;
    };
    const routine = (id: string): Routine => {
        const found = host.routines.list().find((r) => r.id === id);
        if (!found) throw new Error(`the agent has no routine "${id}"; it may have been cancelled, or was a one-time routine that already ran`);
        return found;
    };
    /** the current brain's models as its settings' dropdown offers them: its default, then what it lists */
    const models = async (): Promise<BrainModel[]> => {
        const harness = host.brains.current();
        const listed = await host.models.list();
        return [{ id: DEFAULT_MODEL, name: "Default", description: `Whatever ${HARNESS_NAMES[harness]} is set to use`, older: false }, ...listed];
    };
    const model = async (id: string) => {
        const found = (await models()).find((m) => m.id === id);
        if (!found) throw new Error(`${HARNESS_NAMES[host.brains.current()]} has no model "${id}"`);
        return found;
    };
    const brain = (id: string): BrainState => {
        if (!HARNESSES.includes(id as Harness)) throw new Error(`the agent has no brain "${id}"; its brains are ${HARNESSES.join(", ")}`);
        return host.brains.state()[id as Harness];
    };
    const brainName = (id: string) => {
        brain(id);
        return HARNESS_NAMES[id as Harness];
    };
    const toolServer = (name: string): ToolServerFacts => {
        const found = host.toolServers.list().find((s) => s.name === name);
        if (!found) throw new Error(`the agent has no tool server "${name}"; add it on the agent's Tools page`);
        return found;
    };
    const app = (name: string): AppInfo => {
        const found = host.apps.list().find((a) => a.name === name);
        if (!found) throw new Error(`the agent has no app "${name}"; it may have been deleted`);
        return found;
    };
    const serverInput = { type: "tool-server", name: "Tool Server", choices: () => host.toolServers.list().map((s) => ({ label: s.name, value: s.name })) } as const;
    const addRoutine = (what: string, schedule: Record<string, unknown>) =>
        ready(async () => (await host.routines.add(what, parseSchedule(schedule, Date.now()))).id);
    return {
        categories: [
            { name: CATEGORY.agent, icon: "robot_2" },
            { name: CATEGORY.brain, icon: "psychology" },
            { name: CATEGORY.memory, icon: "memory" },
            { name: CATEGORY.routines, icon: "schedule" },
            { name: CATEGORY.computer, icon: "computer" },
            { name: CATEGORY.tools, icon: "handyman" },
            { name: CATEGORY.apps, icon: "apps" },
        ],
        types: [
            {
                id: "conversation",
                name: "Conversation",
                icon: "forum",
                description: "One of the agent's conversations: the current one, or one in its history",
                base: "text",
                fields: {
                    title: { type: "text", name: "Title", description: "Its first message, cut short", resolve: (id: string) => ready(() => host.conversation(id).title) },
                    messages: { type: "number", name: "Messages", description: "How many texts it has, both sides", resolve: (id: string) => ready(() => host.conversation(id).messages) },
                },
            },
            {
                id: "message",
                name: "Message",
                icon: "chat_bubble",
                description: "One text in a conversation with the agent",
                base: "text",
                fields: {
                    text: { type: "text", name: "Text", resolve: (id: string) => ready(() => host.message(id).text) },
                    from: { type: "text", name: "From", description: "user or agent", resolve: (id: string) => ready(() => host.message(id).from) },
                },
            },
            {
                id: "fact",
                name: "Fact",
                icon: "lightbulb",
                description: "A short thing the agent remembers, always in its mind",
                base: "text",
                fields: {
                    text: { type: "text", name: "Text", resolve: (id: string) => ready(async () => (await fact(id)).text) },
                },
            },
            {
                id: "note",
                name: "Note",
                icon: "sticky_note_2",
                description: "A longer thing the agent remembers, by its key, read when it's needed",
                base: "text",
                fields: {
                    when: { type: "text", name: "When It's Needed", resolve: (key: string) => ready(async () => (await host.memory.readNote(key)).when) },
                    body: { type: "text", name: "Body", resolve: (key: string) => ready(async () => (await host.memory.readNote(key)).body) },
                },
            },
            {
                id: "routine",
                name: "Routine",
                icon: "event_repeat",
                description: "Something the agent does on a schedule",
                base: "text",
                fields: {
                    task: { type: "text", name: "Task", resolve: (id: string) => ready(() => routine(id).what) },
                    schedule: { type: "text", name: "Schedule", description: "Such as weekdays at 09:00", resolve: (id: string) => ready(() => describeSchedule(routine(id).schedule)) },
                    next: { type: "timestamp", name: "Next Run", optional: true, resolve: (id: string) => ready(() => routine(id).next) },
                    "last-run": { type: "timestamp", name: "Last Run", optional: true, resolve: (id: string) => ready(() => routine(id).lastRun) },
                    "last-error": {
                        type: "text",
                        name: "Last Error",
                        description: "Why its last run couldn't happen; none when it could",
                        optional: true,
                        resolve: (id: string) => ready(() => routine(id).lastError),
                    },
                },
            },
            {
                id: "model",
                name: "Model",
                icon: "neurology",
                description: "A model the agent's brain can think with, by its id; default is whatever the brain is set to use",
                base: "text",
                fields: {
                    name: { type: "text", name: "Name", resolve: (id: string) => ready(async () => (await model(id)).name) },
                    description: { type: "text", name: "Description", optional: true, resolve: (id: string) => ready(async () => (await model(id)).description) },
                    older: { type: "boolean", name: "Older", description: "The brain lists it among its older models", resolve: (id: string) => ready(async () => (await model(id)).older) },
                },
            },
            {
                id: "brain",
                name: "Brain",
                icon: "psychology",
                description: "An agent harness the agent can think with: codex, claude-code or opencode",
                base: "text",
                fields: {
                    name: { type: "text", name: "Name", resolve: (id: string) => ready(() => brainName(id)) },
                    status: {
                        type: "text",
                        name: "Status",
                        description: "none, unsupported, installing, installed, signing-in, ready or failed",
                        resolve: (id: string) => ready(() => brain(id).phase),
                    },
                    installed: { type: "boolean", name: "Installed", resolve: (id: string) => ready(() => brain(id).installed) },
                    "signed-in": { type: "boolean", name: "Signed In", resolve: (id: string) => ready(() => brain(id).signedIn) },
                    version: { type: "text", name: "Version", optional: true, resolve: (id: string) => ready(() => brain(id).version) },
                    account: { type: "text", name: "Account", description: "Who it's signed in as, when it says", optional: true, resolve: (id: string) => ready(() => brain(id).account) },
                    error: { type: "text", name: "Error", description: "Why its last install, sign-in or check failed", optional: true, resolve: (id: string) => ready(() => brain(id).error) },
                },
            },
            {
                id: "tool-server",
                name: "Tool Server",
                icon: "dns",
                description: "A tool server (MCP) the agent can use, by its name",
                base: "text",
                fields: {
                    name: { type: "text", name: "Name", resolve: (name: string) => ready(() => toolServer(name).name) },
                    enabled: { type: "boolean", name: "On", description: "It's switched on for the agent", resolve: (name: string) => ready(() => toolServer(name).enabled) },
                    status: { type: "text", name: "Status", description: "stopped, starting, running or failed; stopped while it's off", resolve: (name: string) => ready(() => toolServer(name).phase) },
                    error: { type: "text", name: "Error", description: "Why it failed", optional: true, resolve: (name: string) => ready(() => toolServer(name).error) },
                    tools: { type: "number", name: "Tools", description: "How many tools it offers while it's running", resolve: (name: string) => ready(() => toolServer(name).tools) },
                },
            },
            {
                id: "app",
                name: "App",
                icon: "web",
                description: "A web page the agent made for the user, by its name",
                base: "text",
                fields: {
                    title: { type: "text", name: "Title", resolve: (name: string) => ready(() => app(name).title) },
                    description: { type: "text", name: "Description", optional: true, resolve: (name: string) => ready(() => app(name).description || null) },
                },
            },
            {
                id: "attachment",
                name: "Attachment",
                icon: "attach_file",
                description: "A file the agent sent with a text",
                base: "object",
                fields: {
                    name: { type: "text", name: "Name" },
                    kind: { type: "text", name: "Kind", description: "image, video or file" },
                    type: { type: "text", name: "Media Type" },
                    bytes: { type: "number", name: "Size", description: "In bytes" },
                    path: { type: "text", name: "Path", description: "Where the file is on this computer" },
                },
            },
        ],
        values: [
            {
                id: "current-conversation",
                name: "Current Conversation",
                category: CATEGORY.agent,
                icon: "chat",
                description: "The conversation the agent texts in",
                type: "conversation",
                changes: true,
                read: () => ready(() => host.currentConversation()),
            },
            {
                id: "conversations",
                name: "Conversations",
                category: CATEGORY.agent,
                icon: "forum",
                description: "The current conversation, once it has messages, then the agent's history, newest first",
                type: "list<conversation>",
                changes: true,
                read: () => ready(() => host.conversations()),
            },
            {
                id: "messages",
                name: "Messages",
                category: CATEGORY.agent,
                icon: "chat_bubble",
                description: "The texts in a conversation, the user's and the agent's, oldest first",
                text: "messages in {conversation}",
                inputs: { conversation: { type: "conversation", name: "Conversation" } },
                type: "list<message>",
                read: ({ conversation }: { conversation: string }) => ready(() => host.messages(conversation.trim())),
            },
            {
                id: "facts",
                name: "Facts",
                category: CATEGORY.memory,
                icon: "lightbulb",
                description: "The short things the agent remembers",
                type: "list<fact>",
                changes: true,
                read: () => ready(async () => (await host.memory.list()).facts.map((f) => f.id)),
            },
            {
                id: "notes",
                name: "Notes",
                category: CATEGORY.memory,
                icon: "sticky_note_2",
                description: "The longer things the agent remembers, by key",
                type: "list<note>",
                changes: true,
                read: () => ready(async () => (await host.memory.list()).notes.map((n) => n.key)),
            },
            {
                id: "routines",
                name: "Routines",
                category: CATEGORY.routines,
                icon: "event_repeat",
                description: "What the agent does on a schedule, soonest first",
                type: "list<routine>",
                changes: true,
                read: () => ready(() => host.routines.list().map((r) => r.id)),
            },
            {
                id: "current-brain",
                name: "Current Brain",
                category: CATEGORY.brain,
                icon: "psychology",
                description: "The brain the agent thinks with",
                type: "brain",
                changes: true,
                read: () => ready(() => host.brains.current()),
            },
            {
                id: "brains",
                name: "Brains",
                category: CATEGORY.brain,
                icon: "psychology",
                description: "Every brain the agent can think with, installed or not",
                type: "list<brain>",
                read: () => ready(() => [...HARNESSES]),
            },
            {
                id: "current-model",
                name: "Current Model",
                category: CATEGORY.brain,
                icon: "neurology",
                description: "The model the agent's brain thinks with; default when it's left to the brain",
                type: "model",
                changes: true,
                read: () => ready(() => host.models.current()),
            },
            {
                id: "models",
                name: "Models",
                category: CATEGORY.brain,
                icon: "neurology",
                description: "The models the agent's current brain offers, default first, as it lists them. Fails when it can't list them.",
                type: "list<model>",
                read: () => ready(async () => (await models()).map((m) => m.id)),
            },
            {
                id: "tool-servers",
                name: "Tool Servers",
                category: CATEGORY.tools,
                icon: "dns",
                description: "The tool servers on the agent's Tools page, on or off",
                type: "list<tool-server>",
                changes: true,
                read: () => ready(() => host.toolServers.list().map((s) => s.name)),
            },
            {
                id: "apps",
                name: "Apps",
                category: CATEGORY.apps,
                icon: "web",
                description: "The apps the agent made, newest first",
                type: "list<app>",
                changes: true,
                read: () => ready(() => host.apps.list().map((a) => a.name)),
            },
            {
                id: "computer-running",
                name: "Computer Running",
                category: CATEGORY.computer,
                icon: "computer",
                description: "The agent's computer is on",
                type: "boolean",
                changes: true,
                read: () => ready(() => host.computerRunning()),
            },
        ],
        commands: [
            {
                id: "switch-conversation",
                name: "Switch Conversation",
                category: CATEGORY.agent,
                icon: "swap_horiz",
                description: "Makes a conversation the one the agent texts in; the current one goes into the history",
                text: "switch the agent to {conversation}",
                inputs: { conversation: { type: "conversation", name: "Conversation" } },
                output: "conversation",
                run: ({ conversation }: { conversation: string }) => ready(() => host.switchConversation(conversation.trim())),
            },
            {
                id: "new-conversation",
                name: "New Conversation",
                category: CATEGORY.agent,
                icon: "add_comment",
                description: "Starts a fresh conversation for the agent to text in; the current one goes into the history",
                text: "start a new conversation with the agent",
                output: "conversation",
                run: () => ready(() => host.switchConversation(null)),
            },
            {
                id: "clear-conversation",
                name: "Clear Conversation",
                category: CATEGORY.agent,
                icon: "delete_sweep",
                description: "Deletes every message and file in the current conversation, for good; the agent starts over",
                text: "clear the agent's current conversation",
                run: () => ready(async () => void (await host.clearConversation())),
            },
            {
                id: "delete-conversation",
                name: "Delete Conversation",
                category: CATEGORY.agent,
                icon: "delete",
                description: "Deletes a conversation in the history, for good. The current one can only be cleared.",
                text: "delete {conversation}",
                inputs: { conversation: { type: "conversation", name: "Conversation" } },
                run: ({ conversation }: { conversation: string }) => ready(() => void host.deleteConversation(conversation.trim())),
            },
            {
                id: "send-message",
                name: "Text the Agent",
                category: CATEGORY.agent,
                icon: "send",
                description:
                    "Texts the agent in its current conversation and goes on without waiting; its reply starts When the Agent Replies. Answering a flow, the agent can't sign in anywhere or show apps.",
                text: "text the agent {message} following {instructions}",
                inputs: {
                    message: { type: "text", name: "Message", maxLength: LIMITS.message },
                    instructions,
                },
                output: "message",
                run: ({ message, instructions }: { message: string; instructions?: string }) =>
                    ready(() => host.send(message, instructions?.trim() || undefined)),
            },
            {
                id: "get-answer",
                name: "Ask the Agent",
                category: CATEGORY.agent,
                icon: "question_answer",
                description:
                    "Asks the agent one question and gives back its answer. It's answered on its own: no conversation, no memory and no computer, only web search. Fails if the answer takes longer than 28 seconds.",
                text: "the agent's answer to {question} following {instructions}",
                inputs: {
                    question: { type: "text", name: "Question", maxLength: LIMITS.message },
                    instructions,
                },
                output: "text",
                run: ({ question, instructions }: { question: string; instructions?: string }) =>
                    ready(() => host.ask(question, instructions?.trim() || undefined)),
            },
            {
                id: "add-fact",
                name: "Add Fact",
                category: CATEGORY.memory,
                icon: "add",
                description: "Has the agent remember a short thing, one line; one it remembers already is given back as it is",
                text: "have the agent remember {text}",
                inputs: { text: { type: "text", name: "Text", maxLength: L.factChars } },
                output: "fact",
                run: ({ text }: { text: string }) => ready(async () => (await host.memory.addFact(text)).id),
            },
            {
                id: "edit-fact",
                name: "Edit Fact",
                category: CATEGORY.memory,
                icon: "edit",
                text: "change {fact} to {text}",
                inputs: {
                    fact: { type: "fact", name: "Fact" },
                    text: { type: "text", name: "Text", maxLength: L.factChars },
                },
                output: "fact",
                run: ({ fact, text }: { fact: string; text: string }) => ready(async () => (await host.memory.editFact(fact, text)).id),
            },
            {
                id: "forget-fact",
                name: "Forget Fact",
                category: CATEGORY.memory,
                icon: "delete",
                text: "have the agent forget {fact}",
                inputs: { fact: { type: "fact", name: "Fact" } },
                run: ({ fact }: { fact: string }) => ready(() => host.memory.deleteFact(fact)),
            },
            {
                id: "save-note",
                name: "Save Note",
                category: CATEGORY.memory,
                icon: "note_add",
                description: "Saves a note for the agent, replacing the one with its key. Keys are lowercase letters, digits and dashes.",
                text: "save note {key} needed {when} saying {body}",
                inputs: {
                    key: { type: "text", name: "Key", maxLength: L.keyChars },
                    when: { type: "text", name: "When It's Needed", description: "One line the agent reads to know when to read the note", maxLength: L.whenChars },
                    body: { type: "text", name: "Body", description: `At most ${L.bodyBytes / 1024} KiB` },
                },
                output: "note",
                run: ({ key, when, body }: { key: string; when: string; body: string }) => ready(async () => (await host.memory.saveNote(key, when, body)).key),
            },
            {
                id: "delete-note",
                name: "Delete Note",
                category: CATEGORY.memory,
                icon: "delete",
                text: "delete {note}",
                inputs: { note: { type: "note", name: "Note" } },
                run: ({ note }: { note: string }) => ready(() => host.memory.deleteNote(note)),
            },
            {
                id: "add-routine-once",
                name: "Add One-Time Routine",
                category: CATEGORY.routines,
                icon: "event",
                description: "Has the agent do something once, at a time to the minute; When a Routine Fires starts with it",
                text: "have the agent {task} at {at}",
                inputs: { task: routineTask, at: { type: "timestamp", name: "Time" } },
                output: "routine",
                run: ({ task, at }: { task: string; at: number }) => addRoutine(task, { at: localStamp(at) }),
            },
            {
                id: "add-routine-daily",
                name: "Add Daily Routine",
                category: CATEGORY.routines,
                icon: "event_repeat",
                description: "Has the agent do something at a time of day, on the days chosen, in this computer's time zone",
                text: "have the agent {task} {days} at {time}",
                inputs: {
                    task: routineTask,
                    days: { type: "text", name: "Days", default: "every-day", choices: Object.entries(DAYS).map(([value, d]) => ({ label: d.label, value })) },
                    time: { type: "text", name: "Time", description: "24-hour, like 09:00", maxLength: 5 },
                },
                output: "routine",
                run: ({ task, days, time }: { task: string; days: string; time: string }) => addRoutine(task, { time: time.trim(), days: [...DAYS[days]!.days] }),
            },
            {
                id: "add-routine-repeating",
                name: "Add Repeating Routine",
                category: CATEGORY.routines,
                icon: "autorenew",
                description: `Has the agent do something every so many minutes, at least ${LIMITS.routines.minEveryMinutes}, starting from now`,
                text: "have the agent {task} every {minutes} minutes",
                inputs: {
                    task: routineTask,
                    minutes: { type: "number", name: "Minutes", integer: true, min: LIMITS.routines.minEveryMinutes, max: 7 * 24 * 60 },
                },
                output: "routine",
                run: ({ task, minutes }: { task: string; minutes: number }) => addRoutine(task, { every_minutes: minutes }),
            },
            {
                id: "cancel-routine",
                name: "Cancel Routine",
                category: CATEGORY.routines,
                icon: "event_busy",
                text: "cancel {routine}",
                inputs: { routine: { type: "routine", name: "Routine" } },
                run: ({ routine }: { routine: string }) => ready(async () => void (await host.routines.remove(routine))),
            },
            {
                id: "switch-brain",
                name: "Switch Brain",
                category: CATEGORY.brain,
                icon: "swap_horiz",
                description: "Has the agent think with another brain, on its default model. Fails when that brain isn't installed and signed in.",
                text: "have the agent think with {brain}",
                inputs: { brain: brainInput },
                run: ({ brain }: { brain: Harness }) => ready(() => host.brains.choose(brain)),
            },
            {
                id: "switch-model",
                name: "Switch Model",
                category: CATEGORY.brain,
                icon: "tune",
                description: "Has the agent's brain think with one of its models, or its default",
                text: "have the agent think with {model}",
                inputs: { model: { type: "model", name: "Model", choices: async () => (await models()).map((m) => ({ label: m.name, value: m.id })) } },
                run: ({ model }: { model: string }) => ready(() => host.models.choose(model)),
            },
            {
                id: "install-brain",
                name: "Install Brain",
                category: CATEGORY.brain,
                icon: "download",
                description: "Downloads and installs a brain, waiting until it's done. Codex and Claude need signing in to in the Agent panel after.",
                text: "install {brain}",
                inputs: { brain: brainInput },
                run: ({ brain: id }: { brain: Harness }) =>
                    ready(() => {
                        const b = brain(id);
                        if (b.phase === "installing") throw new Error(`${HARNESS_NAMES[id]} is installing already`);
                        if (b.installed && b.phase !== "failed" && !b.existing) throw new Error(`${HARNESS_NAMES[id]} is installed already`);
                        return host.brains.install(id);
                    }),
            },
            {
                id: "use-brain-on-computer",
                name: "Use Brain on This Computer",
                category: CATEGORY.brain,
                icon: "computer",
                description: "Has a brain run the Codex, Claude or OpenCode already on this computer instead of downloading one. Fails when it isn't there, or the brain is installed already.",
                text: "use the {brain} on this computer",
                inputs: { brain: brainInput },
                run: ({ brain: id }: { brain: Harness }) =>
                    ready(() => {
                        if (brain(id).existing) throw new Error(`${HARNESS_NAMES[id]} uses the one on this computer already`);
                        return host.brains.useFound(id);
                    }),
            },
            {
                id: "sign-out-brain",
                name: "Sign Out of Brain",
                category: CATEGORY.brain,
                icon: "logout",
                description: "Signs a brain out of its account; the agent can't think with it until it's signed in again in the Agent panel",
                text: "sign {brain} out",
                inputs: { brain: { type: "brain", name: "Brain", choices: brainChoices((h) => SIGN_IN_REQUIRED[h]) } },
                run: ({ brain: id }: { brain: Harness }) =>
                    ready(() => {
                        if (!brain(id).signedIn) throw new Error(`${HARNESS_NAMES[id]} isn't signed in`);
                        return host.brains.signOut(id);
                    }),
            },
            {
                id: "turn-on-tool-server",
                name: "Turn On Tool Server",
                category: CATEGORY.tools,
                icon: "play_arrow",
                description: "Switches a tool server on for the agent; it starts when the agent next needs its tools",
                text: "turn on {server}",
                inputs: { server: serverInput },
                run: ({ server }: { server: string }) => ready(async () => void (await host.toolServers.setEnabled(toolServer(server).name, true))),
            },
            {
                id: "turn-off-tool-server",
                name: "Turn Off Tool Server",
                category: CATEGORY.tools,
                icon: "pause",
                description: "Switches a tool server off and stops it; the agent can't use its tools until it's on again",
                text: "turn off {server}",
                inputs: { server: serverInput },
                run: ({ server }: { server: string }) => ready(async () => void (await host.toolServers.setEnabled(toolServer(server).name, false))),
            },
            {
                id: "restart-tool-server",
                name: "Restart Tool Server",
                category: CATEGORY.tools,
                icon: "restart_alt",
                description: "Stops a tool server that's on and starts it again, waiting until it's running or has failed",
                text: "restart {server}",
                inputs: { server: serverInput },
                run: ({ server }: { server: string }) =>
                    ready(async () => {
                        if (!toolServer(server).enabled) throw new Error(`${server} is switched off: turn it on first`);
                        await host.toolServers.restart(server);
                        const after = toolServer(server);
                        if (after.phase === "failed") throw new Error(`${server} didn't start: ${after.error}`);
                    }),
            },
            {
                id: "delete-app",
                name: "Delete App",
                category: CATEGORY.apps,
                icon: "delete",
                description: "Deletes one of the agent's apps for good: its folder and its picture. Cards that showed it can't open it anymore.",
                text: "delete {app}",
                inputs: { app: { type: "app", name: "App", choices: () => host.apps.list().map((a) => ({ label: a.title, value: a.name })) } },
                run: ({ app: name }: { app: string }) => ready(() => void host.apps.remove(app(name).name)),
            },
            {
                id: "start-computer",
                name: "Start Computer",
                category: CATEGORY.computer,
                icon: "power_settings_new",
                description: "Turns on the agent's computer and waits until it's on. Fails when it isn't set up yet.",
                text: "start the agent's computer",
                run: () => ready(() => host.startComputer()),
            },
            {
                id: "stop-computer",
                name: "Stop Computer",
                category: CATEGORY.computer,
                icon: "power_off",
                description: "Turns off the agent's computer; it can't browse until it's on again",
                text: "stop the agent's computer",
                run: () => ready(() => host.stopComputer()),
            },
        ],
        events: [
            {
                id: "message-received",
                name: "When the Agent Replies",
                category: CATEGORY.agent,
                icon: "mark_chat_unread",
                description: "Fires for each text the agent sends, in whichever conversation is current",
                text: "when the agent texts in {conversation}",
                inputs: { conversation: { type: "conversation", name: "Conversation", optional: true } },
                filters: { conversation: "conversation" },
                values: {
                    text: { type: "text", name: "Text" },
                    attachments: { type: "list<attachment>", name: "Attachments", description: "The files sent with it; empty when there are none" },
                    message: { type: "message", name: "Message" },
                    conversation: { type: "conversation", name: "Conversation" },
                    "reply-to": { type: "message", name: "Replying To", description: "The message it quotes; none when it quotes none", optional: true },
                },
            },
            {
                id: "turn-failed",
                name: "When the Agent's Turn Fails",
                category: CATEGORY.agent,
                icon: "error",
                description: "Fires when the agent couldn't answer: its brain failed, or the turn ended without a reply",
                text: "when the agent can't answer in {conversation}",
                inputs: { conversation: { type: "conversation", name: "Conversation", optional: true } },
                filters: { conversation: "conversation" },
                values: {
                    error: { type: "text", name: "Error" },
                    conversation: { type: "conversation", name: "Conversation" },
                },
            },
            {
                id: "routine-fired",
                name: "When a Routine Fires",
                category: CATEGORY.routines,
                icon: "alarm",
                description: "Fires when one of the agent's routines is due and the agent starts on it",
                text: "when {routine} fires",
                inputs: { routine: { type: "routine", name: "Routine", optional: true } },
                filters: { routine: "routine" },
                values: {
                    routine: { type: "routine", name: "Routine", description: "A one-time routine is gone once it's run" },
                    task: { type: "text", name: "Task" },
                    late: { type: "boolean", name: "Late", description: "It was due while this computer was asleep or off" },
                },
            },
        ],
    };
}

/** The reply as When the Agent Replies fires it. */
export function replyPayload(message: MessageReceived): Record<string, unknown> {
    return {
        text: message.text,
        attachments: message.attachments.map((a) => ({ ...a })),
        message: message.messageId,
        conversation: message.conversationId,
        // the Actions payload says "none" with empty text; a block says it with no value
        "reply-to": message.replyTo || null,
    };
}
