// What the Blocks panel can do with the agent (Actions API v2). The actions
// (v1, flowActions.ts) stay as they are; both run the same FlowHost.

import type { BlockSet } from "@mileniumhq/paperapi";
import { LIMITS, type Routine } from "../contract";
import { DAY_NAMES, describeSchedule, localStamp } from "../routineText";
import type { FlowHost, MessageReceived } from "./flowActions";
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
}

/** A text as its type's fields read it. */
export interface MessageFacts {
    text: string;
    from: "user" | "agent";
}

export const CATEGORY = { agent: "Agent", memory: "Memory", routines: "Routines", computer: "Computer" };

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
    const addRoutine = (what: string, schedule: Record<string, unknown>) =>
        ready(async () => (await host.routines.add(what, parseSchedule(schedule, Date.now()))).id);
    return {
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
