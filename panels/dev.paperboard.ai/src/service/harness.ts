// The agent's brain: an agent harness the user already has, run for one turn
// at a time with every built-in tool off except web search. Its hands are the
// computer's MCP endpoint, served by this service.
//
// Codex: `codex exec --json`, resumed by thread id. Code-mode models call
// tools from a restricted JS sandbox with no file or network access; the
// workspace is an empty folder and the sandbox read-only.
// Claude Code: `claude -p --output-format stream-json`, resumed by session id,
// with --tools limited to WebSearch and Agent (its subagent tool: subagents draw
// their tools from that same set, so they get web search and the computer too).

import { randomUUID } from "node:crypto";
import type { Harness } from "../contract";
import { MCP_TOKEN_ENV } from "./computerMcp";

export const HARNESS_COMMANDS: Record<Harness, string> = { codex: "codex", "claude-code": "claude" };

/** MCP server name the harness knows the service's endpoint by; its tools are mcp__paperboard__<tool> */
export const MCP_SERVER = "paperboard";

export function instructions(name: string, sections: string[] = []): string {
    return [
        `You are ${name}, the user's personal agent. You're texting with them: one long, ongoing conversation, so keep replies short, warm and plain, like a friend who's good with computers.

You have your own computer, a Debian VM. Your tools act on it, never on the user's machine, so you can't see their files. Use them to actually do things instead of explaining how.

Work quietly: the user doesn't see your tool calls, and you don't announce steps. Do the work, then text what came of it.`,
        ...sections,
    ].join("\n\n");
}

// Codex features that would hand the model tools other than search and the computer
const CODEX_FEATURES_OFF = [
    "shell_tool", "unified_exec", "apps", "plugins", "browser_use", "browser_use_external", "computer_use",
    "image_generation", "multi_agent", "multi_agent_v2", "in_app_browser", "goals", "tool_suggest", "skill_search",
    "hooks", "sleep_tool", "view_image",
];

// Claude Code only. Codex keeps multi_agent off (CODEX_FEATURES_OFF): nothing here
// proves its subagents inherit the read-only sandbox, the disabled shell and the
// single MCP server, and a subagent that escaped them would hand the model a shell.
const CLAUDE_SUBAGENT_TOOL = "Agent";
const SUBAGENT_NOTE = `You can hand a self-contained piece of work to a subagent (the ${CLAUDE_SUBAGENT_TOOL} tool) and choose a different model for it when that helps, such as a faster, smaller one for simple lookups. Subagents have the same tools you do, web search and your computer, and can't ask the user anything, so give them everything they need and check what they bring back.`;

export interface TurnSpec {
    harness: Harness;
    /** absolute path of the harness's executable */
    command: string;
    model: string | null;
    name: string;
    /** the conversation to continue; null starts it */
    thread: string | null;
    message: string;
    mcpUrl: string;
    /** each toolset's part of the instructions, in order */
    sections: string[];
}

export interface TurnLaunch {
    command: string;
    args: string[];
    /** the MCP token's variable name only; its value is added by the caller */
    tokenEnv: string;
    /** known before the turn starts (Claude); Codex reports its own */
    thread: string | null;
}

