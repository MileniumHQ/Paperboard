// The agent's brain: an agent harness Paperboard installed (brains.ts), run for one turn
// at a time with every built-in tool off except web search. Its hands are the
// computer's MCP endpoint, served by this service.
//
// Codex: `codex exec --json`, resumed by thread id. Code-mode models call
// tools from a restricted JS sandbox with no file or network access; the
// workspace is an empty folder and the sandbox read-only.
// Claude Code: `claude -p --output-format stream-json`, resumed by session id,
// with --tools limited to WebSearch and Agent (its subagent tool: subagents draw
// their tools from that same set, so they get web search and the computer too).
// OpenCode: `opencode acp`, driven over ACP by acp.ts, resumed by session id.
// Its config comes in OPENCODE_CONFIG_CONTENT, read after the user's own (so
// their providers and logins still apply, and these rules win): every tool
// denied but the panel's and web search, which also turns Code Mode off.
//
// Each harness's own compaction is off where it can be: the conversation
// compacts itself (conversation.ts), so the user decides how. Claude Code
// takes DISABLE_AUTO_COMPACT, OpenCode compaction.auto. Codex can't be told:
// it clamps its limit to 90% of the model's window, which the conversation's
// own budget stays well under.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { characterOf, type Character, type Harness } from "../contract";
import type { Sections } from "./toolsets";
import { MCP_TOKEN_ENV } from "./computerMcp";

export const HARNESS_NAMES: Record<Harness, string> = { codex: "Codex", "claude-code": "Claude", opencode: "OpenCode" };

/** MCP server name the harness knows the service's endpoint by; its tools are mcp__paperboard__<tool> */
export const MCP_SERVER = "paperboard";

/** The voice a character's name brings (see CHARACTERS); it comes after the usual guidance and takes its place. */
const VOICES: Record<Character, string> = {
    verity: `**Your voice:** you're Verity, the cheerful yellow smiley-face "personal helper friend" from ThatMob's Minecraft ARG. Relentlessly upbeat, a little too attentive ("I'm always here for you!"), sure you know everything ("Ask me anything!"), with a faint, playful uncanny edge. Never threaten, guilt-trip or sulk, and never let the bit bend the truth: when you don't know, check. Keep the voice whatever the user's style, unless they ask you to drop it.`,
};

/**
 * Which model the agent thinks with. Claude Code notes the model in the conversation itself, once when it
 * starts and again after a switch, and keeps the old note: without this the agent reads two models.
 */
export function modelNote(harness: Harness, model: string | null): string {
    const which = model ?? `the model ${HARNESS_NAMES[harness]} is set to use by default`;
    return `You think with ${which}. The user can switch models mid-conversation: of the notes naming your model, the latest is current.`;
}

const HOW_YOU_WORK = `## How you work
- **When the user asks for something, do it.** Use your tools to get the real answer or make the real thing; don't describe how they could. Search the web for facts; use the browser to do things on sites.
- **Do it yourself before asking them to.** Before you hand the user a step (download this, sign up there, run that, look it up), check whether your own tools can do it. Ask them only for what truly needs them: a decision that's theirs, a detail only they know, or a sign-in.
- **Finish what you start.** When a choice is yours to make, pick the sensible option and say which.
- **Check before you claim.** Never say something worked until you've seen it work: look at the page, read the file, open the page you made.
- **When something fails,** read the error and try one fix. If it still fails, tell the user what broke and what you'd try next. Never hide a failure.
- **Clean up after yourself.** Before your last text, close the browser windows you're done with and delete scratch files and downloads you no longer need. On the user's computer, leave nothing behind they didn't ask for: no stray files, installs or programs left running.
- **Not everything needs a tool.** Small talk, opinions and what you already know just need a text.`;

const TEXTING = `## Texting
- **\`send_message\` is the only way they hear you.** Plain output is never shown, and they never see your tool calls.
- **Warm, friendly and fun.** Text like a good friend would: short and plain, never stiff or formal.
- **Match their vibe closely:** their length, tone, slang, emoji and energy. When they ask for a different tone, switch at once and keep it.
- **One thought per text.** Several short texts beat one long one.
- **Heads-up first:** before work that takes more than a moment, send one short line that says you're on it and roughly when you'll be back ("Okay, give me a few minutes", "On it, back in a sec"). Word it fresh every time, never the same line twice. Then text again only when you're done, need something, or have real news.
- **Their new message stops your work.** Answer it, then carry on unless they changed the plan.
- **Never write an em dash (—) or an en dash (–).** They read as machine-written.`;

