// An MCP client (JSON-RPC 2.0: initialize, tools/list, tools/call) over a
// wire: a stdio child of this computer (daemon-supervised, through the
// panel's process API, mcpStdio.ts), or streamable HTTP and the older SSE
// transport (mcpHttp.ts). A wire carries requests and answers; the client on
// top speaks the protocol.
//
// Everything is bounded: messages, pending requests, time, stderr kept.

import { isImageType, type ToolImage, type ToolResult } from "./computerMcp";

export const PROTOCOL_VERSION = "2025-06-18";
export const MAX_MESSAGE = 4 * 1024 * 1024;
export const MAX_PENDING = 32;
const MAX_TOOLS = 500;
const MAX_PAGES = 10;

export const TIMEOUTS = { initialize: 20_000, list: 15_000, call: 120_000 } as const;

export interface McpTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

/** A way to reach one server. A request resolves with the answer's `result` or rejects with its error. */
export interface McpWire {
    request(method: string, params: unknown, timeoutMs: number): Promise<unknown>;
    notify(method: string, params?: unknown): Promise<void>;
    /** stop it and observe that it stopped */
    close(): Promise<void>;
    /** the wire ended on its own (child exit, relay lost); at most once */
    onEnd(cb: (reason: string) => void): void;
}

export class McpRpcError extends Error {
    constructor(
        message: string,
        readonly code: number,
    ) {
        super(message);
    }
}

// ------------------------------------------------------------- the protocol

export class McpClient {
    serverName = "";
    constructor(private wire: McpWire) {}

    async initialize(): Promise<void> {
        const r = (await this.wire.request(
            "initialize",
            { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "paperboard", version: "0.1.0" } },
            TIMEOUTS.initialize,
        )) as { serverInfo?: { name?: unknown } } | null;
        if (!r || typeof r !== "object") throw new Error("the server answered initialize with nothing");
        if (typeof r.serverInfo?.name === "string") this.serverName = r.serverInfo.name.slice(0, 64);
        await this.wire.notify("notifications/initialized");
    }

    async listTools(): Promise<McpTool[]> {
        const out: McpTool[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
            const r = (await this.wire.request("tools/list", cursor ? { cursor } : {}, TIMEOUTS.list)) as { tools?: unknown; nextCursor?: unknown } | null;
            if (!r || !Array.isArray(r.tools)) throw new Error("the server's tool list isn't a list");
            for (const t of r.tools) {
                if (!t || typeof t !== "object" || typeof (t as any).name !== "string" || !(t as any).name) continue;
                const schema = (t as any).inputSchema;
                out.push({
                    name: String((t as any).name),
                    description: typeof (t as any).description === "string" ? (t as any).description : "",
                    inputSchema: schema && typeof schema === "object" && !Array.isArray(schema) ? schema : { type: "object" },
                });
                if (out.length >= MAX_TOOLS) return out;
            }
            if (typeof r.nextCursor !== "string" || !r.nextCursor) return out;
            cursor = r.nextCursor;
        }
        return out;
    }

    async callTool(name: string, args: Record<string, unknown>, timeoutMs: number = TIMEOUTS.call): Promise<ToolResult> {
        const r = await this.wire.request("tools/call", { name, arguments: args }, timeoutMs);
        return toToolResult(r);
    }

    close() {
        return this.wire.close();
    }
    onEnd(cb: (reason: string) => void) {
        this.wire.onEnd(cb);
    }
}

const MAX_TEXT = 32_000;

/** images one result carries to the agent; a tool returning more names the rest */
export const MAX_IMAGES = 8;

/**
 * An MCP tool result as the agent's tool result. Images it can see (PNG,
 * JPEG, GIF, WebP), sent as image content or as an embedded resource's blob,
 * pass through, up to MAX_IMAGES; any other is named in the text so the agent
 * knows it was there.
 */
export function toToolResult(r: unknown): ToolResult {
    const res = (r ?? {}) as { content?: unknown; isError?: unknown; structuredContent?: unknown };
    const parts: string[] = [];
    const images: ToolImage[] = [];
    const image = (data: string, type: unknown, what: string) => {
        const named = String(type ?? "unnamed").slice(0, 40);
        if (!isImageType(type)) parts.push(`[${what} of type ${named} was returned; only PNG, JPEG, GIF and WebP images can be shown]`);
        else if (images.length >= MAX_IMAGES) parts.push(`[another ${named} image was returned; only ${MAX_IMAGES} images can be shown at once]`);
        else images.push({ data, type });
    };
    if (Array.isArray(res.content)) {
        for (const c of res.content as any[]) {
            if (c?.type === "text" && typeof c.text === "string") parts.push(c.text);
            else if (c?.type === "image" && typeof c.data === "string") image(c.data, c.mimeType, "an image");
            else if (c?.type === "resource" && c.resource) {
                const rs = c.resource;
                const uri = String(rs.uri ?? "").slice(0, 200);
                if (typeof rs.text === "string") parts.push(rs.text);
                else if (typeof rs.blob === "string" && typeof rs.mimeType === "string" && rs.mimeType.startsWith("image/")) image(rs.blob, rs.mimeType, `the image ${uri}`);
                else parts.push(`[resource ${uri}]`);
            } else if (c?.type === "resource_link") parts.push(`[resource ${String(c.uri ?? "").slice(0, 200)}]`);
        }
    }
    if (!parts.length && !images.length && res.structuredContent !== undefined) parts.push(JSON.stringify(res.structuredContent));
    let text = parts.join("\n");
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + `\n… ${text.length - MAX_TEXT} characters cut …`;
    return { text: text || (images.length ? "" : "(the tool returned nothing)"), ...(images.length ? { images } : {}), isError: res.isError === true };
}

/** Text to a daemon-owned child's stdin. The daemon takes at most 64 KiB per write, so it goes in pieces, never splitting a character. */
export async function writeLine(write: (id: string, data: string) => Promise<void>, id: string, text: string): Promise<void> {
    for (let i = 0; i < text.length; ) {
        let end = Math.min(i + 32_768, text.length);
        const c = text.charCodeAt(end - 1);
        if (end < text.length && c >= 0xd800 && c <= 0xdbff) end--;
        await write(id, text.slice(i, end));
        i = end;
    }
}
