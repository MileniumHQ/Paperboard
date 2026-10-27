import { describe, expect, test } from "bun:test";
import { MCP_TOKEN_ENV } from "../src/service/computerMcp";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { codexContext, instructions, openCodeConfig, parseTurnLine, turnLaunch } from "../src/service/harness";
import { MESSAGES_INSTRUCTIONS } from "../src/service/messages";
import { COMPUTER_INSTRUCTIONS } from "../src/service/computerTools";
import { characterOf } from "../src/contract";
import { skinFor } from "../src/face/skins";

const spec = { command: "/usr/bin/x", model: null, name: "Pip", thread: null, message: "hi; rm -rf ~", mcpUrl: "http://127.0.0.1:4567/mcp", sections: ["SECTION-ONE"] };

describe("turnLaunch", () => {
    test("Codex: built-in tools off, live web search, the computer over MCP with the token by variable name", () => {
        const l = turnLaunch({ ...spec, harness: "codex" });
        expect(l.args.slice(0, 2)).toEqual(["exec", "--json"]);
        for (const f of ["shell_tool", "unified_exec", "apps", "computer_use", "browser_use"]) {
            expect(l.args.join(" ")).toContain(`--disable ${f}`);
        }
        expect(l.args).toContain(`web_search="live"`);
        expect(l.args).toContain(`sandbox_mode="read-only"`);
        // subagents stay off for Codex, and the brain isn't told it can use them
        expect(l.args.join(" ")).toContain("--disable multi_agent --disable multi_agent_v2");
        expect(l.args.find((a) => a.startsWith("developer_instructions="))).not.toContain("subagent");
        expect(l.args).toContain(`mcp_servers.paperboard.url="${spec.mcpUrl}"`);
        expect(l.args).toContain(`mcp_servers.paperboard.bearer_token_env_var="${MCP_TOKEN_ENV}"`);
        expect(l.tokenEnv).toBe(MCP_TOKEN_ENV);
        // every toolset's section reaches the instructions
        expect(l.args.find((a) => a.startsWith("developer_instructions="))).toContain("SECTION-ONE");
        // the message is one argv entry, never shell text
        expect(l.args.at(-1)).toBe(spec.message);
    });

    test("Codex resumes its own thread", () => {
        const l = turnLaunch({ ...spec, harness: "codex", thread: "t-1", model: "gpt-x" });
        expect(l.args.slice(0, 2)).toEqual(["exec", "resume"]);
        expect(l.args.slice(-2)).toEqual(["t-1", spec.message]);
        expect(l.args.join(" ")).toContain("-m gpt-x");
    });

    test("Claude Code: only WebSearch, the computer's MCP and nothing else, the token expanded from env", () => {
        const l = turnLaunch({ ...spec, harness: "claude-code" });
        const at = (flag: string) => l.args[l.args.indexOf(flag) + 1];
        expect(l.args.slice(l.args.indexOf("--tools") + 1, l.args.indexOf("--tools") + 3)).toEqual(["WebSearch", "Agent"]);
        // the subagent tool is allowed, and nothing built-in beyond it and search
        const allowed = l.args.slice(l.args.indexOf("--allowedTools") + 1, l.args.indexOf("--permission-mode"));
        expect(allowed).toEqual(["WebSearch", "Agent", "mcp__paperboard"]);
        expect(at("--permission-mode")).toBe("dontAsk");
        expect(at("--append-system-prompt")).toContain("subagent");
        expect(l.args).toContain("--strict-mcp-config");
        const config = JSON.parse(at("--mcp-config")!);
        expect(config.mcpServers.paperboard).toEqual({ type: "http", url: spec.mcpUrl, headers: { Authorization: `Bearer \${${MCP_TOKEN_ENV}}` } });
        // a new conversation is given its id up front, so it can be resumed even if the turn dies
        expect(at("--session-id")).toBe(l.thread!);
        expect(at("--append-system-prompt")).toContain("SECTION-ONE");
        expect(l.args.at(-1)).toBe(spec.message);
        expect(turnLaunch({ ...spec, harness: "claude-code", thread: "s-1" }).args).toContain("--resume");
    });
});