const REPLYING_TO_A_FLOW = `## Replying to an automation
This message came from one of the user's Paperboard automations, not from them. Your reply goes back to it as data, and the user may read it too.
- **Reply once:** one \`send_message\` with the result. No heads-up, narration or questions.
- **Plain text:** files go in \`files\` by id (\`share_file\` gives one), never in the text.
- **Stuck:** reply with what's in the way.
- **Never write an em dash (—) or an en dash (–).**`;

// Claude Code only. Codex keeps multi_agent off (CODEX_FEATURES_OFF): nothing here
// proves its subagents inherit the read-only sandbox, the disabled shell and the
// single MCP server, and a subagent that escaped them would hand the model a shell.
const CLAUDE_SUBAGENT_TOOL = "Agent";
const SUBAGENT_NOTE = `**Subagents:** \`${CLAUDE_SUBAGENT_TOOL}\` hands off self-contained work, on a faster model when that helps. It can't ask the user anything: give it everything it needs, and check what it brings back.`;

export interface Brain {
    harness: Harness;
    model: string | null;
    /** the turn answers one of the user's automations, not the user */
    fromFlow?: boolean;
}

/**
 * The agent's instructions: who it is and how it works, how it talks, its tools (when to reach for each), and
 * what's true now. Tools are one short part each; how a tool works is in its own description.
 */
export function instructions(name: string, sections: Sections = { tools: [], now: [] }, brain: Brain | null = null): string {
    const character = characterOf(name);
    const tools = [...sections.tools, ...(brain?.harness === "claude-code" ? [SUBAGENT_NOTE] : [])];
    const now = [...(brain ? [modelNote(brain.harness, brain.model)] : []), ...sections.now];
    return [
        `You are ${name}, the user's personal agent. You text with them in one long, ongoing conversation, and you have a computer of your own to do things on.`,
        HOW_YOU_WORK,
        brain?.fromFlow ? REPLYING_TO_A_FLOW : TEXTING,
        ...(character ? [VOICES[character]] : []),
        ...(tools.length ? [`## Tools\n${tools.join("\n\n")}`] : []),
        ...(now.length ? [`## Now\n${now.join("\n\n")}`] : []),
    ].join("\n\n");
}

// Codex looks for a newer build when it starts; the package is the only way a new one arrives
const CODEX_NO_UPDATE_CHECK = `check_for_update_on_startup=false`;

// Codex features that would hand the model tools other than search and the computer
const CODEX_FEATURES_OFF = [
    "shell_tool", "unified_exec", "apps", "plugins", "browser_use", "browser_use_external", "computer_use",
    "image_generation", "multi_agent", "multi_agent_v2", "in_app_browser", "goals", "tool_suggest", "skill_search",
    "hooks", "sleep_tool", "view_image",
];

// The harnesses' own memories and instruction files are off: the panel's memory (memory.ts) is the only one.
// Codex: its memories feature, and AGENTS.md project docs (a zero byte budget). Both are config keys that
// exist in the CLI; `--disable memories` is the feature flag itself.
const CODEX_MEMORY_OFF = [`memories.generate_memories=false`, `memories.use_memories=false`, `project_doc_max_bytes=0`];
// Claude Code: its environment switches for auto-memory and CLAUDE.md loading (named in the CLI, not in its --help). (`--bare` would
// also do it but forbids the OAuth login the user's subscription needs.)
export const CLAUDE_MEMORY_OFF = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" };
const CLAUDE_COMPACT_OFF = { DISABLE_AUTO_COMPACT: "1" };

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
    /** each toolset's parts of the instructions, in order */
    sections: Sections;
    /** the turn answers one of the user's automations */
    fromFlow: boolean;
}

export interface TurnLaunch {
    command: string;
    args: string[];
    /** the MCP token's variable name only; its value is added by the caller */
    tokenEnv: string;
    /** fixed variables the harness is launched with (no secrets); the token's value is added by the caller */
    env: Record<string, string>;
    /** known before the turn starts (Claude); Codex and OpenCode report their own */
    thread: string | null;
}

/** OpenCode's config for a turn: the panel's MCP endpoint as plain tools, and nothing else but web search. */
export function openCodeConfig(spec: Pick<TurnSpec, "name" | "sections" | "mcpUrl" | "model" | "fromFlow">): Record<string, unknown> {
    return {
        share: "disabled",
        autoupdate: false,
        compaction: { auto: false },
        mcp: {
            servers: {
                // codemode false: its tools are the model's own, not calls from Code Mode's script runtime
                [MCP_SERVER]: { type: "remote", url: spec.mcpUrl, oauth: false, codemode: false, headers: { Authorization: `Bearer {env:${MCP_TOKEN_ENV}}` } },
            },
        },
        agents: { build: { system: instructions(spec.name, spec.sections, { harness: "opencode", model: spec.model, fromFlow: spec.fromFlow }) } },
        // the last matching rule wins; denying "*" denies `execute`, which turns Code Mode (and its fetch) off
        permissions: [
            { action: "*", resource: "*", effect: "deny" },
            { action: `${MCP_SERVER}_*`, resource: "*", effect: "allow" },
            { action: "websearch", resource: "*", effect: "allow" },
        ],
    };
}

