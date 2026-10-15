// Claude Code, bridged. The panel drives the installed `claude` through its
// own headless mode (--print with stream-json in and out, permission prompts
// answered over stdio) and turns what it prints into the ACP session updates
// every other agent sends, so a chat reads the same whichever agent replies.
// Nothing here runs a process: service/claudeCode.ts does.

import { commandsFrom, MAX_AGENT_MODELS, type AcpContentBlock } from "./acp";
import type { AgentCommand, AgentMode, AgentModel, AgentPermissionOption, AgentToolKind } from "./types";

export const CLAUDE_CODE_ID = "claude-code";

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
    return typeof v === "string" ? v : undefined;
}

/** The headless flags every Claude Code process runs with. */
export function claudeArgs(session: { id: string; resume: boolean } | null, mode?: string): string[] {
    return [
        "--print",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-prompt-tool",
        "stdio",
        ...(session ? [session.resume ? "--resume" : "--session-id", session.id] : []),
        ...(mode ? ["--permission-mode", mode] : []),
    ];
}

/** Claude Code's permission modes a chat can switch between. */
export const CLAUDE_MODES: readonly AgentMode[] = [
    { id: "default", name: "Ask", description: "Asks before editing files or running commands." },
    { id: "acceptEdits", name: "Accept edits", description: "Edits files without asking; still asks before running commands." },
    { id: "plan", name: "Plan", description: "Reads and plans without changing anything." },
];

export function isClaudeMode(v: unknown): v is string {
    return CLAUDE_MODES.some((m) => m.id === v);
}

/** What `initialize` tells the panel about this Claude Code. */
export interface ClaudeInit {
    commands: AgentCommand[];
    /** the models this Claude Code offers, as it names them ("opus" is "Opus 5.5") */
    models: AgentModel[];
    mode?: string;
    version?: string;
}

export function claudeInitFrom(response: unknown): ClaudeInit {
    if (!isObject(response)) return { commands: [], models: [] };
    const raw = Array.isArray(response.commands) ? response.commands : [];
    const commands = commandsFrom(
        raw.filter(isObject).map((c) => ({ name: c.name, description: c.description, ...(typeof c.argumentHint === "string" && c.argumentHint ? { input: { hint: c.argumentHint } } : {}) })),
    );
    const models = (Array.isArray(response.models) ? response.models : [])
        .filter(isObject)
        .filter((m) => typeof m.value === "string" && m.value.length > 0 && m.value.length <= 200)
        .slice(0, MAX_AGENT_MODELS)
        .map((m) => ({
            id: m.value as string,
            name: (str(m.displayName) || (m.value as string)).slice(0, 200),
            ...(str(m.description) ? { description: (m.description as string).slice(0, 500) } : {}),
        }));
    const mode = str(response.current_permission_mode);
    const version = str(response.claude_code_version)?.slice(0, 50);
    return { commands, models, ...(mode ? { mode } : {}), ...(version ? { version } : {}) };
}

/** A user message on Claude Code's stdin, from a prompt's ACP blocks. */
export function claudeUserMessage(sessionId: string, blocks: readonly AcpContentBlock[]): Json {
    const content = blocks.map((b) => {
        if (b.type === "image") return { type: "image", source: { type: "base64", media_type: b.mimeType, data: b.data } };
        if (b.type === "resource") return { type: "text", text: `<context ref="${b.resource.uri}">\n${b.resource.text}\n</context>` };
        return { type: "text", text: b.text };
    });
    return { type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: sessionId };
}

const KINDS: Record<string, AgentToolKind> = {
    Bash: "execute",
    Read: "read",
    Write: "edit",
    Edit: "edit",
    MultiEdit: "edit",
    NotebookEdit: "edit",
    Glob: "search",
    Grep: "search",
    WebFetch: "fetch",
    WebSearch: "fetch",
    ExitPlanMode: "switch_mode",
};

