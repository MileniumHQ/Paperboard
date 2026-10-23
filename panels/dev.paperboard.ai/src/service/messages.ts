// The messages toolset: how the agent texts. Each send_message call puts one
// bubble in the conversation right away, even in the middle of a turn, so
// the agent can say a thing, keep working, and say another.

import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import type { Toolset } from "./toolsets";

export const MESSAGES_INSTRUCTIONS = `How you talk: the only way the user hears you is \`send_message\`. Each call is one text bubble in the conversation, shown right away.
- One thought per bubble. Several short bubbles are fine, the way a friend texts; don't write one long message.
- Messages are labelled with an id like [k3x9f2]. When you're answering one of several messages, or following up on something said earlier, pass that id as \`reply_to\` so the bubble shows what it answers. Otherwise leave it out.
- Never narrate your tool use ("let me open…", "now I'll click…"). Do the work, then text what came of it. Text mid-task only when you need something from them, or a long task has news worth hearing.
- Don't write a final answer as plain output; send it with \`send_message\`.`;

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

/** What the conversation lets the toolset do: add the agent's bubble. Throws if the text or the reply target is refused. */
export interface Texter {
    say(text: string, replyTo: string | null): { id: string };
}

export function messagesToolset(texter: Texter): Toolset {
    return {
        id: "messages",
        tools: () => MESSAGE_TOOLS,
        instructions: () => MESSAGES_INSTRUCTIONS,
        call: async (name, args): Promise<ToolResult> => {
            if (name !== "send_message") return { text: `unknown tool ${name}`, isError: true };
            if (typeof args.text !== "string") return { text: "text must be a string", isError: true };
            if (args.reply_to !== undefined && args.reply_to !== null && typeof args.reply_to !== "string") {
                return { text: "reply_to must be a message id", isError: true };
            }
            try {
                const { id } = texter.say(args.text, (args.reply_to as string | null | undefined) || null);
                return { text: `sent [${id}]` };
            } catch (e) {
                // a refused message is the model's to fix (a wrong id, no text), never silently dropped
                return { text: e instanceof Error ? e.message : String(e), isError: true };
            }
        },
    };
}