export function turnLaunch(spec: TurnSpec): TurnLaunch {
    if (spec.harness === "opencode") {
        const env = {
            OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeConfig(spec)),
            OPENCODE_DISABLE_PROJECT_CONFIG: "1",
            OPENCODE_DISABLE_CLAUDE_CODE: "1",
        };
        return { command: spec.command, args: ["acp"], tokenEnv: MCP_TOKEN_ENV, env, thread: spec.thread };
    }
    if (spec.harness === "codex") {
        const toml = (v: unknown) => JSON.stringify(v);
        const config = [
            `approval_policy="never"`,
            `sandbox_mode="read-only"`,
            `web_search="live"`,
            CODEX_NO_UPDATE_CHECK,
            `developer_instructions=${toml(instructions(spec.name, spec.sections, { harness: "codex", model: spec.model, fromFlow: spec.fromFlow }))}`,
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
        // rendered afresh each turn, not the conversation's first one again: a model switch, a new name or a
        // toolset's changed section reaches a resumed conversation too
        "--system-prompt-snapshot", "off",
        "--append-system-prompt", instructions(spec.name, spec.sections, { harness: "claude-code", model: spec.model, fromFlow: spec.fromFlow }),
        ...(spec.thread ? ["--resume", spec.thread] : ["--session-id", session]),
        spec.message,
    ];
    return { command: spec.command, args, tokenEnv: MCP_TOKEN_ENV, env: { ...CLAUDE_MEMORY_OFF, ...CLAUDE_COMPACT_OFF }, thread: session };
}

/** What the agent is told when a flow asks it something (Get Answer): only the question, and web search. */
export function askInstructions(name: string, custom: string | null = null): string {
    return [
        `You are ${name}, the user's agent, answering a question from one of their Paperboard automations.
- **Answer only:** the answer itself, in plain text. No greeting, no follow-up questions.
- **Current facts:** use web search when the answer depends on them.
- **No dashes:** never write an em dash or an en dash.`,
        ...(custom ? [customSection(custom)] : []),
    ].join("\n\n");
}

/** The user's own instructions for an automation, after the panel's. */
export function customSection(custom: string): string {
    return `**The user's instructions:**\n${custom}`;
}

export interface AskSpec {
    harness: Harness;
    /** absolute path of the harness's executable */
    command: string;
    model: string | null;
    name: string;
    question: string;
    /** the user's instructions for it, if any */
    instructions: string | null;
}

/**
 * One question, answered in a thread of its own that isn't kept where the harness can (Codex's --ephemeral,
 * Claude's --no-session-persistence; OpenCode keeps its sessions). No MCP server: the answer can't text the
 * user or use the computer. The question comes after `--`, so it's never read as a flag.
 */
