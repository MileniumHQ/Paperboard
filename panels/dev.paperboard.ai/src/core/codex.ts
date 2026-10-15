// Codex, bridged. The panel drives the installed `codex` through its app
// server (`codex app-server`: JSON-RPC over stdio, what OpenAI's own editor
// extensions use) and turns its thread items into the ACP session updates
// every other agent sends, so a chat reads the same whichever agent replies.
// Nothing here runs a process: service/codex.ts does.

import { effortsFrom, withEfforts } from "./reasoning";
import { NO_SANDBOX_MODE, NO_SANDBOX_MODE_ID } from "./permissionMode";
import { MAX_AGENT_MODELS, type AcpContentBlock } from "./acp";
import type { AgentMode, AgentModel, AgentPermissionOption, AgentToolKind } from "./types";

export const CODEX_ID = "codex";

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
    return typeof v === "string" ? v : undefined;
}

/** What starts Codex's app server on stdio. */
export const CODEX_ARGS: readonly string[] = ["app-server"];

/**
 * Notifications the panel never reads, turned off at initialize so a busy
 * Codex does not send them at all.
 */
export const CODEX_QUIET_NOTIFICATIONS: readonly string[] = [
    "account/rateLimits/updated",
    "thread/tokenUsage/updated",
    "remoteControl/status/changed",
    "mcpServer/startupStatus/updated",
    "turn/diff/updated",
    "item/commandExecution/outputDelta",
    "rawResponseItem/completed",
    "rawResponse/completed",
];

/**
 * The panel's three ways of working, in Codex's terms. Codex has no
 * "accept edits" policy of its own: that mode runs Codex as in Ask and the
 * bridge answers its file-change prompts for files inside the chat's
 * project (service/codex.ts), so commands still ask.
 */
export const CODEX_MODES: readonly AgentMode[] = [
    { id: "default", name: "Ask", description: "Asks before editing files and before running commands it can't tell are safe." },
    { id: "acceptEdits", name: "Accept edits", description: "Edits files in the project without asking; still asks before running commands." },
    { id: "plan", name: "Plan", description: "Reads and plans without changing anything." },
    NO_SANDBOX_MODE,
];

export function isCodexMode(v: unknown): v is string {
    return CODEX_MODES.some((m) => m.id === v);
}

export interface CodexPolicy {
    approvalPolicy: "untrusted" | "never";
    /** for thread/start and thread/resume (Codex's config fills in the details) */
    sandbox: "workspace-write" | "read-only" | "danger-full-access";
    /** for turn/start, when the chat switched modes mid-thread */
    sandboxPolicy: Json;
}

export function codexPolicy(mode: string | undefined): CodexPolicy {
    if (mode === "plan") return { approvalPolicy: "never", sandbox: "read-only", sandboxPolicy: { type: "readOnly" } };
    // Codex's own --dangerously-bypass-approvals-and-sandbox: nothing asks, nothing is fenced
    if (mode === NO_SANDBOX_MODE_ID) return { approvalPolicy: "never", sandbox: "danger-full-access", sandboxPolicy: { type: "dangerFullAccess" } };
    return { approvalPolicy: "untrusted", sandbox: "workspace-write", sandboxPolicy: { type: "workspaceWrite" } };
}

/** Codex's version, from initialize's user agent ("paperboard/0.162.1 (...)"). */
export function codexVersion(response: unknown): string | undefined {
    const agent = isObject(response) ? str(response.userAgent) : undefined;
    return agent ? /^[^/\s]+\/(\d[\w.+-]*)/.exec(agent)?.[1]?.slice(0, 50) : undefined;
}

/** One page of model/list, as the panel's models. */
export function codexModelsFrom(response: unknown): { models: AgentModel[]; next?: string } {
    if (!isObject(response)) return { models: [] };
    const models = (Array.isArray(response.data) ? response.data : [])
        .filter(isObject)
        .filter((m) => m.hidden !== true && typeof m.id === "string" && m.id.length > 0 && m.id.length <= 200)
        .slice(0, MAX_AGENT_MODELS)
        .map((m) => ({
            id: m.id as string,
            name: (str(m.displayName) || (m.id as string)).slice(0, 200),
            ...(str(m.description) ? { description: (m.description as string).slice(0, 500) } : {}),
            ...withEfforts(
                effortsFrom((Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts : []).map((e) => (isObject(e) ? e.reasoningEffort : undefined))),
                m.defaultReasoningEffort,
            ),
        }));
    const next = str(response.nextCursor);
    return { models, ...(next ? { next } : {}) };
}

