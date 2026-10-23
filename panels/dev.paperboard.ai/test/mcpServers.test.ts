import { afterEach, describe, expect, test } from "bun:test";
import { McpServers, processId, type ServersDeps, type Vault } from "../src/service/mcpServers";
import { DIRECT_MAX, FIND_TOOLS, MAX_FOUND, USE_TOOL, mcpToolset } from "../src/service/mcpToolset";
import { toolbox } from "../src/service/toolsets";
import { COMPUTER_TOOLS } from "../src/service/computerTools";
import { ACTION_TOOLS } from "../src/service/actionsToolset";
import { DEFAULT_TOOLS, type ToolsConfig, type ToolsView } from "../src/toolsContract";
import { FakeMcpProcesses, ECHO_TOOL, answer, fakeHttpServer, fakeServer } from "./fakeMcp";
import { until } from "./fakeHost";
import type { McpTool } from "../src/service/mcpClient";

const stdio = (name: string, o: Record<string, unknown> = {}) => ({ name, transport: "stdio", command: "/usr/bin/server", args: [], ...o });
const toolsNamed = (n: number, prefix = "t", schema: Record<string, unknown> = { type: "object" }): McpTool[] =>
    Array.from({ length: n }, (_, i) => ({ name: `${prefix}${i}`, description: `does thing ${i}`, inputSchema: schema }));

function setup(initial: unknown = null) {
    const procs = new FakeMcpProcesses();
    const secrets = new Map<string, string>();
    const vault: Vault = {
        get: async (n) => secrets.get(n) ?? null,
        set: async (n, v) => void secrets.set(n, v),
        delete: async (n) => secrets.delete(n),
        list: async () => [...secrets.keys()],
    };
    let stored: unknown = initial;
    const writes: ToolsConfig[] = [];
    const views: ToolsView[] = [];
    const guestCalls: { tool: string; args: any }[] = [];
    let ready = true;
    let clock = 1_000_000;
    const guestServer = fakeServer();
    const deps: ServersDeps = {
        host: { start: (o) => procs.start(o), write: (id, d) => procs.write(id, d), kill: procs.kill, exists: procs.exists, onStdout: procs.onStdout, onStderr: procs.onStderr, onExit: procs.onExit, which: (c) => (c === "server" ? "/usr/bin/server" : null) },
        guest: async (tool, args) => {
            guestCalls.push({ tool, args });
            if (tool === "mcp_rpc") return { text: JSON.stringify(answer(guestServer, (args as any).message) ?? {}) };
            return { text: "ok" };
        },
        computerReady: () => ready,
        store: { read: async () => stored, write: async (c) => void (writes.push(c), (stored = c)) },
        vault,
        onChange: (v) => views.push(v),
        now: () => clock,
    };
    const servers = new McpServers(deps);
    return {
        servers, procs, secrets, writes, views, guestCalls,
        get stored() { return stored; },
        setReady: (v: boolean) => (ready = v),
        advance: (ms: number) => (clock += ms),
    };
}

