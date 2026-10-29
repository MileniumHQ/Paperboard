// The messages toolset: how the agent texts. Each send_message call puts one
// bubble in the conversation right away, even in the middle of a turn, so
// the agent can say a thing, keep working, and say another.

import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import { USER_TURN, type Toolset } from "./toolsets";

export const MESSAGES_INSTRUCTIONS = `How you talk: the only way the user hears you is \`send_message\`. Each call is one text bubble in the conversation, shown right away.
- One thought per bubble. Several short bubbles are fine, the way a friend texts; don't write one long message.
- Messages are labelled with an id like [k3x9f2]. When you're answering one of several messages, or following up on something said earlier, pass that id as \`reply_to\` so the bubble shows what it answers. Otherwise leave it out.
- When a message needs any other tool (opening something, signing in, looking something up), answer it first: your first call is \`send_message\` with one short line, and only then the other tools ("Alright, give me a second to open it", "On it, checking the train times"). Never go quiet and start working first: they can't see your tools, so silence looks like being ignored. A quick answer you already know needs no heads-up.
- After that, don't narrate each step ("now I'll click…"). Do the work, then text what came of it. Text mid-task only when you need something from them, or a long task has news worth hearing.
- They can text you while you work: your work stops there, and you carry on with their message. Answer it with \`send_message\`. If they change what they want, or ask you to stop, do that; otherwise pick up the task where you left it.
- Don't write a final answer as plain output; send it with \`send_message\`.`;

export const MESSAGES_FLOW_INSTRUCTIONS = `**Replying to a flow:** this message came from one of the user's Paperboard automations, not from them. Your reply goes back to it as data, and the user may read it in the chat too.
- **Reply once:** one \`send_message\` with the result. No heads-up, narration or questions.
- **Plain text:** files go in \`files\` by id (\`share_file\` gives one), never in the text.
- **No sign-ins:** use sites you're already signed in to. If one needs a sign-in, reply saying so.
- **No showing apps:** say an app's title; the user opens it from their apps.
- **Stuck:** reply with what's in the way.`;

export const MESSAGE_TOOLS: ToolSpec[] = [
    {
        name: "send_message",
        description: "Text the user: adds one bubble to the conversation right away. Keep it to one thought; send several for several thoughts.",
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string", description: "The message. Markdown works." },
                reply_to: { type: "string", description: "Id of an earlier message (theirs or yours) this one answers. Optional." },
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
        instructions: (mode) => (mode.fromFlow ? MESSAGES_FLOW_INSTRUCTIONS : MESSAGES_INSTRUCTIONS),
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
