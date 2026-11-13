// The files toolset: the agent's side of the conversation's files. It can
// look at what the user attached, put a file on its computer to work with
// it, and share a file from its computer, which it then shows inline in a
// message with ![caption](attachment:<id>).

import { LIMITS } from "../contract";
import type { Attachments } from "./attachments";
import { sizeText } from "./attachments";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import { USER_TURN, type Toolset, type TurnMode } from "./toolsets";

const TEXT_BYTES = 64 * 1024;

const FILES_WHEN = `**Files:** files the user sends show as [file <id>]. \`open_file\` to look at one, \`put_file_on_computer\` to work on it.`;
export const FILES_INSTRUCTIONS = `${FILES_WHEN} To show a file in a text, put \`![a short caption](attachment:<id>)\` on its own line; \`share_file\` first for one on your computer. An https image, or a YouTube link, shows the same way.`;
export const FILES_FLOW_INSTRUCTIONS = FILES_WHEN;

export const FILE_TOOLS: ToolSpec[] = [
    {
        name: "open_file",
        description: "Look at one of the conversation's files: an image is shown to you, a text file is read out. Anything else, put on your computer.",
        inputSchema: { type: "object", properties: { id: { type: "string", description: "the file's id, from [file <id>]" } }, required: ["id"] },
    },
    {
        name: "put_file_on_computer",
        description: "Copy one of the conversation's files to your computer. Returns where it is.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "the file's id, from [file <id>]" },
                path: { type: "string", description: "where to put it, in your home folder. Default: ~/Downloads/<its name>" },
            },
            required: ["id"],
        },
    },
    {
        name: "share_file",
        description: `Add a file from your computer's home folder to the conversation, up to ${LIMITS.attachments.fileBytes / 1024 / 1024} MB, so a message can show it with ![caption](attachment:<id>). Returns its id.`,
        inputSchema: { type: "object", properties: { path: { type: "string", description: "the file, e.g. ~/Downloads/clip.mp4" } }, required: ["path"] },
    },
];

// the same tools, but a shared file goes with a reply rather than inside it
const FILE_FLOW_TOOLS: ToolSpec[] = FILE_TOOLS.map((t) =>
    t.name === "share_file" ? { ...t, description: `Add a file from your computer's home folder to the conversation, up to ${LIMITS.attachments.fileBytes / 1024 / 1024} MB, so a reply can send it in send_message's files. Returns its id.` } : t,
);

/** What the toolset needs: the conversation's files, and the computer to move them to and from. */
export interface FilesDeps {
    files: () => Attachments;
    getFile(path: string): Promise<{ path: string; data: Buffer }>;
    putFile(path: string, data: Buffer): Promise<string>;
}

export function filesToolset(deps: FilesDeps): Toolset {
    const run = async (name: string, args: Record<string, unknown>, mode: TurnMode): Promise<ToolResult> => {
        if (name === "open_file") {
            const a = deps.files().get(args.id);
            const about = `${a.name}, ${a.kind === "file" ? a.type : a.kind}, ${sizeText(a.bytes)}`;
            if (a.kind === "image" && a.bytes <= LIMITS.attachments.viewBytes) {
                return { text: about, image: deps.files().bytes(a.id).toString("base64"), imageType: a.type };
            }
            if (a.type === "text/plain" && a.bytes <= TEXT_BYTES) return { text: `${about}:\n\n${deps.files().bytes(a.id).toString("utf8")}` };
            return { text: `${about}: too big or not something you can see here. Use put_file_on_computer and open it there.` };
        }
        if (name === "put_file_on_computer") {
            const a = deps.files().get(args.id);
            const where = typeof args.path === "string" && args.path.trim() ? args.path : `~/Downloads/${a.name}`;
            return { text: `It's at ${await deps.putFile(where, deps.files().bytes(a.id))}` };
        }
        if (name === "share_file") {
            if (typeof args.path !== "string" || !args.path.trim()) return { isError: true, text: "give the file's path" };
            const got = await deps.getFile(args.path);
            const a = deps.files().add(got.path.split("/").pop() ?? "file", got.data);
            const use = mode.fromFlow ? `Pass ${a.id} in send_message's files to send it` : `Show it with ![a caption](attachment:${a.id})`;
            return { text: `Shared as [file ${a.id}] (${a.kind}, ${sizeText(a.bytes)}). ${use}` };
        }
        return { isError: true, text: `unknown tool ${name}` };
    };
    return {
        id: "files",
        tools: (mode) => (mode.fromFlow ? FILE_FLOW_TOOLS : FILE_TOOLS),
        instructions: (mode) => (mode.fromFlow ? FILES_FLOW_INSTRUCTIONS : FILES_INSTRUCTIONS),
        call: async (name, args, mode = USER_TURN) => {
            try {
                return await run(name, args, mode);
            } catch (e) {
                // a missing file, a full conversation, a computer that's off: the model reads why and can fix it
                return { isError: true, text: e instanceof Error ? e.message : String(e) };
            }
        },
    };
}
