// The agent's brain: an agent harness the user already has, run for one turn
// at a time with every built-in tool off except web search. Its hands are the
// computer's MCP endpoint, served by this service.
//
// Codex: `codex exec --json`, resumed by thread id. Code-mode models call
// tools from a restricted JS sandbox with no file or network access; the
// workspace is an empty folder and the sandbox read-only.
// Claude Code: `claude -p --output-format stream-json`, resumed by session id,
// with --tools limited to WebSearch.

import { randomUUID } from "node:crypto";
import type { Harness } from "../contract";
import { MCP_TOKEN_ENV } from "./computerMcp";

export const HARNESS_COMMANDS: Record<Harness, string> = { codex: "codex", "claude-code": "claude" };

export function instructions(name: string): string {
    return `You are ${name}, the user's personal agent. You're texting with them: one long, ongoing conversation, so keep replies short, warm and plain, like a friend who's good with computers.

You have your own computer, a Debian VM. Your tools act on it, never on the user's machine, so you can't see their files. Use them to actually do things instead of explaining how.

Work quietly. The user sees your tool calls already, so don't announce or narrate steps ("let me open…", "now I'll click…", "next one"). Do the work, then reply once with what came of it. Only write mid-task when you need something from them or a long task has news worth hearing.

How to use your computer:
- Reach for \`shell\` first. Downloads, files, calculations, text, scripts and lookups are faster and more reliable there. Only open a window (\`open\`) when a task really needs one, like reading a web page that needs a browser or using a graphical app.
- With windows: \`look\` at it, act on a numbered mark (\`click\` with mark, then \`type\`/\`key\`), then \`look\` again to check what happened. Marks are only valid for the latest look.
- When something isn't marked, is tiny, or the text is too small to read (canvas, games, custom widgets), \`zoom\` into that region and click with the x/y its grid shows. \`hover\` opens hover menus; \`drag\` moves sliders and drags things.
- In the browser, ctrl+l focuses the address bar; typing a URL with enter=true goes there.
- You can search the web directly, too.
- Don't claim you did something you didn't verify.`;
}

// Codex features that would hand the model tools other than search and the computer
const CODEX_FEATURES_OFF = [
    "shell_tool", "unified_exec", "apps", "plugins", "browser_use", "browser_use_external", "computer_use",
    "image_generation", "multi_agent", "multi_agent_v2", "in_app_browser", "goals", "tool_suggest", "skill_search",
    "hooks", "sleep_tool", "view_image",
];

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
            `developer_instructions=${toml(instructions(spec.name))}`,
            `mcp_servers.computer.url=${toml(spec.mcpUrl)}`,
            `mcp_servers.computer.bearer_token_env_var=${toml(MCP_TOKEN_ENV)}`,
            `mcp_servers.computer.tool_timeout_sec=660`,
            // the computer's tools run unprompted; anything else stays denied by approval_policy=never
            `mcp_servers.computer.default_tools_approval_mode="approve"`,
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
            computer: { type: "http", url: spec.mcpUrl, headers: { Authorization: `Bearer \${${MCP_TOKEN_ENV}}` } },
        },
    };
    const args = [
        "-p", "--output-format", "stream-json", "--verbose",
        ...(spec.model ? ["--model", spec.model] : []),
        "--tools", "WebSearch",
        "--allowedTools", "WebSearch", "mcp__computer",
        "--permission-mode", "dontAsk",
        "--mcp-config", JSON.stringify(mcp), "--strict-mcp-config",
        "--append-system-prompt", instructions(spec.name),
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
        for (const c of ev.message?.content ?? []) {
            if (c?.type === "text" && typeof c.text === "string" && c.text.trim()) out.push({ type: "message", text: c.text });
            if (c?.type === "tool_use" && c.name === "WebSearch") out.push({ type: "search", query: String(c.input?.query ?? "") });
        }
        return out;
    }
    if (ev.type === "result" && ev.is_error) return [{ type: "failed", message: String(ev.result ?? ev.subtype ?? "Claude Code reported an error") }];
    return [];
}