describe("the harnesses' own memory is off", () => {
    test("Codex: the memories feature, generating and using them, and AGENTS.md docs", () => {
        const l = turnLaunch({ ...spec, harness: "codex" });
        expect(l.args.join(" ")).toContain("--disable memories");
        for (const c of ["memories.generate_memories=false", "memories.use_memories=false", "project_doc_max_bytes=0"]) {
            expect(l.args[l.args.indexOf(c) - 1]).toBe("-c");
        }
        // resumed turns too
        expect(turnLaunch({ ...spec, harness: "codex", thread: "t" }).args).toContain("memories.use_memories=false");
        expect(l.env).toEqual({});
    });

    test("Claude Code: auto-memory and CLAUDE.md loading are switched off in its environment", () => {
        for (const thread of [null, "s-1"]) {
            const l = turnLaunch({ ...spec, harness: "claude-code", thread });
            expect(l.env).toMatchObject({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" });
            // --bare would also skip them, but it refuses the OAuth login
            expect(l.args).not.toContain("--bare");
        }
    });
});

describe("parseTurnLine", () => {
    test("a block's start says whether the model is writing to the user or working; a subagent's says nothing", () => {
        const start = (content_block: object, parent: string | null = null) =>
            JSON.stringify({ type: "stream_event", parent_tool_use_id: parent, event: { type: "content_block_start", index: 0, content_block } });
        expect(parseTurnLine("claude-code", start({ type: "tool_use", name: "mcp__paperboard__send_message", input: {} }))).toEqual([{ type: "typing" }]);
        expect(parseTurnLine("claude-code", start({ type: "text", text: "" }))).toEqual([{ type: "typing" }]);
        expect(parseTurnLine("claude-code", start({ type: "tool_use", name: "mcp__paperboard__look", input: {} }))).toEqual([{ type: "working" }]);
        expect(parseTurnLine("claude-code", start({ type: "server_tool_use", name: "web_search", input: {} }))).toEqual([{ type: "working" }]);
        expect(parseTurnLine("claude-code", start({ type: "thinking", thinking: "" }))).toEqual([]);
        expect(parseTurnLine("claude-code", start({ type: "text", text: "" }, "toolu_1"))).toEqual([]);
        expect(parseTurnLine("codex", `{"type":"item.started","item":{"type":"mcp_tool_call","server":"paperboard","tool":"look"}}`)).toEqual([{ type: "working" }]);
        expect(parseTurnLine("codex", `{"type":"item.started","item":{"type":"mcp_tool_call","server":"paperboard","tool":"send_message"}}`)).toEqual([]);
    });

    test("Claude Code: a subagent's words don't reach the chat, its searches still do", () => {
        const sub = { type: "assistant", parent_tool_use_id: "toolu_1", message: { content: [{ type: "text", text: "found it" }, { type: "tool_use", name: "WebSearch", input: { query: "q2" } }] } };
        expect(parseTurnLine("claude-code", JSON.stringify(sub))).toEqual([{ type: "search", query: "q2" }]);
    });

    test("Codex events", () => {
        expect(parseTurnLine("codex", `{"type":"thread.started","thread_id":"t-9"}`)).toEqual([{ type: "thread", id: "t-9" }]);
        expect(parseTurnLine("codex", `{"type":"item.completed","item":{"type":"agent_message","text":"done!"}}`)).toEqual([{ type: "message", text: "done!" }]);
        expect(parseTurnLine("codex", `{"type":"item.completed","item":{"type":"web_search","query":"origami"}}`)).toEqual([{ type: "search", query: "origami" }]);
        expect(parseTurnLine("codex", `{"type":"turn.failed","error":{"message":"rate limited"}}`)).toEqual([{ type: "failed", message: "rate limited" }]);
    });

    test("Claude Code events", () => {
        const assistant = { type: "assistant", message: { content: [{ type: "text", text: "on it" }, { type: "tool_use", name: "WebSearch", input: { query: "q" } }, { type: "tool_use", name: "mcp__computer__shell", input: {} }] } };
        expect(parseTurnLine("claude-code", JSON.stringify(assistant))).toEqual([
            { type: "message", text: "on it" },
            { type: "search", query: "q" },
        ]);
        expect(parseTurnLine("claude-code", `{"type":"result","is_error":true,"result":"no credits"}`)).toEqual([{ type: "failed", message: "no credits" }]);
        expect(parseTurnLine("claude-code", `{"type":"result","is_error":false,"result":"on it"}`)).toEqual([]);
    });

    test("a line that isn't an event is no event", () => {
        expect(parseTurnLine("codex", "Reading prompt from stdin...")).toEqual([]);
    });
});

describe("a name that brings a character", () => {
    test("Verity, in any case or spacing, gets her voice and her yellow face; other names get neither", () => {
        for (const name of ["Verity", " verity ", "VERITY"]) {
            expect(characterOf(name)).toBe("verity");
            expect(instructions(name)).toContain("you're Verity");
            expect(skinFor(name)).toEqual({ sphere: "var(--paper-face-verity)", ink: "var(--paper-face-verity-ink)" });
        }
        for (const name of ["Chippy", "Verity2", "", null]) {
            expect(characterOf(name)).toBeNull();
            expect(skinFor(name)).toBeNull();
        }
        expect(instructions("Chippy")).not.toContain("Verity");
    });
});

describe("dashes", () => {
    test("the agent is told not to write em or en dashes, and its instructions don't use them either", () => {
        const text = instructions("Verity", [MESSAGES_INSTRUCTIONS, COMPUTER_INSTRUCTIONS]);
        expect(text).toContain("Never write an em dash (—) or an en dash (–) in a text.");
        // an example of what not to write is the only one there
        expect(text.replace("Never write an em dash (—) or an en dash (–) in a text.", "")).not.toMatch(/[—–]/);
    });
});

describe("the harnesses' own compaction is off: the conversation compacts itself", () => {
    test("Claude Code by its environment, OpenCode by its config", () => {
        expect(turnLaunch({ ...spec, harness: "claude-code" }).env).toMatchObject({ DISABLE_AUTO_COMPACT: "1" });
        expect(openCodeConfig(spec)).toMatchObject({ compaction: { auto: false } });
        const opencode = JSON.parse(turnLaunch({ ...spec, harness: "opencode" }).env.OPENCODE_CONFIG_CONTENT!);
        expect(opencode.compaction).toEqual({ auto: false });
    });
});

describe("how much of its context a thread fills", () => {
    test("Claude Code: the main agent's last request and reply, and the smallest window the turn used", () => {
        const assistant = (usage: object, parent: string | null = null) =>
            JSON.stringify({ type: "assistant", parent_tool_use_id: parent, message: { id: "m", content: [], usage } });
        expect(parseTurnLine("claude-code", assistant({ input_tokens: 10, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 2_000, output_tokens: 300 }))).toEqual([
            { type: "context", used: 52_310 },
        ]);
        // a subagent's requests are its own thread's, not the conversation's
        expect(parseTurnLine("claude-code", assistant({ input_tokens: 99_999 }, "toolu_1"))).toEqual([]);
        const result = JSON.stringify({ type: "result", is_error: false, modelUsage: { "claude-opus-5-5": { contextWindow: 1_000_000 }, "claude-haiku-5-5": { contextWindow: 200_000 } } });
        expect(parseTurnLine("claude-code", result)).toEqual([{ type: "context", size: 200_000 }]);
    });

    test("Codex: the last token count in the thread's rollout, wherever its day is", () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-codex-home-"));
        try {
            const day = path.join(home, "sessions", "2026", "10", "25");
            fs.mkdirSync(day, { recursive: true });
            fs.mkdirSync(path.join(home, "sessions", "2026", "10", "26"));
            const count = (input: number) => JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: input, output_tokens: 40 }, model_context_window: 272_000 } } });
            const lines = [JSON.stringify({ type: "session_meta" }), count(20_000), JSON.stringify({ type: "response_item" }), count(81_000), JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: null } })];
            fs.writeFileSync(path.join(day, "rollout-2026-10-25T10-00-00-th-1.jsonl"), lines.join("\n") + "\n");
            expect(codexContext(home, "th-1")).toEqual({ used: 81_040, size: 272_000 });
            expect(() => codexContext(home, "th-2")).toThrow(/no session file for thread th-2/);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
