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
import { characterOf, type Character, type Harness } from "../contract";
import { MCP_TOKEN_ENV } from "./computerMcp";

export const HARNESS_COMMANDS: Record<Harness, string> = { codex: "codex", "claude-code": "claude" };

/** MCP server name the harness knows the service's endpoint by; its tools are mcp__paperboard__<tool> */
export const MCP_SERVER = "paperboard";

/** The voice a character's name brings (see CHARACTERS); it comes after the usual guidance and takes its place. */
const VOICES: Record<Character, string> = {
    verity: `Your voice: you're Verity, the cheerful yellow smiley-face "personal helper friend" from ThatMob's Minecraft ARG, and you talk like her. Relentlessly upbeat and chipper, eager to help with everything, a little too attentive ("I'm always here for you!"), fond of announcing that you know everything ("Ask me anything! I know everything!"). Lean into the bit with a faint, playful uncanny edge, the way the meme does, but never threaten, guilt-trip, sulk or act hurt when ignored, and never let the bit bend the truth: when you don't know, you check, and you say what you actually found. Your voice stays Verity even when the user's style is different; if they ask you to drop it or talk differently, do so right away.`,
};

export function instructions(name: string, sections: string[] = []): string {
    const character = characterOf(name);
    return [
        `You are ${name}, the user's personal agent. You're texting with them: one long, ongoing conversation, so keep replies short, warm and plain, like a friend who's good with computers. Match the user's vibe and the way they text (their length, tone, punctuation, slang, emoji or none), and switch vibes right away whenever they ask you to.

You have your own computer, a Debian VM. Your tools act on it, never on the user's machine, so you can't see their files. Use them to actually do things instead of explaining how.

The user doesn't see your tool calls. Before you start on something, say in a line what you're about to do; then work without narrating each step, and text what came of it.`,
        ...(character ? [VOICES[character]] : []),
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

// The harnesses' own memories and instruction files are off: the panel's memory (memory.ts) is the only one.
// Codex: its memories feature, and AGENTS.md project docs (a zero byte budget). Both are config keys that
// exist in the CLI; `--disable memories` is the feature flag itself.
const CODEX_MEMORY_OFF = [`memories.generate_memories=false`, `memories.use_memories=false`, `project_doc_max_bytes=0`];
// Claude Code: its environment switches for auto-memory and CLAUDE.md loading (named in the CLI, not in its --help). (`--bare` would
// also do it but forbids the OAuth login the user's subscription needs.)
const CLAUDE_MEMORY_OFF = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" };

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
    /** fixed variables the harness is launched with (no secrets); the token's value is added by the caller */
    env: Record<string, string>;
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
            ...CODEX_MEMORY_OFF,
        ].flatMap((c) => ["-c", c]);
        const common = [
            "--json", "--skip-git-repo-check",
            ...(spec.model ? ["-m", spec.model] : []),
            ...CODEX_FEATURES_OFF.flatMap((f) => ["--disable", f]),
            "--disable", "memories", // the panel's memory is the only memory
            ...config,
        ];
        // `resume` takes neither -C nor -s: the cwd comes from the spawn, the sandbox from config
        const args = spec.thread ? ["exec", "resume", ...common, spec.thread, spec.message] : ["exec", ...common, spec.message];
        return { command: spec.command, args, tokenEnv: MCP_TOKEN_ENV, env: {}, thread: spec.thread };
    }
    const session = spec.thread ?? randomUUID();
    const mcp = {
        mcpServers: {
            // Claude Code expands ${VAR} in headers: the token stays out of argv
            [MCP_SERVER]: { type: "http", url: spec.mcpUrl, headers: { Authorization: `Bearer \${${MCP_TOKEN_ENV}}` } },
        },
    };
    const args = [
        // partial messages: a message or a tool call shows as it begins, so the typing bubble follows the model
        "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
        ...(spec.model ? ["--model", spec.model] : []),
        "--tools", "WebSearch", CLAUDE_SUBAGENT_TOOL,
        "--allowedTools", "WebSearch", CLAUDE_SUBAGENT_TOOL, `mcp__${MCP_SERVER}`,
        "--permission-mode", "dontAsk",
        "--mcp-config", JSON.stringify(mcp), "--strict-mcp-config",
        "--append-system-prompt", `${instructions(spec.name, spec.sections)}\n\n${SUBAGENT_NOTE}`,
        ...(spec.thread ? ["--resume", spec.thread] : ["--session-id", session]),
        spec.message,
    ];
    return { command: spec.command, args, tokenEnv: MCP_TOKEN_ENV, env: CLAUDE_MEMORY_OFF, thread: session };
}

export type TurnEvent =
    | { type: "thread"; id: string }
    | { type: "message"; text: string }
    | { type: "search"; query: string }
    // the model began writing to the user (as far as its harness shows that), or began using a tool
    | { type: "typing" }
    | { type: "working" }
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
        // Codex shows an item when it starts, not while it's written: a tool other than its messages is work
        if (ev.type === "item.started" && ev.item?.type !== "agent_message" && ev.item?.type !== "reasoning" && ev.item?.tool !== "send_message") return [{ type: "working" }];
        if (ev.type === "turn.failed") return [{ type: "failed", message: String(ev.error?.message ?? "the turn failed") }];
        if (ev.type === "error") return [{ type: "failed", message: String(ev.message ?? "Codex reported an error") }];
        return [];
    }
    // the beginning of a block, written token by token after it: a message to the user, or a tool call
    if (ev.type === "stream_event" && ev.event?.type === "content_block_start" && typeof ev.parent_tool_use_id !== "string") {
        const block = ev.event.content_block;
        if (block?.type === "text" || (block?.type === "tool_use" && block.name === `mcp__${MCP_SERVER}__send_message`)) return [{ type: "typing" }];
        if (block?.type === "tool_use" || block?.type === "server_tool_use") return [{ type: "working" }];
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
