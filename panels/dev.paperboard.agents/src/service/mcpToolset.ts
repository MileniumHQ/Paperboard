// The user's MCP servers as the agent's tools, without drowning it.
//
// Two shapes, chosen once per turn (at the start, when the instructions are
// read and the servers are brought up) and kept for the whole turn, so the
// tool list the harness fetched stays true:
//
//   direct     the servers' tools together number at most DIRECT_MAX and fit
//              the limits below: each is offered under its own name,
//              `server__tool`, with its real schema. Nothing to learn.
//   discovery  anything more: two tools, `mcp_find_tools` (search by words,
//              at most MAX_FOUND answers with schemas) and `mcp_use_tool`,
//              plus one line per server in the instructions.
//
// Why 12: a model picks reliably among a dozen well-described tools; past
// that, each added schema costs every later turn's context and dilutes the
// choice, so search wins. Direct names are `server__tool`: servers are named
// with letters, digits and dashes only, so the pair is unambiguous and never
// collides with another toolset's names (none use a double underscore).

import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import type { McpServers } from "./mcpServers";
import type { Toolset } from "./toolsets";

export const DIRECT_MAX = 12;
export const MAX_FOUND = 10;
// the harness prefixes `mcp__paperboard__` and caps a full tool name at 64
const MAX_DIRECT_NAME = 46;
const MAX_DIRECT_DESCRIPTION = 500;
const MAX_DIRECT_SCHEMA = 4000;
const MAX_FOUND_SCHEMA = 4000;
const MAX_FOUND_DESCRIPTION = 300;

export const FIND_TOOLS = "mcp_find_tools";
export const USE_TOOL = "mcp_use_tool";

const META: ToolSpec[] = [
    {
        name: FIND_TOOLS,
        description:
            "Search the tools of the tool servers you have (listed in your instructions). " +
            `Returns at most ${MAX_FOUND} matches with their schemas. Give a search \`query\` and/or a \`server\`.`,
        inputSchema: { type: "object", properties: { query: { type: "string" }, server: { type: "string" } } },
    },
    {
        name: USE_TOOL,
        description: "Use a tool found with `mcp_find_tools`: its server, its name, and its arguments as an object.",
        inputSchema: {
            type: "object",
            properties: { server: { type: "string" }, tool: { type: "string" }, arguments: { type: "object" } },
            required: ["server", "tool"],
        },
    },
];

interface Direct {
    spec: ToolSpec;
    server: string;
    tool: string;
}

type Snapshot = { mode: "none" } | { mode: "discovery" } | { mode: "direct"; tools: Map<string, Direct> };

export function mcpToolset(servers: McpServers): Toolset {
    let snap: Snapshot = { mode: "none" };

    const anyEnabled = () => servers.config.servers.some((s) => s.enabled);

    function decide(): Snapshot {
        const up = servers.running();
        const all = up.flatMap((s) => s.tools.map((t) => ({ server: s.name, tool: t })));
        if (all.length === 0) return anyEnabled() ? { mode: "discovery" } : { mode: "none" };
        if (all.length > DIRECT_MAX) return { mode: "discovery" };
        const tools = new Map<string, Direct>();
        for (const { server, tool } of all) {
            const name = `${server}__${tool.name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
            const schema = JSON.stringify(tool.inputSchema);
            // a name or schema that can't be offered faithfully sends everything through search instead
            if (name.length > MAX_DIRECT_NAME || tools.has(name) || schema.length > MAX_DIRECT_SCHEMA) return { mode: "discovery" };
            tools.set(name, {
                server,
                tool: tool.name,
                spec: { name, description: `[${server}] ${cut(tool.description, MAX_DIRECT_DESCRIPTION)}`.trim(), inputSchema: tool.inputSchema },
            });
        }
        return { mode: "direct", tools };
    }

    return {
        id: "mcp",
        tools() {
            if (snap.mode === "direct") return [...snap.tools.values()].map((d) => d.spec);
            if (snap.mode === "discovery") return META;
            // before the first turn has looked: servers are configured, so search is there from the start
            return anyEnabled() ? META : [];
        },
        async instructions() {
            await servers.warm();
            snap = decide();
            const lines: string[] = [];
            const up = servers.running();
            if (snap.mode === "direct") {
                if (up.length) lines.push(`Tool servers you can use (their tools are in your tool list as server__tool): ${up.map((s) => s.name).join(", ")}.`);
            } else if (snap.mode === "discovery") {
                lines.push(
                    "You have tool servers with many tools, so they aren't all listed. Find the right one with `mcp_find_tools`, then call it with `mcp_use_tool`:",
                    ...up.map((s) => `- ${s.name}: ${s.tools.length} tools`),
                );
            }
            for (const u of servers.unavailable()) lines.push(`- ${u.name} is not available right now (${u.reason}). If you need it, tell the user.`);
            return lines.join("\n");
        },
        async call(name, args): Promise<ToolResult> {
            if (snap.mode === "direct") {
                const d = snap.tools.get(name);
                if (d) return servers.callTool(d.server, d.tool, args);
            }
            if (name === FIND_TOOLS) return find(args);
            if (name === USE_TOOL) {
                if (typeof args.server !== "string" || typeof args.tool !== "string") return fault("Say which server and tool.");
                if (args.arguments !== undefined && (typeof args.arguments !== "object" || args.arguments === null || Array.isArray(args.arguments))) {
                    return fault("arguments is an object of values by name.");
                }
                return servers.callTool(args.server, args.tool, (args.arguments ?? {}) as Record<string, unknown>);
            }
            return fault(`unknown tool ${name}`);
        },
    };

    function find(args: Record<string, unknown>): ToolResult {
        const query = typeof args.query === "string" ? args.query.trim().toLowerCase().slice(0, 200) : "";
        const server = typeof args.server === "string" ? args.server : "";
        const words = query.split(/[\s,._:/-]+/).filter(Boolean);
        const hits = servers
            .running()
            .filter((s) => !server || s.name === server)
            .flatMap((s) => s.tools.map((tool) => ({ server: s.name, tool })))
            .map((h) => ({ h, score: score(h.tool.name, h.tool.description, h.server, words) }))
            .filter((x) => !words.length || x.score > 0)
            .sort((a, b) => b.score - a.score || a.h.tool.name.localeCompare(b.h.tool.name));
        if (!hits.length) {
            const down = servers.unavailable().map((u) => `${u.name} (${u.reason})`);
            return { text: "No tools match." + (down.length ? ` Not available: ${down.join("; ")}.` : "") };
        }
        const shown = hits.slice(0, MAX_FOUND).map(({ h }) => {
            const schema = JSON.stringify(h.tool.inputSchema);
            return {
                server: h.server,
                tool: h.tool.name,
                description: cut(h.tool.description, MAX_FOUND_DESCRIPTION),
                inputSchema: schema.length <= MAX_FOUND_SCHEMA ? h.tool.inputSchema : { note: "schema too large to show", properties: Object.keys((h.tool.inputSchema as any).properties ?? {}) },
            };
        });
        const more = hits.length - shown.length;
        return { text: JSON.stringify({ tools: shown, ...(more > 0 ? { more: `${more} more match; narrow the query` } : {}) }, null, 1) };
    }
}

function score(name: string, description: string, server: string, words: string[]): number {
    if (!words.length) return 1;
    let total = 0;
    for (const w of words) {
        if (name.toLowerCase().includes(w)) total += 4;
        if (server.includes(w)) total += 2;
        if (description.toLowerCase().includes(w)) total += 1;
    }
    return total;
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const fault = (text: string): ToolResult => ({ isError: true, text });
