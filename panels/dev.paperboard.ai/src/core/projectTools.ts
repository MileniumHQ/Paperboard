// Local AI in a project: the file tools a model is offered when its chat
// works in a project folder, the modes that decide which of them ask first,
// and the checks on what a model sends. Where a path may lead is the
// service's decision (service/projectFiles.ts); this module only shapes it.

import { NO_SANDBOX_MODE } from "./permissionMode";
import type { OllamaTool } from "./tools";
import type { AgentMode, ProjectToolName } from "./types";

export type ProjectTool = ProjectToolName;

export const PROJECT_TOOLS: readonly ProjectTool[] = ["read_file", "list_directory", "search_files", "write_file", "edit_file"];

export const PROJECT_TOOL_LABELS: Record<ProjectTool, string> = {
    read_file: "Read file",
    list_directory: "Listed folder",
    search_files: "Searched files",
    write_file: "Wrote file",
    edit_file: "Edited file",
};

/** a path a model may name, before the service resolves it */
export const MAX_PATH_CHARS = 1024;
/** text one write_file call may write */
export const MAX_WRITE_CHARS = 256 * 1024;
/** text one edit_file call may name, on each side */
export const MAX_EDIT_TEXT_CHARS = 64 * 1024;
export const MAX_PATTERN_CHARS = 256;

// ─── modes ───────────────────────────────────────────────────────────────────

/** Local AI chats keep their mode in Conversation.mode, as agent chats do. */
export const LOCAL_MODE_ASK = "ask";
export const LOCAL_MODE_ACCEPT_EDITS = "accept-edits";

export const LOCAL_MODES: readonly AgentMode[] = [
    { id: LOCAL_MODE_ASK, name: "Ask", description: "Approve every file change, command and action" },
    { id: LOCAL_MODE_ACCEPT_EDITS, name: "Accept edits", description: "File changes apply without asking; commands and actions still ask" },
    NO_SANDBOX_MODE,
];

export function isLocalMode(value: unknown): value is string {
    return typeof value === "string" && LOCAL_MODES.some((m) => m.id === value);
}

/** A chat's saved mode as Local AI reads it; anything else (an agent's mode id) is Ask. */
export function localMode(value: string | undefined): string {
    return isLocalMode(value) ? value : LOCAL_MODE_ASK;
}

export function isProjectTool(name: string): name is ProjectTool {
    return (PROJECT_TOOLS as readonly string[]).includes(name);
}

/** Whether a project tool waits for the user in a mode. Reads never change anything, so never ask. */
export function projectToolAsks(tool: ProjectTool, mode: string | undefined): boolean {
    if (tool === "write_file" || tool === "edit_file") return localMode(mode) === LOCAL_MODE_ASK;
    return false;
}

// ─── definitions ─────────────────────────────────────────────────────────────

const path = (description: string) => ({ type: "string" as const, description });

export const PROJECT_TOOL_DEFINITIONS: Record<ProjectTool, OllamaTool> = {
    read_file: {
        type: "function",
        function: {
            name: "read_file",
            description: "Read a text file in the project. Long files come back in parts; ask again with start_line to read on.",
            parameters: {
                type: "object",
                properties: {
                    path: path("File path relative to the project folder"),
                    start_line: { type: "number", description: "First line to read (1 = the start)" },
                },
                required: ["path"],
            },
        },
    },
    list_directory: {
        type: "function",
        function: {
            name: "list_directory",
            description: "List the files and folders in a project folder. Folders end with /.",
            parameters: {
                type: "object",
                properties: { path: path('Folder path relative to the project folder; "." is the project itself') },
                required: [],
            },
        },
    },
    search_files: {
        type: "function",
        function: {
            name: "search_files",
            description:
                "Find files in the project by name pattern, text inside them, or both. Skips .git and node_modules. Returns matching paths, and the matching lines when text is given.",
            parameters: {
                type: "object",
                properties: {
                    pattern: { type: "string", description: 'File name pattern, e.g. "*.ts" or "src/**/*.css"' },
                    text: { type: "string", description: "Text to find inside files (plain text, not case-sensitive)" },
                    path: path("Folder to search, relative to the project folder (default: the whole project)"),
                },
                required: [],
            },
        },
    },
    write_file: {
        type: "function",
        function: {
            name: "write_file",
            description: "Create a file in the project, or replace all of an existing file's text. Prefer edit_file to change part of a file.",
            parameters: {
                type: "object",
                properties: {
                    path: path("File path relative to the project folder"),
                    content: { type: "string", description: "The file's complete new text" },
                },
                required: ["path", "content"],
            },
        },
    },
    edit_file: {
        type: "function",
        function: {
            name: "edit_file",
            description:
                "Change part of a file: old_text is replaced by new_text. old_text must match the file exactly, including spaces, and appear once (or set replace_all).",
            parameters: {
                type: "object",
                properties: {
                    path: path("File path relative to the project folder"),
                    old_text: { type: "string", description: "The exact text to replace" },
                    new_text: { type: "string", description: "The text to put in its place" },
                    replace_all: { type: "boolean", description: "Replace every occurrence instead of exactly one" },
                },
                required: ["path", "old_text", "new_text"],
            },
        },
    },
};

// ─── arguments ───────────────────────────────────────────────────────────────

export class ProjectArgumentError extends Error {}

