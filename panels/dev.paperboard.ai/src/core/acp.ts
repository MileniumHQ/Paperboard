// The Agent Client Protocol as the panel reads it: what an agent sends is
// checked and turned into the chat's own records here, so a malformed or
// oversized message is cut or refused at one boundary. Pure: no SDK.
// Spec: agentclientprotocol.com (protocol version 1).

import type {
    AgentAuthMethod,
    AgentCommand,
    AgentDiff,
    AgentMode,
    AgentPermissionKind,
    AgentPermissionOption,
    AgentToolKind,
    Attachment,
    PlanEntry,
    PlanStatus,
    ToolCallRecord,
    ToolCallStatus,
} from "./types";

export const ACP_PROTOCOL_VERSION = 1;
/** a tool's text output kept in the chat; the agent keeps the rest */
export const MAX_TOOL_OUTPUT_CHARS = 16_000;
/** each side of a diff kept in the chat */
export const MAX_DIFF_CHARS = 100_000;
export const MAX_DIFFS_PER_CALL = 20;
export const MAX_LOCATIONS = 20;
export const MAX_PLAN_ENTRIES = 50;
export const MAX_PERMISSION_OPTIONS = 8;
export const MAX_COMMANDS = 100;
export const MAX_MODES = 20;
const MAX_TITLE_CHARS = 300;
const MAX_NAME_CHARS = 200;

export type AcpContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; resource: { uri: string; mimeType?: string; text: string } };

/** What an agent can take in a prompt (initialize's promptCapabilities). */
export interface PromptCapabilities {
    image: boolean;
    embeddedContext: boolean;
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, max: number): string | undefined {
    return typeof v === "string" ? v.slice(0, max) : undefined;
}

function cut(text: string, max: number): { text: string; truncated: boolean } {
    return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
}

const TOOL_KINDS: readonly AgentToolKind[] = ["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"];

export function toolKind(v: unknown): AgentToolKind {
    return TOOL_KINDS.includes(v as AgentToolKind) ? (v as AgentToolKind) : "other";
}

/** ACP tool statuses in the chat's terms; pending is shown as running. */
export function toolStatus(v: unknown): ToolCallStatus | undefined {
    switch (v) {
        case "pending":
        case "in_progress":
            return "running";
        case "completed":
            return "done";
        case "failed":
            return "error";
        default:
            return undefined;
    }
}

/** The readable text of a content block; non-text blocks are named, not dumped. */
export function contentText(block: unknown): string {
    if (!isObject(block)) return "";
    switch (block.type) {
        case "text":
            return typeof block.text === "string" ? block.text : "";
        case "resource_link":
            return typeof block.name === "string" ? `[${block.name}]` : "";
        case "resource": {
            const r = block.resource;
            return isObject(r) && typeof r.text === "string" ? r.text : "";
        }
        case "image":
            return "[image]";
        case "audio":
            return "[audio]";
        default:
            return "";
    }
}

/** A shell command from a tool's raw input, when it names one. */
function commandOf(rawInput: unknown): string | undefined {
    if (!isObject(rawInput)) return undefined;
    const c = rawInput.command ?? rawInput.cmd;
    if (typeof c === "string") return c.slice(0, MAX_TOOL_OUTPUT_CHARS);
    if (Array.isArray(c) && c.every((p) => typeof p === "string")) return c.join(" ").slice(0, MAX_TOOL_OUTPUT_CHARS);
    return undefined;
}

function diffsOf(content: unknown[]): AgentDiff[] {
    const diffs: AgentDiff[] = [];
    for (const item of content) {
        if (diffs.length >= MAX_DIFFS_PER_CALL) break;
        if (!isObject(item) || item.type !== "diff" || typeof item.path !== "string" || typeof item.newText !== "string") continue;
        const oldText = typeof item.oldText === "string" ? cut(item.oldText, MAX_DIFF_CHARS) : null;
        const newText = cut(item.newText, MAX_DIFF_CHARS);
        diffs.push({
            path: item.path.slice(0, 4096),
            oldText: oldText?.text ?? null,
            newText: newText.text,
            ...(oldText?.truncated || newText.truncated ? { truncated: true } : {}),
        });
    }
    return diffs;
}

function outputOf(content: unknown[]): string | undefined {
    const parts = content
        .filter((item): item is Json => isObject(item) && item.type === "content")
        .map((item) => contentText(item.content))
        .filter((t) => t !== "");
    if (parts.length === 0) return undefined;
    const joined = parts.join("\n");
    return joined.length > MAX_TOOL_OUTPUT_CHARS ? `${joined.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n… (cut to fit the chat)` : joined;
}

function locationsOf(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v
        .filter((l): l is Json => isObject(l) && typeof l.path === "string")
        .slice(0, MAX_LOCATIONS)
        .map((l) => (typeof l.line === "number" ? `${l.path}:${l.line}` : (l.path as string)).slice(0, 4096));
}

/** A tool call an agent announced (session/update tool_call). */
export function toolRecordFrom(update: Json): ToolCallRecord | undefined {
    const id = str(update.toolCallId, 200);
    if (!id) return undefined;
    const content = Array.isArray(update.content) ? update.content : [];
    const command = commandOf(update.rawInput);
    const output = outputOf(content);
    return {
        id,
        tool: "agent",
        panelId: "",
        action: "",
        label: str(update.title, MAX_TITLE_CHARS) || "Tool",
        arguments: {},
        status: toolStatus(update.status) ?? "running",
        agent: {
            kind: toolKind(update.kind),
            locations: locationsOf(update.locations),
            diffs: diffsOf(content),
            ...(command ? { command } : {}),
            ...(output ? { output } : {}),
        },
    };
}

