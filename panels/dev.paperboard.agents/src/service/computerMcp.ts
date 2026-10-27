// The agent's tools as an MCP server, served by the AI panel's service.
//
// The agent harness (Codex, Claude Code, OpenCode) runs as a daemon-supervised child
// with its own tools off; this endpoint is its only pair of hands (every
// toolset in toolsets.ts). It speaks
// MCP's streamable HTTP transport in its simplest form: every POST carries
// one JSON-RPC message and gets one JSON reply. It listens on loopback only
// and every request needs this generation's bearer token, which reaches the
// harness through its environment, never its argv.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Toolbox } from "./toolsets";

export const MCP_TOKEN_ENV = "PAPERBOARD_COMPUTER_MCP_TOKEN";
const MAX_BODY = 1 << 20;
// a harness opens a handful of connections; anything past this is not one
const MAX_CONNECTIONS = 16;
const REQUEST_TIMEOUT_MS = 15 * 60_000; // past the longest tool call (a sign-in waits for the user)

export interface ToolResult {
    text: string;
    image?: string;
    /** the image's media type; PNG when not said (the computer's screenshots) */
    imageType?: string;
    isError?: boolean;
}

type Json = Record<string, any>;

export interface ComputerMcp {
    url: string;
    token: string;
    /** called each time a harness has listed the tools: the moment one that connects in the background (OpenCode) has them */
    onToolsListed(cb: () => void): () => void;
    close(): Promise<void>;
}

export async function startComputerMcp(tools: Pick<Toolbox, "list" | "call">): Promise<ComputerMcp> {
    const token = randomBytes(32).toString("hex");
    const expected = Buffer.from(`Bearer ${token}`);
    const listed = new Set<() => void>();
    const authorized = (req: IncomingMessage) => {
        const got = Buffer.from(req.headers.authorization ?? "");
        return got.length === expected.length && timingSafeEqual(got, expected);
    };

    const server: Server = createServer((req, res) => {
        if (!authorized(req)) return reply(res, 401, { error: "unauthorized" });
        if (req.url !== "/mcp") return reply(res, 404, { error: "not found" });
        // no server-initiated stream: every answer rides on its request
        if (req.method !== "POST") return reply(res, 405, { error: "POST only" }, { Allow: "POST" });
        void readBody(req)
            .then(async (raw) => {
                let msg: Json;
                try {
                    msg = JSON.parse(raw);
                } catch (e) {
                    return reply(res, 400, rpcError(null, -32700, `parse error: ${(e as Error).message}`));
                }
                if (Array.isArray(msg) || typeof msg !== "object" || msg === null) {
                    return reply(res, 400, rpcError(null, -32600, "one JSON-RPC message per request"));
                }
                if (msg.id === undefined) return reply(res, 202, null); // a notification
                try {
                    reply(res, 200, { jsonrpc: "2.0", id: msg.id, result: await handle(msg, tools) });
                    if (msg.method === "tools/list") for (const cb of listed) cb();
                } catch (e) {
                    const err = e as Error & { code?: number };
                    reply(res, 200, rpcError(msg.id, err.code ?? -32603, err.message));
                }
            })
            .catch((e: Error) => reply(res, 413, { error: e.message }));
    });
    server.maxConnections = MAX_CONNECTIONS;
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;

    await new Promise<void>((ok, fail) => {
        server.once("error", fail);
        server.listen(0, "127.0.0.1", () => {
            server.off("error", fail);
            ok();
        });
    });
    const { port } = server.address() as AddressInfo;
    return {
        url: `http://127.0.0.1:${port}/mcp`,
        token,
        onToolsListed: (cb) => {
            listed.add(cb);
            return () => listed.delete(cb);
        },
        close: () =>
            new Promise<void>((ok) => {
                listed.clear();
                server.closeAllConnections();
                server.close(() => ok());
            }),
    };
}

async function handle(msg: Json, tools: Pick<Toolbox, "list" | "call">): Promise<Json> {
    const params = (msg.params ?? {}) as Json;
    switch (msg.method) {
        case "initialize":
            return {
                protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: "paperboard", version: "0.1.0" },
            };
        case "ping":
            return {};
        case "tools/list":
            return { tools: await tools.list() };
        case "tools/call": {
            const name = String(params.name ?? "");
            const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
            const r = await tools.call(name, args);
            const content: Json[] = [{ type: "text", text: r.text }];
            if (r.image) content.push({ type: "image", data: r.image, mimeType: r.imageType ?? "image/png" });
            return { content, isError: Boolean(r.isError) };
        }
        default:
            throw Object.assign(new Error(`method not found: ${msg.method}`), { code: -32601 });
    }
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((ok, fail) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (c: Buffer) => {
            size += c.length;
            if (size > MAX_BODY) {
                req.destroy();
                fail(new Error("request too large"));
                return;
            }
            chunks.push(c);
        });
        req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
        req.on("error", fail);
    });
}

function rpcError(id: unknown, code: number, message: string) {
    return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function reply(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    if (res.headersSent) return;
    if (body === null) {
        res.writeHead(status, headers).end();
        return;
    }
    const data = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers }).end(data);
}