function objectOf(raw: unknown): Record<string, unknown> {
    let args = raw;
    if (typeof args === "string") {
        try {
            args = args.trim() ? JSON.parse(args) : {};
        } catch {
            throw new ProjectArgumentError("arguments must be a JSON object");
        }
    }
    if (args === null || args === undefined) return {};
    if (typeof args !== "object" || Array.isArray(args)) throw new ProjectArgumentError("arguments must be a JSON object");
    return args as Record<string, unknown>;
}

function pathArg(value: unknown, key: string, fallback?: string): string {
    if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
    if (typeof value !== "string" || !value.trim()) throw new ProjectArgumentError(`missing required argument "${key}"`);
    if (value.length > MAX_PATH_CHARS) throw new ProjectArgumentError(`"${key}" is limited to ${MAX_PATH_CHARS} characters`);
    if (value.includes("\0")) throw new ProjectArgumentError(`"${key}" can't contain a NUL character`);
    return value.trim();
}

function textArg(value: unknown, key: string, max: number, allowEmpty: boolean): string {
    if (typeof value !== "string") throw new ProjectArgumentError(`missing required argument "${key}"`);
    if (!allowEmpty && value === "") throw new ProjectArgumentError(`"${key}" can't be empty`);
    if (value.length > max) throw new ProjectArgumentError(`"${key}" is limited to ${max} characters`);
    return value;
}

/** A model's arguments for a project tool, checked and reduced to what the tool reads. */
export function projectToolArguments(tool: ProjectTool, raw: unknown): Record<string, unknown> {
    const given = objectOf(raw);
    switch (tool) {
        case "read_file": {
            const out: Record<string, unknown> = { path: pathArg(given.path, "path") };
            const start = given.start_line;
            if (start !== undefined && start !== null && start !== "") {
                const n = typeof start === "string" ? Number(start) : start;
                if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw new ProjectArgumentError('"start_line" must be a whole number from 1');
                out.start_line = n;
            }
            return out;
        }
        case "list_directory":
            return { path: pathArg(given.path, "path", ".") };
        case "search_files": {
            const out: Record<string, unknown> = { path: pathArg(given.path, "path", ".") };
            if (typeof given.pattern === "string" && given.pattern.trim()) {
                if (given.pattern.length > MAX_PATTERN_CHARS) throw new ProjectArgumentError(`"pattern" is limited to ${MAX_PATTERN_CHARS} characters`);
                out.pattern = given.pattern.trim();
            }
            if (typeof given.text === "string" && given.text !== "") {
                if (given.text.length > MAX_PATTERN_CHARS) throw new ProjectArgumentError(`"text" is limited to ${MAX_PATTERN_CHARS} characters`);
                out.text = given.text;
            }
            if (out.pattern === undefined && out.text === undefined) throw new ProjectArgumentError('give a "pattern", a "text", or both');
            return out;
        }
        case "write_file":
            return { path: pathArg(given.path, "path"), content: textArg(given.content, "content", MAX_WRITE_CHARS, true) };
        case "edit_file": {
            const replaceAll = given.replace_all === true || given.replace_all === "true";
            return {
                path: pathArg(given.path, "path"),
                old_text: textArg(given.old_text, "old_text", MAX_EDIT_TEXT_CHARS, false),
                new_text: textArg(given.new_text, "new_text", MAX_EDIT_TEXT_CHARS, true),
                ...(replaceAll ? { replace_all: true } : {}),
            };
        }
    }
}

// ─── matching ────────────────────────────────────────────────────────────────

/**
 * A file name pattern as a matcher over project-relative paths written with
 * "/". `*` and `?` stay within one folder, `**` crosses folders. A pattern
 * without a "/" matches the file's name at any depth, as "*.ts" means in
 * most tools.
 */
export function globMatcher(pattern: string): (relPath: string) => boolean {
    const clean = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
    let source = "";
    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i]!;
        if (ch === "*") {
            if (clean[i + 1] === "*") {
                const slash = clean[i + 2] === "/";
                source += slash ? "(?:.*/)?" : ".*";
                i += slash ? 2 : 1;
            } else {
                source += "[^/]*";
            }
        } else if (ch === "?") {
            source += "[^/]";
        } else {
            source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        }
    }
    const re = new RegExp(`^${source}$`);
    if (clean.includes("/")) return (rel) => re.test(rel);
    return (rel) => re.test(rel.slice(rel.lastIndexOf("/") + 1));
}

/**
 * Replaces `oldText` with `newText`, exactly: no patterns, no `$` escapes.
 * Exactly one occurrence unless `replaceAll`; none, or more than one
 * without it, is refused with the count so the model can correct itself.
 */
export function replaceExact(text: string, oldText: string, newText: string, replaceAll: boolean): { text: string; count: number } {
    if (!oldText) throw new ProjectArgumentError('"old_text" can\'t be empty');
    const parts = text.split(oldText);
    const count = parts.length - 1;
    if (count === 0) throw new ProjectArgumentError("old_text was not found in the file. Read the file and copy the text exactly");
    if (count > 1 && !replaceAll) {
        throw new ProjectArgumentError(`old_text appears ${count} times. Include more of the surrounding text so it matches once, or set replace_all`);
    }
    return { text: parts.join(newText), count };
}

/** The composer's mode choice for a Local AI chat in a project. */
export function localModePicker(saved: string | undefined, project: boolean): { modes: AgentMode[]; current: AgentMode | undefined } {
    // Accept edits only means something where there are files to edit
    const modes = LOCAL_MODES.filter((m) => project || m.id !== LOCAL_MODE_ACCEPT_EDITS);
    const id = localMode(saved);
    return { modes, current: modes.find((m) => m.id === id) ?? modes[0] };
}