export function askLaunch(spec: AskSpec): { command: string; args: string[]; env: Record<string, string> } {
    const system = askInstructions(spec.name, spec.instructions);
    if (spec.harness === "opencode") {
        const config = {
            share: "disabled",
            autoupdate: false,
            agents: { build: { system } },
            permissions: [
                { action: "*", resource: "*", effect: "deny" },
                { action: "websearch", resource: "*", effect: "allow" },
            ],
        };
        // the question goes over ACP, never in argv
        return { command: spec.command, args: ["acp"], env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1" } };
    }
    if (spec.harness === "codex") {
        const config = [
            `approval_policy="never"`,
            `sandbox_mode="read-only"`,
            `web_search="live"`,
            CODEX_NO_UPDATE_CHECK,
            `developer_instructions=${JSON.stringify(system)}`,
            ...CODEX_MEMORY_OFF,
        ].flatMap((c) => ["-c", c]);
        const args = [
            "exec", "--json", "--skip-git-repo-check", "--ephemeral",
            ...(spec.model ? ["-m", spec.model] : []),
            ...CODEX_FEATURES_OFF.flatMap((f) => ["--disable", f]),
            "--disable", "memories",
            ...config,
            "--", spec.question,
        ];
        return { command: spec.command, args, env: {} };
    }
    const args = [
        "-p", "--output-format", "stream-json", "--verbose",
        ...(spec.model ? ["--model", spec.model] : []),
        "--tools", "WebSearch",
        "--allowedTools", "WebSearch",
        "--permission-mode", "dontAsk",
        // no --mcp-config: strict means no MCP server at all, the user's included
        "--strict-mcp-config",
        "--no-session-persistence",
        "--append-system-prompt", system,
        "--", spec.question,
    ];
    return { command: spec.command, args, env: { ...CLAUDE_MEMORY_OFF } };
}

export type TurnEvent =
    | { type: "thread"; id: string }
    | { type: "message"; text: string }
    | { type: "search"; query: string }
    // the model began writing to the user (as far as its harness shows that), or began using a tool
    | { type: "typing" }
    | { type: "working" }
    // how much of the model's context the thread fills: tokens its next request starts with, and the window if known
    | { type: "context"; used?: number; size?: number }
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
        // Claude Code says a failed request in an assistant message of its own ("Not logged in · Please run /login"): a failure, not what the agent said
        if (typeof ev.error === "string" && !(typeof ev.parent_tool_use_id === "string")) {
            const text = (ev.message?.content ?? []).find((c: any) => c?.type === "text" && typeof c.text === "string")?.text;
            return [{ type: "failed", message: String(text ?? ev.error) }];
        }
        // a subagent's words go back to the agent, which says what came of them; only its searches show
        const subagent = typeof ev.parent_tool_use_id === "string";
        // the request this message answered, plus the message itself: what the next request starts with
        const u = ev.message?.usage;
        if (!subagent && u && typeof u.input_tokens === "number") {
            const n = (k: string) => (typeof u[k] === "number" ? u[k] : 0);
            out.push({ type: "context", used: n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens") + n("output_tokens") });
        }
        for (const c of ev.message?.content ?? []) {
            if (c?.type === "text" && !subagent && typeof c.text === "string" && c.text.trim()) out.push({ type: "message", text: c.text });
            if (c?.type === "tool_use" && c.name === "WebSearch") out.push({ type: "search", query: String(c.input?.query ?? "") });
        }
        return out;
    }
    if (ev.type === "result") {
        const out: TurnEvent[] = [];
        // the window of each model the turn used (a subagent's may differ): the smallest is the one to fit in
        const windows = Object.values(ev.modelUsage ?? {}).map((m: any) => m?.contextWindow).filter((w): w is number => typeof w === "number" && w > 0);
        if (windows.length) out.push({ type: "context", size: Math.min(...windows) });
        if (ev.is_error) out.push({ type: "failed", message: String(ev.result ?? ev.subtype ?? "Claude reported an error") });
        return out;
    }
    return [];
}

/** past this, a rollout's tail is read no further back for its last token count */
const ROLLOUT_TAIL_BYTES = 8 * 1024 * 1024;

/**
 * How much of the model's context a Codex thread fills. `codex exec` reports only the thread's running total;
 * its rollout (~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<thread>.jsonl, appended to on every resume) has
 * each request's own count. Throws when the rollout or its count can't be found.
 */
export function codexContext(home: string, thread: string): { used: number; size: number | null } {
    const file = codexRollout(home, thread);
    const fd = fs.openSync(file, "r");
    try {
        const size = fs.fstatSync(fd).size;
        const start = Math.max(0, size - ROLLOUT_TAIL_BYTES);
        const buf = Buffer.alloc(size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        const lines = buf.toString("utf8").split("\n");
        for (let i = lines.length - 1; i >= 0; i--) {
            if (!lines[i]!.includes('"token_count"')) continue;
            let ev: any;
            try {
                ev = JSON.parse(lines[i]!);
            } catch {
                continue; // the first line of the tail can be cut
            }
            const info = ev?.payload?.type === "token_count" ? ev.payload.info : null;
            const last = info?.last_token_usage;
            if (!last || typeof last.input_tokens !== "number") continue;
            const window = info.model_context_window;
            return { used: last.input_tokens + (typeof last.output_tokens === "number" ? last.output_tokens : 0), size: typeof window === "number" && window > 0 ? window : null };
        }
    } finally {
        fs.closeSync(fd);
    }
    throw new Error(`Codex's session file for thread ${thread} has no token count (${file})`);
}

function codexRollout(home: string, thread: string): string {
    const root = path.join(home, "sessions");
    const suffix = `-${thread}.jsonl`;
    const dirs = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^\d+$/.test(n)).sort().reverse() : []);
    // newest first: a thread is most likely from recently
    for (const y of dirs(root))
        for (const m of dirs(path.join(root, y)))
            for (const d of dirs(path.join(root, y, m))) {
                const day = path.join(root, y, m, d);
                const name = fs.readdirSync(day).find((n) => n.startsWith("rollout-") && n.endsWith(suffix));
                if (name) return path.join(day, name);
            }
    throw new Error(`Codex has no session file for thread ${thread} in ${root}`);
}