/** Whether account/read says nobody is signed in. */
export function codexSignedOut(response: unknown): boolean {
    return isObject(response) && response.requiresOpenaiAuth === true && (response.account === null || response.account === undefined);
}

/** A prompt's ACP blocks as Codex's turn input. */
export function codexInput(blocks: readonly AcpContentBlock[]): Json[] {
    return blocks.map((b) => {
        if (b.type === "image") return { type: "image", url: `data:${b.mimeType};base64,${b.data}` };
        if (b.type === "resource") return { type: "text", text: `<context ref="${b.resource.uri}">\n${b.resource.text}\n</context>`, text_elements: [] };
        return { type: "text", text: b.text, text_elements: [] };
    });
}

/**
 * A unified diff's hunks as before/after texts, one per hunk. Codex sends
 * an edit's changes this way; a new file comes as its whole text.
 */
export function hunksOf(diff: string): { oldText: string; newText: string }[] {
    const hunks: { old: string[]; new: string[] }[] = [];
    let hunk: { old: string[]; new: string[] } | null = null;
    const lines = diff.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    for (const line of lines) {
        if (line.startsWith("@@")) {
            hunk = { old: [], new: [] };
            hunks.push(hunk);
        } else if (!hunk || line.startsWith("\\")) {
            continue;
        } else if (line.startsWith("-")) {
            hunk.old.push(line.slice(1));
        } else if (line.startsWith("+")) {
            hunk.new.push(line.slice(1));
        } else {
            hunk.old.push(line.slice(1));
            hunk.new.push(line.slice(1));
        }
    }
    return hunks.map((h) => ({ oldText: h.old.join("\n"), newText: h.new.join("\n") }));
}

/** a file change's paths and diffs; MAX_DIFFS bounds what one item sends */
const MAX_DIFFS = 50;
/** a tool's output sent to the chat; the chat cuts it shorter itself */
const MAX_OUTPUT_CHARS = 64 * 1024;

interface FileChange {
    path: string;
    kind: "add" | "delete" | "update";
    diff: string;
}

function changesOf(item: Json): FileChange[] {
    return (Array.isArray(item.changes) ? item.changes : [])
        .filter(isObject)
        .filter((c) => typeof c.path === "string" && c.path)
        .slice(0, MAX_DIFFS)
        .map((c) => {
            const kind = isObject(c.kind) && (c.kind.type === "add" || c.kind.type === "delete") ? c.kind.type : "update";
            const moved = isObject(c.kind) ? str(c.kind.move_path) : undefined;
            return { path: moved || (c.path as string), kind, diff: str(c.diff) ?? "" };
        });
}

/** The paths a file change touches. */
export function changedPaths(item: Json): string[] {
    const paths = new Set<string>();
    for (const c of (Array.isArray(item.changes) ? item.changes : []).filter(isObject)) {
        if (typeof c.path === "string") paths.add(c.path);
        if (isObject(c.kind) && typeof c.kind.move_path === "string") paths.add(c.kind.move_path);
    }
    return [...paths];
}

function diffsOf(changes: FileChange[]): Json[] {
    const out: Json[] = [];
    for (const c of changes) {
        if (c.kind === "add") out.push({ type: "diff", path: c.path, oldText: null, newText: c.diff });
        else if (c.kind === "update") for (const h of hunksOf(c.diff)) out.push({ type: "diff", path: c.path, ...h });
        if (out.length >= MAX_DIFFS) break;
    }
    return out.slice(0, MAX_DIFFS);
}

function fileChangeTitle(changes: FileChange[]): string {
    if (changes.length === 1) {
        const c = changes[0]!;
        return `${c.kind === "add" ? "Create" : c.kind === "delete" ? "Delete" : "Edit"} ${c.path}`;
    }
    return changes.length ? `Edit ${changes.length} files` : "Edit files";
}

