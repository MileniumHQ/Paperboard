// The messages toolset: how the agent texts. Each send_message call puts one
// bubble in the conversation right away, even in the middle of a turn, so
// the agent can say a thing, keep working, and say another.

import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import { USER_TURN, type Toolset } from "./toolsets";

// How the agent texts is in the core of its instructions (harness.ts); this is only the tool.

export const MESSAGE_TOOLS: ToolSpec[] = [
    {
        name: "send_message",
        description: "Text the user: adds one bubble to the conversation right away. A whole reply goes in one message, never split across several.",
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string", description: "The message. Markdown works." },
                reply_to: { type: "string", description: "Id of an earlier message (theirs or yours), like k3x9f2 from [k3x9f2], when this answers one of several or something said earlier. Optional." },
            },
            required: ["text"],
        },
    },
];

// a reply to a flow: files go along in a list the flow can read
const MESSAGE_FLOW_TOOLS: ToolSpec[] = [
    {
        name: "send_message",
        description: "Reply to the automation that messaged you. Its text, and the files that go with it.",
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string", description: "The reply, plain text, with no files or images in it." },
                files: { type: "array", items: { type: "string" }, description: "Ids of files in the conversation to send with it (share_file gives one). Optional." },
                reply_to: { type: "string", description: "Id of an earlier message (theirs or yours) this one answers. Optional." },
            },
            required: ["text"],
        },
    },
];

/** What the conversation lets the toolset do: add the agent's bubble. Throws if the text, the files or the reply target is refused. */
export interface Texter {
    say(text: string, replyTo: string | null, files?: string[]): { id: string };
}

export function messagesToolset(texter: Texter): Toolset {
    return {
        id: "messages",
        tools: (mode) => (mode.fromFlow ? MESSAGE_FLOW_TOOLS : MESSAGE_TOOLS),
        call: async (name, args, mode = USER_TURN): Promise<ToolResult> => {
            if (name !== "send_message") return { text: `unknown tool ${name}`, isError: true };
            if (typeof args.text !== "string") return { text: "text must be a string", isError: true };
            if (args.reply_to !== undefined && args.reply_to !== null && typeof args.reply_to !== "string") {
                return { text: "reply_to must be a message id", isError: true };
            }
            let files: string[] | undefined;
            if (mode.fromFlow && args.files !== undefined && args.files !== null) {
                if (!Array.isArray(args.files) || !args.files.every((f) => typeof f === "string")) return { text: "files must be a list of file ids", isError: true };
                files = args.files as string[];
            }
            // inline files show only in the chat: a flow gets the text as it is
            if (mode.fromFlow && /\]\(\s*<?attachment:/.test(args.text)) {
                return { text: "Don't put files in the text: pass their ids in files instead.", isError: true };
            }
            try {
                const { id } = texter.say(args.text, (args.reply_to as string | null | undefined) || null, files);
                return { text: `sent [${id}]` };
            } catch (e) {
                // a refused message is the model's to fix (a wrong id, no text), never silently dropped
                return { text: e instanceof Error ? e.message : String(e), isError: true };
            }
        },
    };
}