export function turnLaunch(spec: TurnSpec): TurnLaunch {
    if (spec.harness === "codex") {
        const toml = (v: unknown) => JSON.stringify(v);
        const config = [
            `approval_policy="never"`,
            `sandbox_mode="read-only"`,
            `web_search="live"`,
            `developer_instructions=${toml(instructions(spec.name, spec.sections))}`,
            `mcp_servers.${MCP_SERVER}.url=${toml(spec.mcpUrl)}`,
            `mcp_servers.${MCP_SERVER}.bearer_token_env_var=${toml(MCP_TOKEN_ENV)}`,
            `mcp_servers.${MCP_SERVER}.tool_timeout_sec=660`,
            // the service's tools run unprompted; anything else stays denied by approval_policy=never
            `mcp_servers.${MCP_SERVER}.default_tools_approval_mode="approve"`,
        ].flatMap((c) => ["-c", c]);
        const common = [
            "--json", "--skip-git-repo-check",
            ...(spec.model ? ["-m", spec.model] : []),
            ...CODEX_FEATURES_OFF.flatMap((f) => ["--disable", f]),
            ...config,
        ];
        // `resume` takes neither -C nor -s: the cwd comes from the spawn, the sandbox from config
        const args = spec.thread ? ["exec", "resume", ...common, spec.thread, spec.message] : ["exec", ...common, spec.message];
        return { command: spec.command, args, tokenEnv: MCP_TOKEN_ENV, thread: spec.thread };
    }
    const session = spec.thread ?? randomUUID();
    const mcp = {
        mcpServers: {
            // Claude Code expands ${VAR} in headers: the token stays out of argv
            [MCP_SERVER]: { type: "http", url: spec.mcpUrl, headers: { Authorization: `Bearer \${${MCP_TOKEN_ENV}}` } },
        },
    };
    const args = [
        "-p", "--output-format", "stream-json", "--verbose",
        ...(spec.model ? ["--model", spec.model] : []),
        "--tools", "WebSearch", CLAUDE_SUBAGENT_TOOL,
        "--allowedTools", "WebSearch", CLAUDE_SUBAGENT_TOOL, `mcp__${MCP_SERVER}`,
        "--permission-mode", "dontAsk",
        "--mcp-config", JSON.stringify(mcp), "--strict-mcp-config",
        "--append-system-prompt", `${instructions(spec.name, spec.sections)}\n\n${SUBAGENT_NOTE}`,
        ...(spec.thread ? ["--resume", spec.thread] : ["--session-id", session]),
        spec.message,
    ];
    return { command: spec.command, args, tokenEnv: MCP_TOKEN_ENV, thread: session };
}

export type TurnEvent =
    | { type: "thread"; id: string }
    | { type: "message"; text: string }
    | { type: "search"; query: string }
    | { type: "failed"; message: string };

/** One line of the harness's JSON output → what the conversation cares about. Tool calls arrive through MCP instead. */
export function parseTurnLine(harness: Harness, line: string): TurnEvent[] {
    let ev: any;
    try {
        ev = JSON.parse(line);
    } catch {
        return []; // not an event (a stray log line): the turn's outcome comes from its events and exit
    }
    if (!ev || typeof ev !== "object") return [];
    if (harness === "codex") {
        if (ev.type === "thread.started" && typeof ev.thread_id === "string") return [{ type: "thread", id: ev.thread_id }];
        if (ev.type === "item.completed" && ev.item?.type === "agent_message" && typeof ev.item.text === "string") {
            return [{ type: "message", text: ev.item.text }];
        }
        if (ev.type === "item.completed" && ev.item?.type === "web_search") return [{ type: "search", query: String(ev.item.query ?? "") }];
        if (ev.type === "turn.failed") return [{ type: "failed", message: String(ev.error?.message ?? "the turn failed") }];
        if (ev.type === "error") return [{ type: "failed", message: String(ev.message ?? "Codex reported an error") }];
        return [];
    }
    if (ev.type === "assistant") {
        const out: TurnEvent[] = [];
        // a subagent's words go back to the agent, which says what came of them; only its searches show
        const subagent = typeof ev.parent_tool_use_id === "string";
        for (const c of ev.message?.content ?? []) {
            if (c?.type === "text" && !subagent && typeof c.text === "string" && c.text.trim()) out.push({ type: "message", text: c.text });
            if (c?.type === "tool_use" && c.name === "WebSearch") out.push({ type: "search", query: String(c.input?.query ?? "") });
        }
        return out;
    }
    if (ev.type === "result" && ev.is_error) return [{ type: "failed", message: String(ev.result ?? ev.subtype ?? "Claude reported an error") }];
    return [];
}