/** What a shell command is for, when Codex worked it out. */
function commandView(item: Json): { title: string; kind: AgentToolKind; path?: string } {
    const command = str(item.command) ?? "";
    const actions = (Array.isArray(item.commandActions) ? item.commandActions : []).filter(isObject);
    if (actions.length === 1) {
        const a = actions[0]!;
        if (a.type === "read" && typeof a.path === "string") return { title: `Read ${a.path}`, kind: "read", path: a.path };
        if (a.type === "listFiles") return { title: typeof a.path === "string" ? `List ${a.path}` : "List files", kind: "search" };
        if (a.type === "search") return { title: typeof a.query === "string" ? `Search for ${a.query}` : "Search", kind: "search" };
        if (typeof a.command === "string" && a.command) return { title: a.command, kind: "execute" };
    }
    return { title: command || "Run a command", kind: "execute" };
}

function text(t: string): Json {
    return { type: "content", content: { type: "text", text: t.length > MAX_OUTPUT_CHARS ? `${t.slice(0, MAX_OUTPUT_CHARS)}\n…` : t } };
}

/** A thread item that does something, as an ACP tool_call (null: not a tool). */
export function codexToolCall(item: Json): Json | null {
    const id = str(item.id);
    if (!id) return null;
    const base = { sessionUpdate: "tool_call", toolCallId: id, status: "in_progress" };
    switch (item.type) {
        case "commandExecution": {
            const view = commandView(item);
            return { ...base, title: view.title, kind: view.kind, rawInput: { command: str(item.command) ?? "" }, content: [], locations: view.path ? [{ path: view.path }] : [] };
        }
        case "fileChange": {
            const changes = changesOf(item);
            const kind: AgentToolKind = changes.length > 0 && changes.every((c) => c.kind === "delete") ? "delete" : "edit";
            return { ...base, title: fileChangeTitle(changes), kind, content: diffsOf(changes), locations: changes.map((c) => ({ path: c.path })) };
        }
        case "mcpToolCall":
            return { ...base, title: `${str(item.server) ?? "tool"}: ${str(item.tool) ?? "call"}`, kind: "other", rawInput: isObject(item.arguments) ? item.arguments : {}, content: [], locations: [] };
        case "dynamicToolCall":
            return { ...base, title: str(item.tool) ?? "Tool", kind: "other", rawInput: isObject(item.arguments) ? item.arguments : {}, content: [], locations: [] };
        case "webSearch":
            return { ...base, title: str(item.query) ? `Search the web for ${item.query}` : "Search the web", kind: "fetch", content: [], locations: [] };
        case "imageView":
            return { ...base, title: str(item.path) ? `View ${item.path}` : "View an image", kind: "read", content: [], locations: str(item.path) ? [{ path: item.path }] : [] };
        default:
            return null;
    }
}

const DONE: Record<string, "completed" | "failed"> = { completed: "completed", failed: "failed", declined: "failed" };

function mcpResultText(item: Json): string {
    if (isObject(item.error) && typeof item.error.message === "string") return item.error.message;
    const content = isObject(item.result) && Array.isArray(item.result.content) ? item.result.content : [];
    return content
        .filter(isObject)
        .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : b.type === "image" ? "[image]" : ""))
        .filter(Boolean)
        .join("\n");
}

/** A finished thread item, as the tool_call_update that closes its tool call. */
export function codexToolDone(item: Json): Json | null {
    const id = str(item.id);
    if (!id) return null;
    const status = (s: unknown, ok: boolean) => DONE[s as string] ?? (ok ? "completed" : "failed");
    switch (item.type) {
        case "commandExecution": {
            const output = str(item.aggregatedOutput);
            return {
                sessionUpdate: "tool_call_update",
                toolCallId: id,
                status: status(item.status, item.exitCode === 0 || item.exitCode === undefined || item.exitCode === null),
                content: output ? [text(output)] : item.status === "declined" ? [text("Declined.")] : [],
            };
        }
        case "fileChange":
            return { sessionUpdate: "tool_call_update", toolCallId: id, status: status(item.status, true), content: diffsOf(changesOf(item)) };
        case "mcpToolCall": {
            const output = mcpResultText(item);
            return { sessionUpdate: "tool_call_update", toolCallId: id, status: status(item.status, !item.error), content: output ? [text(output)] : [] };
        }
        case "dynamicToolCall":
            return { sessionUpdate: "tool_call_update", toolCallId: id, status: item.success === false ? "failed" : "completed", content: [] };
        case "webSearch":
        case "imageView":
            return { sessionUpdate: "tool_call_update", toolCallId: id, status: "completed" };
        default:
            return null;
    }
}