function toolTitle(name: string, input: Json): string {
    const path = str(input.file_path) ?? str(input.notebook_path);
    switch (name) {
        case "Bash":
            return str(input.description) ?? str(input.command) ?? "Run a command";
        case "Read":
            return path ? `Read ${path}` : "Read a file";
        case "Write":
            return path ? `Write ${path}` : "Write a file";
        case "Edit":
        case "MultiEdit":
        case "NotebookEdit":
            return path ? `Edit ${path}` : "Edit a file";
        case "Glob":
        case "Grep":
            return typeof input.pattern === "string" ? `Search for ${input.pattern}` : "Search";
        case "WebFetch":
            return str(input.url) ? `Fetch ${input.url}` : "Fetch a page";
        case "WebSearch":
            return str(input.query) ? `Search the web for ${input.query}` : "Search the web";
        case "ExitPlanMode":
            return "Ready to leave plan mode";
        default:
            return str(input.description) ?? name;
    }
}

/** Edits a tool makes, as ACP diff content. */
function toolDiffs(name: string, input: Json): Json[] {
    const path = str(input.file_path);
    if (!path) return [];
    if (name === "Write" && typeof input.content === "string") return [{ type: "diff", path, oldText: null, newText: input.content }];
    if (name === "Edit" && typeof input.new_string === "string") {
        return [{ type: "diff", path, oldText: str(input.old_string) ?? null, newText: input.new_string }];
    }
    if (name === "MultiEdit" && Array.isArray(input.edits)) {
        return input.edits
            .filter(isObject)
            .filter((e) => typeof e.new_string === "string")
            .map((e) => ({ type: "diff", path, oldText: str(e.old_string) ?? null, newText: e.new_string }));
    }
    return [];
}

/** A tool Claude Code calls, as an ACP tool_call update. */
export function claudeToolCall(id: string, name: string, input: Json): Json {
    const path = str(input.file_path) ?? str(input.notebook_path);
    const line = typeof input.offset === "number" ? input.offset : undefined;
    return {
        sessionUpdate: "tool_call",
        toolCallId: id,
        title: toolTitle(name, input),
        kind: KINDS[name] ?? "other",
        status: "pending",
        rawInput: input,
        content: toolDiffs(name, input),
        locations: path ? [{ path, ...(line !== undefined ? { line } : {}) }] : [],
    };
}

function resultText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .filter(isObject)
        .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : b.type === "image" ? "[image]" : ""))
        .filter(Boolean)
        .join("\n");
}

const PLAN_STATUSES = new Set(["pending", "in_progress", "completed"]);
/** tool calls (and streamed messages) one turn remembers, to finish them when their results arrive */
export const MAX_TRACKED_TOOLS = 500;

/**
 * One turn's translation. Text and thinking arrive as stream events (each
 * delta once); tool calls arrive in whole assistant messages and finish
 * with tool results. Subagents' own messages stay inside their tool call.
 */
export class ClaudeTranslator {
    /** tool call id → the diffs it announced, kept when its output replaces the content */
    private tools = new Map<string, { name: string; diffs: Json[] }>();
    /** assistant messages whose text came as stream events */
    private streamed = new Set<string>();

    /** The ACP updates one line of Claude Code's output adds. */
    updates(message: Json): Json[] {
        if (message.parent_tool_use_id !== null && message.parent_tool_use_id !== undefined) return [];
        if (message.type === "stream_event" && isObject(message.event)) return this.streamEvent(message.event);
        if (message.type === "assistant" && isObject(message.message)) return this.assistant(message.message);
        if (message.type === "user" && isObject(message.message)) return this.toolResults(message.message);
        return [];
    }