describe("a server's life", () => {
    let t: ReturnType<typeof setup>;
    afterEach(async () => {
        await t.servers.shutdown();
    });

    test("saved, started on warm, listed with its tools, stopped and observed on shutdown", async () => {
        t = setup();
        await t.servers.load();
        await t.servers.save(stdio("files", { command: "server" }));
        expect(t.servers.status()).toEqual([{ name: "files", phase: "stopped", error: null, tools: 0 }]);
        await t.servers.warm();
        expect(t.servers.status()[0]).toMatchObject({ phase: "running", tools: 1 });
        expect(t.procs.started[0]!.id).toBe(processId("files"));
        expect(t.procs.started[0]!.id).toBe("dev.paperboard.ai.mcp.files");
        expect(t.procs.started[0]!.command).toBe("/usr/bin/server"); // resolved, not looked up by the daemon
        await t.servers.shutdown();
        expect(t.procs.alive.size).toBe(0);
        expect(t.procs.listenerCount()).toBe(0);
        // what the UI is told follows
        await until(() => t.views.at(-1) !== undefined);
    });

    test("a program that isn't installed fails with a reason, not a hang", async () => {
        t = setup();
        await t.servers.load();
        await t.servers.save(stdio("files", { command: "missing" }));
        await t.servers.warm();
        expect(t.servers.status()[0]).toMatchObject({ phase: "failed", error: expect.stringContaining('"missing" isn\'t installed') });
        expect(t.procs.started).toHaveLength(0);
    });

    test("a secret comes from the vault into the child's environment; a missing one fails the start by name", async () => {
        t = setup();
        await t.servers.load();
        await t.servers.save(stdio("files", { command: "server", env: { GITHUB_TOKEN: { secret: "gh" }, MODE: "fast" } }));
        await t.servers.warm();
        expect(t.servers.status()[0]).toMatchObject({ phase: "failed", error: expect.stringContaining('"gh" isn\'t saved') });
        await t.servers.setSecret("files", "gh", "s3cret");
        await t.servers.restart("files");
        expect(t.procs.started.at(-1)!.env).toEqual({ GITHUB_TOKEN: "s3cret", MODE: "fast" });
        // the config on disk names the secret and never holds it
        expect(JSON.stringify(t.stored)).not.toContain("s3cret");
        expect([...t.secrets.keys()]).toEqual(["mcp.files.gh"]);
        // the view lists names only
        expect((await t.servers.view()).secrets).toEqual({ files: ["gh"] });
    });

    test("an HTTP secret rides in a header", async () => {
        t = setup();
        await t.servers.load();
        const http = fakeHttpServer(fakeServer());
        try {
            await t.servers.save({ name: "notes", transport: "http", url: http.url, headers: { Authorization: { secret: "key" } } });
            await t.servers.setSecret("notes", "key", "Bearer abc");
            await t.servers.warm();
            expect(t.servers.status()[0]).toMatchObject({ phase: "running" });
            expect(http.seen[0]!.headers.authorization).toBe("Bearer abc");
        } finally {
            await t.servers.shutdown();
            http.stop();
        }
    });

    test("a server that dies is failed with why, and comes back on a later warm, not in a tight loop", async () => {
        t = setup();
        await t.servers.load();
        await t.servers.save(stdio("files", { command: "server" }));
        await t.servers.warm();
        t.procs.exit(processId("files"), 9);
        await until(() => t.servers.status()[0]!.phase === "failed");
        expect(t.servers.status()[0]!.error).toContain("exited (9)");
        await t.servers.warm();
        expect(t.procs.started).toHaveLength(1); // too soon
        t.advance(31_000);
        await t.servers.warm();
        expect(t.procs.started).toHaveLength(2);
        expect(t.servers.status()[0]!.phase).toBe("running");
    });

    test("replacing a server stops the old one first; removing one stops it, forgets it and deletes its secrets", async () => {
        t = setup();
        await t.servers.load();
        await t.servers.save(stdio("files", { command: "server", env: { K: { secret: "k" } } }));
        await t.servers.setSecret("files", "k", "v");
        await t.servers.warm();
        const id = processId("files");
        await t.servers.save(stdio("files", { command: "server", args: ["--other"], env: { K: { secret: "k" } } }));
        expect(t.procs.killed.at(0)!.id).toBe(id);
        expect(t.procs.alive.has(id)).toBe(false);
        expect(t.servers.status()[0]!.phase).toBe("stopped");
        await t.servers.warm();
        expect(t.procs.alive.has(id)).toBe(true);
        await t.servers.remove("files");
        expect(t.procs.alive.has(id)).toBe(false);
        expect(t.servers.status()).toEqual([]);
        expect(t.secrets.size).toBe(0);
        expect((t.stored as ToolsConfig).servers).toEqual([]);
        await expect(t.servers.remove("files")).rejects.toThrow(/no such server/);
    });

    test("a secret still in use can't be deleted", async () => {
        t = setup();
        await t.servers.load();
        await t.servers.save(stdio("files", { env: { K: { secret: "k" } } }));
        await t.servers.setSecret("files", "k", "v");
        await expect(t.servers.deleteSecret("files", "k")).rejects.toThrow(/still uses/);
        await t.servers.setSecret("files", "other", "v");
        await t.servers.deleteSecret("files", "other");
        expect([...t.secrets.keys()]).toEqual(["mcp.files.k"]);
    });

    test("an unreadable tools.json is reported and never written over", async () => {
        t = setup({ servers: [{ name: "x", transport: "stdio", command: "a b" }] });
        await t.servers.load();
        expect(t.servers.configError).toMatch(/arguments/);
        await expect(t.servers.save(stdio("files"))).rejects.toThrow(/can't be read/);
        await expect(t.servers.setActions(false)).rejects.toThrow(/can't be read/);
        expect(t.writes).toHaveLength(0);
        expect((await t.servers.view()).configError).toMatch(/arguments/);
    });

    test("a refused save changes nothing", async () => {
        t = setup();
        await t.servers.load();
        await t.servers.save(stdio("files"));
        await expect(t.servers.save(stdio("files", { command: "a b" }))).rejects.toThrow();
        await expect(t.servers.save(stdio("other", { env: { API_KEY: "plain" } }))).rejects.toThrow(/vault/);
        expect(t.writes).toHaveLength(1);
        expect(t.servers.config.servers.map((s) => s.name)).toEqual(["files"]);
    });

    test("a server inside the computer starts there, and waits while the computer is off", async () => {
        t = setup();
        await t.servers.load();
        await t.servers.save(stdio("inside", { where: "computer", command: "npx", args: ["-y", "pkg"], env: { A: "1" } }));
        t.setReady(false);
        await t.servers.warm();
        expect(t.servers.status()[0]).toMatchObject({ phase: "stopped", error: "its computer isn't running" });
        expect(t.guestCalls).toHaveLength(0);
        t.setReady(true);
        await t.servers.warm();
        expect(t.guestCalls[0]).toEqual({ tool: "mcp_start", args: { id: "inside", argv: ["npx", "-y", "pkg"], env: { A: "1" } } });
        expect(t.servers.status()[0]).toMatchObject({ phase: "running", tools: 1 });
        await t.servers.shutdown();
        expect(t.guestCalls.at(-1)!.tool).toBe("mcp_stop");
        expect(t.procs.started).toHaveLength(0); // never a host process
    });

    test("a disabled server is not started", async () => {
        t = setup();
        await t.servers.load();
        await t.servers.save(stdio("files", { enabled: false }));
        await t.servers.warm();
        expect(t.procs.started).toHaveLength(0);
        await expect(t.servers.restart("files")).rejects.toThrow(/switched off/);
    });
});

describe("the agent isn't overwhelmed", () => {
    let t: ReturnType<typeof setup>;
    afterEach(async () => {
        await t.servers.shutdown();
    });

    async function withTools(perServer: Record<string, McpTool[]>, schema?: Record<string, unknown>) {
        t = setup();
        await t.servers.load();
        let i = 0;
        for (const name of Object.keys(perServer)) await t.servers.save(stdio(name, { command: "server" }));
        // each process id serves its own tools
        t.procs.write = (async (id: string, data: string) => {
            const server = Object.keys(perServer).find((n) => id.endsWith(`.${n}`))!;
            for (const line of data.split("\n").filter(Boolean)) {
                const msg = JSON.parse(line);
                const reply = answer({ tools: perServer[server]!, call: (n, a) => ({ content: [{ type: "text", text: `${server}/${n}:${JSON.stringify(a)}` }] }) }, msg);
                if (reply) queueMicrotask(() => t.procs.stdout(id, JSON.stringify(reply) + "\n"));
            }
        }) as any;
        void i;
        const set = mcpToolset(t.servers);
        return { set, text: async () => await set.instructions!() };
    }

    test("a few tools are offered directly, as server__tool, with their real schemas", async () => {
        const { set, text } = await withTools({ files: toolsNamed(3), notes: toolsNamed(2, "n") });
        // before any turn has looked, search is what's offered
        expect((await set.tools()).map((x) => x.name)).toEqual([FIND_TOOLS, USE_TOOL]);
        const instructions = await text();
        const tools = await set.tools();
        expect(tools.map((x) => x.name)).toEqual(["files__t0", "files__t1", "files__t2", "notes__n0", "notes__n1"]);
        expect(instructions).toContain("files, notes");
        expect(await set.call("files__t1", { a: 1 })).toMatchObject({ text: 'files/t1:{"a":1}', isError: false });
    });

    test("past the limit, two meta tools and a line per server stand in for all of them", async () => {
        const { set, text } = await withTools({ files: toolsNamed(DIRECT_MAX), notes: toolsNamed(1, "n") });
        const instructions = await text();
        expect((await set.tools()).map((x) => x.name)).toEqual([FIND_TOOLS, USE_TOOL]);
        expect(instructions).toContain("files: 12 tools");
        expect(instructions).toContain("notes: 1 tools");
    });

    test("find answers at most MAX_FOUND, best first, and says there are more", async () => {
        const { set, text } = await withTools({ files: [...toolsNamed(30, "read_"), { ...ECHO_TOOL, name: "write_file", description: "write a file" }] });
        await text();
        const r = await set.call(FIND_TOOLS, { query: "read" });
        const found = JSON.parse(r.text);
        expect(found.tools).toHaveLength(MAX_FOUND);
        expect(found.more).toMatch(/20 more/);
        const one = JSON.parse((await set.call(FIND_TOOLS, { query: "write file" })).text);
        expect(one.tools[0]).toMatchObject({ server: "files", tool: "write_file" });
        expect((await set.call(FIND_TOOLS, { query: "zzz" })).text).toBe("No tools match.");
    });

    test("use runs a tool; an unknown server or tool is a tool error, not a crash", async () => {
        const { set, text } = await withTools({ files: toolsNamed(20) });
        await text();
        expect(await set.call(USE_TOOL, { server: "files", tool: "t3", arguments: { x: 1 } })).toMatchObject({ text: 'files/t3:{"x":1}' });
        expect(await set.call(USE_TOOL, { server: "nope", tool: "t3" })).toMatchObject({ isError: true, text: expect.stringContaining("no tool server called nope") });
        expect(await set.call(USE_TOOL, { server: "files", tool: "nope" })).toMatchObject({ isError: true });
        expect(await set.call(USE_TOOL, { server: "files", tool: "t3", arguments: [1] })).toMatchObject({ isError: true });
    });

    test("a schema too big to offer faithfully sends everything through search", async () => {
        const huge = { type: "object", properties: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`field${i}`, { type: "string", description: "x".repeat(30) }])) };
        const { set, text } = await withTools({ files: toolsNamed(2, "t", huge) });
        await text();
        expect((await set.tools()).map((x) => x.name)).toEqual([FIND_TOOLS, USE_TOOL]);
        const found = JSON.parse((await set.call(FIND_TOOLS, { query: "t0" })).text);
        expect(found.tools[0].inputSchema.note).toMatch(/too large/);
    });

    test("a tool name that can't fit sends everything through search", async () => {
        const { set, text } = await withTools({ files: [{ ...ECHO_TOOL, name: "x".repeat(60) }] });
        await text();
        expect((await set.tools()).map((x) => x.name)).toEqual([FIND_TOOLS, USE_TOOL]);
    });

    test("a server that is down is named in the instructions, with why", async () => {
        const { set, text } = await withTools({ files: toolsNamed(1) });
        await text();
        t.procs.start = (async () => {
            throw new Error("spawn failed");
        }) as any;
        await t.servers.save(stdio("broken", { command: "server" }));
        const instructions = await text();
        expect(instructions).toContain("broken is not available");
        expect(instructions).toContain("spawn failed");
        expect((await set.tools()).map((x) => x.name)).toContain("files__t0");
    });

    test("no servers, no tools; and the names never collide with the computer's or the actions'", async () => {
        t = setup();
        await t.servers.load();
        const set = mcpToolset(t.servers);
        expect(await set.tools()).toEqual([]);
        await t.servers.save(stdio("files", { command: "server" }));
        const box = toolbox([{ id: "computer", tools: () => COMPUTER_TOOLS, call: async () => ({ text: "" }) }, { id: "actions", tools: () => ACTION_TOOLS, call: async () => ({ text: "" }) }, set]);
        const names = (await box.list()).map((x) => x.name); // throws if any name is offered twice
        expect(names).toContain(FIND_TOOLS);
        expect(DEFAULT_TOOLS.servers).toEqual([]);
    });
});