const PLAN_STATUS: Record<string, string> = { pending: "pending", inProgress: "in_progress", completed: "completed" };
/** items one turn remembers (to finish streamed messages and tool calls once) */
export const MAX_TRACKED_ITEMS = 500;

/**
 * One turn's translation. Message and reasoning text stream as deltas;
 * a message Codex never streamed is shown whole when it completes. Tool
 * calls start and finish as items.
 */
export class CodexTranslator {
    /** message item ids whose text arrived as deltas */
    private streamed = new Set<string>();
    /** tool item ids announced, so each finishes once */
    private tools = new Set<string>();
    private wroteText = false;
    private currentMessage: string | null = null;

    private remember(set: Set<string>, id: string): void {
        set.add(id);
        if (set.size > MAX_TRACKED_ITEMS) set.delete(set.values().next().value!);
    }

    /** a later message reads as its own paragraph */
    private messageText(itemId: string, t: string): Json {
        const lead = this.currentMessage !== itemId && this.wroteText ? "\n\n" : "";
        this.currentMessage = itemId;
        this.wroteText = true;
        return { sessionUpdate: "agent_message_chunk", content: { type: "text", text: lead + t } };
    }

    /** The ACP updates one notification adds. */
    updates(method: string, params: Json): Json[] {
        switch (method) {
            case "item/agentMessage/delta": {
                const itemId = str(params.itemId);
                const delta = str(params.delta);
                if (!itemId || !delta) return [];
                this.remember(this.streamed, itemId);
                return [this.messageText(itemId, delta)];
            }
            case "item/reasoning/summaryTextDelta":
            case "item/reasoning/textDelta": {
                const itemId = str(params.itemId);
                const delta = str(params.delta);
                if (!delta) return [];
                if (itemId) this.remember(this.streamed, itemId);
                return [{ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: delta } }];
            }
            case "item/started": {
                if (!isObject(params.item)) return [];
                const call = codexToolCall(params.item);
                if (!call) return [];
                this.remember(this.tools, call.toolCallId as string);
                return [call];
            }
            case "item/fileChange/patchUpdated": {
                const itemId = str(params.itemId);
                if (!itemId || !this.tools.has(itemId)) return [];
                const changes = changesOf({ changes: params.changes });
                return [{ sessionUpdate: "tool_call_update", toolCallId: itemId, title: fileChangeTitle(changes), content: diffsOf(changes), locations: changes.map((c) => ({ path: c.path })) }];
            }
            case "item/completed":
                return isObject(params.item) ? this.completed(params.item) : [];
            case "turn/plan/updated": {
                const steps = (Array.isArray(params.plan) ? params.plan : []).filter(isObject).filter((s) => typeof s.step === "string");
                return [{ sessionUpdate: "plan", entries: steps.map((s) => ({ content: s.step, status: PLAN_STATUS[s.status as string] ?? "pending" })) }];
            }
            default:
                return [];
        }
    }

    private completed(item: Json): Json[] {
        const id = str(item.id);
        if (!id) return [];
        if (item.type === "agentMessage") {
            const t = str(item.text);
            if (this.streamed.has(id) || !t) return [];
            return [this.messageText(id, t)];
        }
        if (item.type === "reasoning" && !this.streamed.has(id)) {
            // reasoning that never streamed, shown whole
            const parts = [...(Array.isArray(item.summary) ? item.summary : []), ...(Array.isArray(item.content) ? item.content : [])].filter((p): p is string => typeof p === "string" && p !== "");
            return parts.length ? [{ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: parts.join("\n\n") } }] : [];
        }
        const out: Json[] = [];
        // a tool that finished without being announced (it started before the turn was heard) is announced first
        if (!this.tools.has(id)) {
            const call = codexToolCall(item);
            if (!call) return [];
            out.push(call);
        }
        this.tools.delete(id);
        const done = codexToolDone(item);
        return done ? [...out, done] : out;
    }
}