    private streamEvent(event: Json): Json[] {
        if (event.type === "message_start" && isObject(event.message) && typeof event.message.id === "string") {
            this.streamed.add(event.message.id);
            if (this.streamed.size > MAX_TRACKED_TOOLS) this.streamed.delete(this.streamed.values().next().value!);
            return [];
        }
        if (event.type !== "content_block_delta" || !isObject(event.delta)) return [];
        const delta = event.delta;
        if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
            return [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: delta.text } }];
        }
        if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking) {
            return [{ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: delta.thinking } }];
        }
        return [];
    }

    private assistant(message: Json): Json[] {
        const content = Array.isArray(message.content) ? message.content.filter(isObject) : [];
        // a message Claude Code made itself (an API error, say) was never streamed
        const streamed = typeof message.id === "string" && this.streamed.has(message.id);
        const out: Json[] = [];
        for (const block of content) {
            if (block.type === "text" && !streamed && typeof block.text === "string" && block.text) {
                out.push({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: block.text } });
            } else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
                const input = isObject(block.input) ? block.input : {};
                if (block.name === "TodoWrite") {
                    out.push(this.plan(input));
                    continue;
                }
                const call = claudeToolCall(block.id, block.name, input);
                this.tools.set(block.id, { name: block.name, diffs: call.content as Json[] });
                if (this.tools.size > MAX_TRACKED_TOOLS) this.tools.delete(this.tools.keys().next().value!);
                out.push(call);
            }
        }
        return out;
    }

    private plan(input: Json): Json {
        const todos = Array.isArray(input.todos) ? input.todos.filter(isObject) : [];
        return {
            sessionUpdate: "plan",
            entries: todos
                .filter((t) => typeof t.content === "string")
                .map((t) => ({ content: t.content, status: PLAN_STATUSES.has(t.status as string) ? t.status : "pending" })),
        };
    }

    private toolResults(message: Json): Json[] {
        const content = Array.isArray(message.content) ? message.content.filter(isObject) : [];
        const out: Json[] = [];
        for (const block of content) {
            if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
            const tool = this.tools.get(block.tool_use_id);
            if (!tool) continue;
            this.tools.delete(block.tool_use_id);
            const text = resultText(block.content);
            out.push({
                sessionUpdate: "tool_call_update",
                toolCallId: block.tool_use_id,
                status: block.is_error === true ? "failed" : "completed",
                content: [...tool.diffs, ...(text ? [{ type: "content", content: { type: "text", text } }] : [])],
            });
        }
        return out;
    }
}

/** The answers a Claude Code permission request offers. */
export function claudePermissionOptions(suggestions: unknown): AgentPermissionOption[] {
    return [
        { id: "allow", name: "Allow", kind: "allow_once" },
        ...(Array.isArray(suggestions) && suggestions.length > 0 ? [{ id: "always", name: "Always allow", kind: "allow_always" as const }] : []),
        { id: "reject", name: "Reject", kind: "reject_once" },
    ];
}

/** Claude Code's answer to a permission request, from the chosen option (null: the turn was stopped). */
export function claudePermissionAnswer(chosen: string | null, request: Json): Json {
    const input = isObject(request.input) ? request.input : {};
    if (chosen === "allow") return { behavior: "allow", updatedInput: input };
    if (chosen === "always") {
        const suggestions = Array.isArray(request.permission_suggestions) ? request.permission_suggestions.slice(0, 20) : [];
        return { behavior: "allow", updatedInput: input, updatedPermissions: suggestions };
    }
    if (chosen === null) return { behavior: "deny", message: "The chat was stopped.", interrupt: true };
    return { behavior: "deny", message: "The user declined this." };
}

export type ClaudeStop = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

/** A turn's result line, as an ACP stop reason; a failed turn throws its own words. */
export function claudeStopReason(result: Json, interrupted: boolean): ClaudeStop {
    if (interrupted) return "cancelled";
    if (result.subtype === "error_max_turns") return "max_turn_requests";
    if (result.subtype !== "success" || result.is_error === true) {
        const errors = Array.isArray(result.errors) ? result.errors.filter((e): e is string => typeof e === "string") : [];
        const text = str(result.result) || errors.join("\n") || "Claude Code could not finish the reply.";
        throw new Error(text.slice(0, 2000));
    }
    if (result.stop_reason === "max_tokens" || result.stop_reason === "refusal") return result.stop_reason;
    return "end_turn";
}
