// What flows can do with the agent: the actions and the event the Actions
// library offers. The conversation dropdown lists the history as it is now,
// so these are built again (and registered again) whenever it changes.

import { defineAction, type ActionDefinition } from "@mileniumhq/paperapi";
import { ACTION_IDS, LIMITS, TRIGGER_IDS } from "../contract";

/** One conversation in the dropdown: its title, valued by its id. */
export interface ConversationChoice {
    label: string;
    value: string;
}

/** What the actions do, which app.ts provides. */
export interface FlowHost {
    ready(): Promise<void>;
    /** start a new conversation (null) or continue the one with this id; resolves with the current conversation's id */
    switchConversation(id: string | null): Promise<string>;
    /** the user's message, sent as if they'd typed it; resolves with its id */
    send(text: string, instructions?: string): string;
    ask(question: unknown, instructions?: string): Promise<string>;
}

/** A file the agent sent with a reply, as a flow gets it. */
export interface ReplyAttachment {
    name: string;
    kind: "image" | "video" | "file";
    /** its media type */
    type: string;
    bytes: number;
    /** the file on this computer */
    path: string;
}

/** What the message-received event carries. */
export interface MessageReceived {
    text: string;
    /** the files sent with it; empty when there are none */
    attachments: ReplyAttachment[];
    messageId: string;
    conversationId: string;
    /** the message it answers, if it quoted one; empty otherwise */
    replyTo: string;
}

// both actions' own instructions, in place of the ones in the panel's settings
const instructionsInput = {
    type: "string",
    label: "Instructions",
    description: "Added to what the agent is told for this. Replaces the instructions for automations in the Agent panel's settings; leave it empty to use those.",
    placeholder: "Instructions from settings",
    maxLength: LIMITS.instructions,
    multiline: true,
};

/** An optional text input: empty or absent is none. */
function optionalText(v: unknown, name: string): string | undefined {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string") throw new Error(`${name} is text`);
    return v.trim() || undefined;
}

export const CATEGORY = { name: "Agent", icon: "forum", order: 1 };

export function flowActions(host: FlowHost, conversations: ConversationChoice[]): ActionDefinition[] {
    const ready = async <T>(fn: () => Promise<T> | T) => {
        await host.ready();
        return fn();
    };
    return [
        defineAction({
            id: ACTION_IDS.switchConversation,
            name: "Switch Conversation",
            category: CATEGORY,
            description:
                "Makes a conversation the current one, the one the agent texts in. Leave it as New conversation to start a fresh one; the current one goes into the history either way.",
            template: "Switch the agent to {conversation}",
            inputs: {
                conversation: {
                    type: "string",
                    label: "Conversation",
                    allowEmpty: true,
                    emptyLabel: "New conversation",
                    description: "The current conversation and the ones in the agent's history.",
                    options: conversations,
                },
            },
            output: { type: "string", label: "Conversation id" },
            icon: "swap_horiz",
            run: (_ctx, inputs: { conversation?: unknown }) =>
                ready(() => {
                    const id = inputs?.conversation;
                    if (id !== undefined && id !== null && typeof id !== "string") throw new Error("the conversation is its id");
                    return host.switchConversation(typeof id === "string" && id.trim() ? id.trim() : null);
                }),
        }),
        defineAction({
            id: ACTION_IDS.sendMessage,
            name: "Send Message to Agent",
            category: CATEGORY,
            description:
                "Texts the agent in its current conversation and goes on without waiting. Its reply starts When Agent Replies, as text and a list of files. Answering a flow, the agent can't sign in anywhere or show apps, and it waits for anything you're already asking it in the chat.",
            template: "Text the agent {text}",
            inputs: {
                text: { type: "string", label: "Message", required: true, placeholder: "Message", maxLength: LIMITS.message, multiline: true },
                instructions: instructionsInput,
            },
            output: { type: "string", label: "Message id" },
            icon: "send",
            run: (_ctx, inputs: { text?: unknown; instructions?: unknown }) =>
                ready(() => {
                    if (typeof inputs?.text !== "string") throw new Error("the message is text");
                    return host.send(inputs.text, optionalText(inputs.instructions, "instructions"));
                }),
        }),
        defineAction({
            id: ACTION_IDS.getAnswer,
            name: "Get Answer from Agent",
            category: CATEGORY,
            description:
                "Asks the agent one question and returns its answer. It's answered on its own: no conversation, no memory and no computer, only web search, and nothing shows in the chat. Fails if the answer takes longer than 28 seconds.",
            template: "Ask the agent {question}",
            inputs: {
                question: { type: "string", label: "Question", required: true, placeholder: "Question", maxLength: LIMITS.message, multiline: true },
                instructions: instructionsInput,
            },
            output: { type: "string", label: "Answer" },
            icon: "question_answer",
            run: (_ctx, inputs: { question?: unknown; instructions?: unknown }) =>
                ready(() => host.ask(inputs?.question, optionalText(inputs?.instructions, "instructions"))),
        }),
        defineAction({
            id: TRIGGER_IDS.messageReceived,
            name: "When Agent Replies",
            category: CATEGORY,
            description: "Fires for each text the agent sends, in whichever conversation is current.",
            template: "When the agent texts",
            output: { type: "object", label: "Message" },
            outputFields: {
                text: { type: "string", label: "Response text" },
                attachments: {
                    type: "list<object>",
                    label: "Attachments",
                    description: "The files sent with it, each with its name, kind (image, video or file), type, bytes and path on this computer. Empty when there are none.",
                },
                messageId: { type: "string", label: "Message id" },
                conversationId: { type: "string", label: "Conversation id" },
                replyTo: { type: "string", label: "Replying to", description: "The id of the message it quotes; empty when it quotes none." },
            },
            icon: "mark_chat_unread",
        }),
    ];
}