/** A Codex approval decision, as it appears in availableDecisions. */
type Decision = string | Json;

const DECISION_OPTIONS: Record<string, AgentPermissionOption> = {
    accept: { id: "accept", name: "Allow", kind: "allow_once" },
    acceptForSession: { id: "acceptForSession", name: "Allow for this chat", kind: "allow_always" },
    acceptWithExecpolicyAmendment: { id: "acceptWithExecpolicyAmendment", name: "Always allow this command", kind: "allow_always" },
    decline: { id: "decline", name: "Reject", kind: "reject_once" },
    cancel: { id: "cancel", name: "Reject", kind: "reject_once" },
};

function decisionKey(d: Decision): string | undefined {
    if (typeof d === "string") return d;
    return isObject(d) ? Object.keys(d)[0] : undefined;
}

/**
 * The answers an approval request offers: the ones Codex lists for it when
 * it does, else allow, allow for this chat, or reject.
 */
export function codexPermissionOptions(params: Json): AgentPermissionOption[] {
    const listed = Array.isArray(params.availableDecisions) ? (params.availableDecisions as Decision[]) : ["accept", "acceptForSession", "decline"];
    const keys = [...new Set(listed.map(decisionKey))].filter((k): k is string => k !== undefined && k in DECISION_OPTIONS);
    // one way to say no: "decline" lets Codex carry on; "cancel", when it is the only one, ends the turn
    return keys.filter((k) => !(k === "cancel" && keys.includes("decline"))).map((k) => DECISION_OPTIONS[k]!);
}

/** Codex's answer to an approval request, from the chosen option (null: the turn was stopped). */
export function codexDecision(chosen: string | null, params: Json): Json {
    if (chosen === null) return { decision: "cancel" };
    const listed = Array.isArray(params.availableDecisions) ? (params.availableDecisions as Decision[]) : [];
    // the amendment Codex proposed goes back as it was offered
    const offered = listed.find((d) => isObject(d) && decisionKey(d) === chosen);
    if (offered) return { decision: offered };
    if (chosen in DECISION_OPTIONS) return { decision: chosen };
    return { decision: listed.length && !listed.includes("decline") ? "cancel" : "decline" };
}

/** A tool call to show with an approval request, for an item the turn never announced. */
export function codexApprovalToolCall(method: string, params: Json): Json {
    const id = str(params.itemId) ?? `approval-${String(params.approvalId ?? "")}`;
    if (method === "item/commandExecution/requestApproval") {
        return codexToolCall({ type: "commandExecution", id, command: params.command, commandActions: params.commandActions }) ?? { sessionUpdate: "tool_call", toolCallId: id, title: "Run a command", kind: "execute" };
    }
    return { sessionUpdate: "tool_call", toolCallId: id, title: str(params.reason) ?? "Edit files", kind: "edit", status: "in_progress", content: [], locations: [] };
}

export type CodexStop = "end_turn" | "cancelled";

/** Whether a turn error means Codex is not signed in. */
export function codexAuthFailure(error: unknown): boolean {
    if (!isObject(error)) return false;
    const info = error.codexErrorInfo;
    if (info === "unauthorized") return true;
    if (!isObject(info)) return false;
    return Object.values(info).some((v) => isObject(v) && v.httpStatusCode === 401);
}

/** A completed turn's stop reason; a failed turn throws Codex's own words. */
export function codexStopReason(turn: unknown, lastError: string | undefined): CodexStop {
    const t = isObject(turn) ? turn : {};
    if (t.status === "interrupted") return "cancelled";
    if (t.status === "failed") {
        const message = (isObject(t.error) ? str(t.error.message) : undefined) || lastError || "Codex could not finish the reply.";
        throw new Error(message.slice(0, 2000));
    }
    return "end_turn";
}
