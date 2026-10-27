// The files toolset: the agent's side of the conversation's files. It can
// look at what the user attached, put a file on its computer to work with
// it, and share a file from its computer, which it then shows inline in a
// message with ![caption](attachment:<id>).

import { LIMITS } from "../contract";
import type { Attachments } from "./attachments";
import { sizeText } from "./attachments";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import type { Toolset } from "./toolsets";

const TEXT_BYTES = 64 * 1024;

export const FILES_INSTRUCTIONS = `Files: a message can come with files the user attached, listed like "(attached: [file a1b2c3d4e5f6] cat.jpg, image, 1.2 MB)". \`open_file\` shows you an image or a text file; \`put_file_on_computer\` copies any file to your computer, to open it there or upload it to a site.
To show the user an image or a video inline, put \`![a short caption](attachment:<id>)\` on its own line in \`send_message\`: any file already in the conversation shows that way, the user's included. One on your computer, \`share_file\` first to get its id (download it there first if it's on the web). An image on the web can be shown straight from its https URL the same way, and a YouTube video shows as a playable thumbnail with \`![its title](https://www.youtube.com/watch?v=…)\`. Files up to ${LIMITS.attachments.fileBytes / 1024 / 1024} MB.`;

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
        description: "Add a file from your computer's home folder to the conversation, so a message can show it with ![caption](attachment:<id>). Returns its id.",
        inputSchema: { type: "object", properties: { path: { type: "string", description: "the file, e.g. ~/Downloads/clip.mp4" } }, required: ["path"] },
    },
];

/** What the toolset needs: the conversation's files, and the computer to move them to and from. */
export interface FilesDeps {
    files: () => Attachments;
    getFile(path: string): Promise<{ path: string; data: Buffer }>;
    putFile(path: string, data: Buffer): Promise<string>;
}

export function filesToolset(deps: FilesDeps): Toolset {
    const run = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
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
            return { text: `Shared as [file ${a.id}] (${a.kind}, ${sizeText(a.bytes)}). Show it with ![a caption](attachment:${a.id})` };
        }
        return { isError: true, text: `unknown tool ${name}` };
    };
    return {
        id: "files",
        tools: () => FILE_TOOLS,
        instructions: () => FILES_INSTRUCTIONS,
        call: async (name, args) => {
            try {
                return await run(name, args);
            } catch (e) {
                // a missing file, a full conversation, a computer that's off: the model reads why and can fix it
                return { isError: true, text: e instanceof Error ? e.message : String(e) };
            }
        },
    };
}
