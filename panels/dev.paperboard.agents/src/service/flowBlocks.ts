// What the Blocks panel can do with the agent (Actions API v2). The actions
// (v1, flowActions.ts) stay as they are; both run the same FlowHost.

import type { BlockSet } from "@mileniumhq/paperapi";
import { LIMITS } from "../contract";
import type { FlowHost, MessageReceived } from "./flowActions";

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
}

export const CATEGORY = "Agent";

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
                category: CATEGORY,
                icon: "chat",
                description: "The conversation the agent texts in",
                type: "conversation",
                changes: true,
                read: () => ready(() => host.currentConversation()),
            },
            {
                id: "conversations",
                name: "Conversations",
                category: CATEGORY,
                icon: "forum",
                description: "The current conversation, once it has messages, then the agent's history, newest first",
                type: "list<conversation>",
                changes: true,
                read: () => ready(() => host.conversations()),
            },
        ],
        commands: [
            {
                id: "switch-conversation",
                name: "Switch Conversation",
                category: CATEGORY,
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
                category: CATEGORY,
                icon: "add_comment",
                description: "Starts a fresh conversation for the agent to text in; the current one goes into the history",
                text: "start a new conversation with the agent",
                output: "conversation",
                run: () => ready(() => host.switchConversation(null)),
            },
            {
                id: "send-message",
                name: "Text the Agent",
                category: CATEGORY,
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
                category: CATEGORY,
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
        ],
        events: [
            {
                id: "message-received",
                name: "When the Agent Replies",
                category: CATEGORY,
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
