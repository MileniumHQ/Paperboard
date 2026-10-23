import { describe, expect, test } from "bun:test";
import { MCP_TOKEN_ENV } from "../src/service/computerMcp";
import { parseTurnLine, turnLaunch } from "../src/service/harness";

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
            expect(l.env).toEqual({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" });
            // --bare would also skip them, but it refuses the OAuth login
            expect(l.args).not.toContain("--bare");
        }
    });
});

describe("parseTurnLine", () => {
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