/**
 * Applies a tool_call_update in place. ACP updates carry only the fields
 * that changed; content and locations replace the previous ones wholesale.
 */
export function applyToolUpdate(record: ToolCallRecord, update: Json): void {
    const agent = (record.agent ??= { kind: "other", locations: [], diffs: [] });
    const title = str(update.title, MAX_TITLE_CHARS);
    if (title) record.label = title;
    if (update.kind !== undefined && update.kind !== null) agent.kind = toolKind(update.kind);
    const status = toolStatus(update.status);
    // a decided permission (denied) is not overwritten by a later report
    if (status && record.status !== "denied") record.status = status;
    if (Array.isArray(update.locations)) agent.locations = locationsOf(update.locations);
    const command = commandOf(update.rawInput);
    if (command) agent.command = command;
    if (Array.isArray(update.content)) {
        agent.diffs = diffsOf(update.content);
        const output = outputOf(update.content);
        if (output) agent.output = output;
        else delete agent.output;
    }
}

const PLAN_STATUSES: readonly PlanStatus[] = ["pending", "in_progress", "completed"];

/** An agent's plan; each report replaces the whole plan. */
export function planFrom(update: Json): PlanEntry[] {
    if (!Array.isArray(update.entries)) return [];
    return update.entries
        .filter((e): e is Json => isObject(e) && typeof e.content === "string")
        .slice(0, MAX_PLAN_ENTRIES)
        .map((e) => ({
            content: (e.content as string).slice(0, MAX_TITLE_CHARS),
            status: PLAN_STATUSES.includes(e.status as PlanStatus) ? (e.status as PlanStatus) : "pending",
        }));
}

const PERMISSION_KINDS: readonly AgentPermissionKind[] = ["allow_once", "allow_always", "reject_once", "reject_always"];

/** The answers a permission request offers; a request without any valid one is refused. */
export function permissionOptions(raw: unknown): AgentPermissionOption[] {
    const options = (Array.isArray(raw) ? raw : [])
        .filter((o): o is Json => isObject(o) && typeof o.optionId === "string" && typeof o.name === "string")
        .filter((o) => PERMISSION_KINDS.includes(o.kind as AgentPermissionKind))
        .slice(0, MAX_PERMISSION_OPTIONS)
        .map((o) => ({ id: (o.optionId as string).slice(0, 200), name: (o.name as string).slice(0, MAX_NAME_CHARS), kind: o.kind as AgentPermissionKind }));
    if (options.length === 0) throw new Error("The agent asked for permission without any answers to choose from.");
    return options;
}

export function authMethodsFrom(raw: unknown): AgentAuthMethod[] {
    if (!Array.isArray(raw)) return [];
    return raw
        // a terminal method needs a terminal we do not offer (auth.terminal is false)
        .filter((m): m is Json => isObject(m) && typeof m.id === "string" && typeof m.name === "string" && (m.type === undefined || m.type === "agent"))
        .slice(0, 10)
        .map((m) => ({
            id: (m.id as string).slice(0, 200),
            name: (m.name as string).slice(0, MAX_NAME_CHARS),
            ...(typeof m.description === "string" ? { description: m.description.slice(0, 1000) } : {}),
        }));
}

export function modesFrom(raw: unknown): { modes: AgentMode[]; current?: string } {
    if (!isObject(raw) || !Array.isArray(raw.availableModes)) return { modes: [] };
    const modes = raw.availableModes
        .filter((m): m is Json => isObject(m) && typeof m.id === "string" && typeof m.name === "string")
        .slice(0, MAX_MODES)
        .map((m) => ({
            id: (m.id as string).slice(0, 200),
            name: (m.name as string).slice(0, MAX_NAME_CHARS),
            ...(typeof m.description === "string" ? { description: m.description.slice(0, 500) } : {}),
        }));
    const current = typeof raw.currentModeId === "string" ? raw.currentModeId : undefined;
    return { modes, ...(current ? { current } : {}) };
}

export function commandsFrom(raw: unknown): AgentCommand[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((c): c is Json => isObject(c) && typeof c.name === "string" && /^[\w:.-]{1,64}$/.test(c.name))
        .slice(0, MAX_COMMANDS)
        .map((c) => {
            const hint = isObject(c.input) && typeof c.input.hint === "string" ? c.input.hint.slice(0, MAX_NAME_CHARS) : undefined;
            return {
                name: c.name as string,
                description: typeof c.description === "string" ? c.description.slice(0, 500) : "",
                ...(hint ? { hint } : {}),
            };
        });
}

/**
 * A user's message as ACP prompt content. Text files go in as embedded
 * resources when the agent takes them, else as text; images only when the
 * agent says it can see them.
 */
export function promptBlocks(content: string, attachments: readonly Attachment[], caps: PromptCapabilities, agentName: string): AcpContentBlock[] {
    const blocks: AcpContentBlock[] = [];
    for (const a of attachments) {
        if (a.kind === "image") {
            if (!caps.image) throw new Error(`${agentName} can't read images. Remove the image to send.`);
            const match = /^data:([^;,]+);base64,(.*)$/s.exec(a.dataUrl ?? "");
            if (!match) throw new Error(`${a.name} could not be read.`);
            blocks.push({ type: "image", mimeType: match[1]!, data: match[2]! });
            continue;
        }
        const text = a.text ?? "";
        if (caps.embeddedContext) {
            blocks.push({ type: "resource", resource: { uri: `attachment:///${encodeURIComponent(a.name)}`, mimeType: a.mime || "text/plain", text } });
        } else {
            blocks.push({ type: "text", text: `Attached file ${a.name}:\n\n${text}` });
        }
    }
    if (content) blocks.push({ type: "text", text: content });
    return blocks;
}
