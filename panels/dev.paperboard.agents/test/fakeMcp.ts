// Stand-ins for MCP servers: a stdio child driven through the fake process
// host, and a streamable-HTTP server on loopback.

import type { McpTool } from "../src/service/mcpClient";
import { FakeProcesses } from "./fakeHost";

export const ECHO_TOOL: McpTool = {
    name: "echo",
    description: "Echo the text back.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};

export interface FakeServer {
    tools: McpTool[];
    /** the answer to tools/call */
    call(name: string, args: Record<string, unknown>): unknown;
}

export const fakeServer = (tools: McpTool[] = [ECHO_TOOL]): FakeServer => ({
    tools,
    call: (name, args) => ({ content: [{ type: "text", text: `${name}:${JSON.stringify(args)}` }] }),
});

/** A server's reply to one JSON-RPC request, or undefined for a notification. */
export function answer(server: FakeServer, msg: any): unknown {
    if (msg.id === undefined) return undefined;
    switch (msg.method) {
        case "initialize":
            return { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake" } } };
        case "tools/list":
            return { jsonrpc: "2.0", id: msg.id, result: { tools: server.tools } };
        case "tools/call":
            return { jsonrpc: "2.0", id: msg.id, result: server.call(msg.params.name, msg.params.arguments) };
        default:
            return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `no ${msg.method}` } };
    }
}

/** Processes that speak MCP on stdin/stdout. */
export class FakeMcpProcesses extends FakeProcesses {
    server = fakeServer();
    /** every message written, by process id */
    written: { id: string; msg: any; raw: string }[] = [];
    /** don't answer requests with these methods */
    silent = new Set<string>();
    private partial = new Map<string, string>();

    write = async (id: string, data: string) => {
        const buf = (this.partial.get(id) ?? "") + data;
        const lines = buf.split("\n");
        this.partial.set(id, lines.pop()!);
        for (const line of lines) {
            if (!line.trim()) continue;
            const msg = JSON.parse(line);
            this.written.push({ id, msg, raw: line });
            if (this.silent.has(msg.method)) continue;
            const reply = answer(this.server, msg);
            if (reply) queueMicrotask(() => this.stdout(id, JSON.stringify(reply) + "\n"));
        }
    };
}

/** A streamable-HTTP MCP server on loopback. */
export function fakeHttpServer(server: FakeServer, opts: { sse?: boolean; session?: string; status?: number; redirect?: boolean; big?: number } = {}) {
    const seen: { method: string; headers: Record<string, string>; body: any }[] = [];
    const http = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
            const headers = Object.fromEntries(req.headers.entries());
            const body = req.method === "POST" ? await req.json() : null;
            seen.push({ method: req.method, headers, body });
            if (req.method === "DELETE") return new Response(null, { status: 200 });
            if (opts.redirect) return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1:1/elsewhere" } });
            if (opts.status) return new Response("nope, " + "x".repeat(2000), { status: opts.status });
            const reply = answer(server, body) as any;
            if (!reply) return new Response(null, { status: 202 });
            if (opts.big) reply.result = { content: [{ type: "text", text: "y".repeat(opts.big) }] };
            const extra: Record<string, string> = opts.session && body.method === "initialize" ? { "Mcp-Session-Id": opts.session } : {};
            if (opts.sse) {
                const progress = { jsonrpc: "2.0", method: "notifications/progress", params: {} };
                const text = `event: message\ndata: ${JSON.stringify(progress)}\n\nevent: message\ndata: ${JSON.stringify(reply)}\n\n`;
                return new Response(text, { headers: { "Content-Type": "text/event-stream", ...extra } });
            }
            return Response.json(reply, { headers: extra });
        },
    });
    return { url: `http://127.0.0.1:${http.port}/mcp`, seen, stop: () => http.stop(true) };
}
