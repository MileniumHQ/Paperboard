import { afterEach, describe, expect, test } from "bun:test";
import { GuestWire, HttpWire, McpClient, StdioWire, toToolResult, type GuestCall } from "../src/service/mcpClient";
import { ECHO_TOOL, FakeMcpProcesses, answer, fakeHttpServer, fakeServer } from "./fakeMcp";
import { until } from "./fakeHost";

describe("over a daemon-owned stdio child", () => {
    const procs = new FakeMcpProcesses();
    const open = async (id = "dev.paperboard.ai.mcp.files") => {
        const wire = await StdioWire.start(procs, { id, command: "/usr/bin/server", args: ["--x"], env: { A: "1" } });
        return new McpClient(wire);
    };

    test("initialize, list and call: the protocol and the argv as sent", async () => {
        const client = await open("dev.paperboard.ai.mcp.a");
        await client.initialize();
        expect((await client.listTools()).map((t) => t.name)).toEqual(["echo"]);
        const r = await client.callTool("echo", { text: "hi" });
        expect(r).toEqual({ text: 'echo:{"text":"hi"}', image: undefined, isError: false });
        expect(procs.started.at(-1)).toMatchObject({ command: "/usr/bin/server", args: ["--x"], env: { A: "1" } });
        const methods = procs.written.filter((w) => w.id.endsWith(".a")).map((w) => w.msg.method);
        expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
        await client.close();
        // closed means observed gone, and nothing is left subscribed
        expect(procs.alive.has("dev.paperboard.ai.mcp.a")).toBe(false);
        expect(procs.listenerCount()).toBe(0);
    });

    test("a server that exits during a request fails the request with why, and tells the owner", async () => {
        const id = "dev.paperboard.ai.mcp.b";
        procs.silent.add("tools/call");
        const client = await open(id);
        await client.initialize();
        const ended: string[] = [];
        client.onEnd((r) => ended.push(r));
        const call = client.callTool("echo", { text: "x" });
        await until(() => procs.written.some((w) => w.id === id && w.msg.method === "tools/call"));
        procs.exit(id, 3);
        await expect(call).rejects.toThrow(/exited \(3\)/);
        expect(ended[0]).toMatch(/exited \(3\)/);
        procs.silent.delete("tools/call");
    });

    test("a request the server never answers times out; the others carry on", async () => {
        procs.silent.add("tools/list");
        const client = await open("dev.paperboard.ai.mcp.c");
        await client.initialize();
        const wire = (client as any).wire as StdioWire;
        await expect(wire.request("tools/list", {}, 30)).rejects.toThrow(/didn't answer/);
        procs.silent.delete("tools/list");
        expect((await client.listTools()).length).toBe(1);
        await client.close();
    });

    test("a message past the per-write limit is split without breaking a character", async () => {
        const client = await open("dev.paperboard.ai.mcp.d");
        await client.initialize();
        const text = "😀".repeat(40_000); // 80k UTF-16 units: three writes
        const before = procs.written.length;
        await client.callTool("echo", { text });
        expect(procs.written.length).toBe(before + 1); // reassembled as one message
        expect(procs.written.at(-1)!.msg.params.arguments.text).toBe(text);
        await client.close();
    });

    test("a child that won't stop is killed, and a child that still won't is an error", async () => {
        const slow = new FakeMcpProcesses();
        slow.exitOnKill = false;
        const wire = await StdioWire.start(slow, { id: "dev.paperboard.ai.mcp.e", command: "/x", args: [] });
        const closing = wire.close();
        await until(() => slow.killed.length === 1);
        expect(slow.killed[0]!.signal).toBe("SIGTERM");
        await expect(closing).rejects.toThrow(/didn't stop/);
        expect(slow.killed.map((k) => k.signal)).toEqual(["SIGTERM", "SIGKILL"]);
    }, 10_000);

    test("a copy left from before is killed and observed before the new one starts", async () => {
        const left = new FakeMcpProcesses();
        left.alive.add("dev.paperboard.ai.mcp.f");
        await StdioWire.start(left, { id: "dev.paperboard.ai.mcp.f", command: "/x", args: [] });
        expect(left.killed[0]).toEqual({ id: "dev.paperboard.ai.mcp.f", signal: "SIGKILL" });
        expect(left.started).toHaveLength(1);
    });
});

describe("over streamable HTTP", () => {
    const stops: (() => void)[] = [];
    afterEach(() => {
        for (const s of stops.splice(0)) s();
    });
    const serve = (o: Parameters<typeof fakeHttpServer>[1] = {}) => {
        const s = fakeHttpServer(fakeServer(), o);
        stops.push(s.stop);
        return s;
    };

    test("JSON answers, the session id and the headers (a secret rides in a header, not the URL)", async () => {
        const s = serve({ session: "sess-1" });
        const client = new McpClient(new HttpWire({ url: s.url, headers: { Authorization: "Bearer shh" } }));
        await client.initialize();
        expect((await client.listTools())[0]).toMatchObject({ name: "echo" });
        await client.close();
        const posts = s.seen.filter((r) => r.method === "POST");
        expect(posts[0]!.headers.authorization).toBe("Bearer shh");
        expect(posts[2]!.headers["mcp-session-id"]).toBe("sess-1");
        expect(posts[2]!.headers["mcp-protocol-version"]).toBe("2025-06-18");
        expect(s.seen.at(-1)!.method).toBe("DELETE");
    });

    test("an event stream: the answer is found among other messages", async () => {
        const s = serve({ sse: true });
        const client = new McpClient(new HttpWire({ url: s.url, headers: {} }));
        await client.initialize();
        expect((await client.callTool("echo", { text: "z" })).text).toContain("echo");
    });

    test("an HTTP failure says what the server said; a redirect is refused, not followed with the headers", async () => {
        const bad = serve({ status: 503 });
        const wire = new HttpWire({ url: bad.url, headers: {} });
        await expect(wire.request("tools/list", {}, 2000)).rejects.toThrow(/503: nope/);
        const moved = serve({ redirect: true });
        await expect(new HttpWire({ url: moved.url, headers: { Authorization: "Bearer shh" } }).request("tools/list", {}, 2000)).rejects.toThrow();
    });

    test("an answer past the size limit is cut off, not buffered", async () => {
        const s = serve({ big: 5 * 1024 * 1024 });
        const wire = new HttpWire({ url: s.url, headers: {} });
        await expect(wire.request("tools/call", { name: "echo", arguments: {} }, 5000)).rejects.toThrow(/size limit/);
    });

    test("a server that doesn't answer in time fails the request", async () => {
        const hang = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Promise<Response>(() => {}) });
        stops.push(() => hang.stop(true));
        const wire = new HttpWire({ url: `http://127.0.0.1:${hang.port}/`, headers: {} });
        await expect(wire.request("initialize", {}, 50)).rejects.toThrow(/didn't answer/);
    });
});

describe("through the guest agent's relay", () => {
    function relay(): { call: GuestCall; calls: { tool: string; args: any }[] } {
        const calls: { tool: string; args: any }[] = [];
        const server = fakeServer();
        const call: GuestCall = async (tool, args) => {
            calls.push({ tool, args });
            if (tool === "mcp_rpc") {
                const reply = answer(server, (args as any).message);
                return { text: JSON.stringify(reply ?? {}) };
            }
            return { text: "ok" };
        };
        return { call, calls };
    }

    test("start by argv, relay messages, stop", async () => {
        const { call, calls } = relay();
        const wire = await GuestWire.start(call, { id: "files", argv: ["npx", "-y", "pkg"], env: { A: "1" } });
        const client = new McpClient(wire);
        await client.initialize();
        expect((await client.listTools()).map((t) => t.name)).toEqual([ECHO_TOOL.name]);
        await client.close();
        expect(calls[0]).toEqual({ tool: "mcp_start", args: { id: "files", argv: ["npx", "-y", "pkg"], env: { A: "1" } } });
        expect(calls.at(-1)!.tool).toBe("mcp_stop");
    });

    test("a guest that lost the server ends the wire; a guest that refuses start is the start's failure", async () => {
        const call: GuestCall = async (tool) => (tool === "mcp_start" ? { text: "started" } : { isError: true, text: "no such server" });
        const wire = await GuestWire.start(call, { id: "files", argv: ["x"], env: {} });
        const ended: string[] = [];
        wire.onEnd((r) => ended.push(r));
        await expect(wire.request("tools/list", {}, 1000)).rejects.toThrow(/no such server/);
        expect(ended).toEqual(["no such server"]);
        await expect(GuestWire.start(async () => ({ isError: true, text: "Your computer is off right now." }), { id: "x", argv: ["x"], env: {} })).rejects.toThrow(/off right now/);
    });
});

describe("tool results", () => {
    test("text, one PNG, other images named, errors flagged, size bounded", () => {
        expect(toToolResult({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }).text).toBe("a\nb");
        const png = toToolResult({ content: [{ type: "image", data: "AAAA", mimeType: "image/png" }] });
        expect(png.image).toBe("AAAA");
        expect(toToolResult({ content: [{ type: "image", data: "AAAA", mimeType: "image/jpeg" }] }).text).toContain("image/jpeg");
        expect(toToolResult({ content: [{ type: "text", text: "bad" }], isError: true }).isError).toBe(true);
        expect(toToolResult({ content: [{ type: "text", text: "x".repeat(40_000) }] }).text.length).toBeLessThan(33_000);
        expect(toToolResult({ structuredContent: { n: 1 } }).text).toBe('{"n":1}');
    });
});
