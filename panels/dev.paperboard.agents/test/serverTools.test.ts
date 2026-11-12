import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { PromptEntry, ToolServerEntry, ToolSignInEntry } from "../src/contract";
import { checkSecretName } from "../src/service/mcpConfig";
import { McpServers } from "../src/service/mcpServers";
import { Prompts } from "../src/service/prompts";
import { ServerTools } from "../src/service/serverTools";
import { findProgram } from "../src/service/which";
import type { ToolsConfig } from "../src/toolsContract";
import { SLOW, tempDir, TestHost } from "./support/host";

const KEY = "lin_api_correct-horse-battery-staple";
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
});

/** The agent's tool servers as the service has them: real servers, a real vault-shaped store, the cards it posts and what it's told. */
function rig() {
    const root = tempDir("server-tools");
    const host = new TestHost();
    const vault = new Map<string, string>();
    const writes: ToolsConfig[] = [];
    const posted: (ToolServerEntry | ToolSignInEntry | PromptEntry)[] = [];
    const notices: string[] = [];
    const results: string[] = [];
    let tools: ServerTools | null = null;
    const servers = new McpServers({
        host: { ...host, findProgram },
        store: { read: async () => null, write: async (c) => void writes.push(structuredClone(c)) },
        vault: {
            get: async (n) => vault.get(n) ?? null,
            set: async (n, v) => void vault.set(n, v),
            delete: async (n) => vault.delete(n),
            list: async () => [...vault.keys()],
        },
        onChange: (v) => tools?.seen(v),
    });
    tools = new ServerTools({ servers, findProgram, post: (e) => posted.push(structuredClone(e)), notice: (t) => notices.push(t), startMs: 10_000 });
    const prompts = new Prompts({
        hasServer: (s) => servers.config.servers.some((x) => x.name === s),
        checkSecretName,
        saveSecret: (server, name, value) => servers.setSecret(server, name, value),
        post: (e) => posted.push(structuredClone(e)),
        notice: (t) => notices.push(t),
    });
    const set = tools.toolset();
    const call = async (name: string, args: Record<string, unknown> = {}, fromFlow = false) => {
        const r = await set.call(name, args, { fromFlow });
        results.push(r.text);
        return r;
    };
    cleanups.push(async () => {
        tools!.shutdown();
        await servers.shutdown();
        await host.close();
        fs.rmSync(root, { recursive: true, force: true });
    });
    const program = () => {
        const p = path.join(root, "whoami-server");
        fs.copyFileSync(path.join(import.meta.dir, "support", "mcpServer.mjs"), p);
        fs.chmodSync(p, 0o755);
        return p;
    };
    const card = <K extends string>(kind: K) => posted.filter((e) => e.kind === kind).at(-1) as Extract<ToolServerEntry | ToolSignInEntry | PromptEntry, { kind: K }> | undefined;
    return { root, servers, tools, prompts, set, call, vault, writes, posted, notices, results, program, card };
}

/** An MCP server over HTTP with one tool, echo. With a `bearer`, it lets in only that Authorization. */
async function mcpOverHttp(o: { bearer?: () => string } = {}) {
    const seen: (string | undefined)[] = [];
    const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
            seen.push(req.headers.authorization);
            if (o.bearer && req.headers.authorization !== `Bearer ${o.bearer()}`) return void res.writeHead(401).end();
            const m = JSON.parse(body);
            if (m.id === undefined) return void res.writeHead(202).end();
            const result =
                m.method === "initialize"
                    ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "echo" } }
                    : m.method === "tools/list"
                      ? { tools: [{ name: "echo", description: "echo", inputSchema: { type: "object" } }] }
                      : { content: [{ type: "text", text: "hi" }] };
            res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
        });
    });
    cleanups.push(() => new Promise<void>((ok) => server.close(() => ok())));
    const base = await new Promise<string>((ok) => server.listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
    return { url: `${base}/mcp`, seen };
}

async function until(check: () => boolean, what: string) {
    for (let i = 0; i < 500 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
    if (!check()) throw new Error(`timed out waiting for ${what}`);
}

// The agent adding its own tool servers when the user asks: what it can do alone, and what waits for the user.
describe("the agent's own tool servers", () => {
    test("it adds a web server, changes it and removes it, and hears how each went", async () => {
        const echo = await mcpOverHttp();
        const r = rig();
        await r.servers.load();

        const added = await r.call("add_tool_server", { name: "echo", url: echo.url });
        expect(added.isError).toBeFalsy();
        expect(added.text).toContain("Added echo. It's running with 1 tool: echo.");
        expect(r.writes.at(-1)!.servers).toEqual([{ name: "echo", where: "host", transport: "http", url: echo.url, headers: {}, oauth: false, sse: false, enabled: true }]);
        expect((await r.call("add_tool_server", { name: "echo", url: echo.url })).text).toContain("already have a tool server called");
        // settings for the other kind of server are refused, not dropped
        expect((await r.call("update_tool_server", { name: "echo", env: { A: "b" } })).text).toContain('"env" is for a program');

        expect((await r.call("update_tool_server", { name: "echo", enabled: false })).text).toBe("Changed echo. It's switched off.");
        expect(r.servers.config.servers[0]).toMatchObject({ enabled: false, url: echo.url });
        expect((await r.call("update_tool_server", { name: "echo", enabled: true, headers: { "X-Team": "acme" } })).text).toContain("It's running with 1 tool");
        expect(r.servers.config.servers[0]).toMatchObject({ enabled: true, url: echo.url, headers: { "X-Team": "acme" } });

        expect(JSON.parse((await r.call("list_tool_servers")).text).servers).toEqual([
            { name: "echo", url: echo.url, headers: { "X-Team": "acme" }, oauth: false, enabled: true, status: "running, 1 tools" },
        ]);

        expect((await r.call("remove_tool_server", { name: "echo" })).text).toContain("Removed echo.");
        expect(r.writes.at(-1)!.servers).toEqual([]);
        expect((await r.call("remove_tool_server", { name: "echo" })).text).toContain('no tool server called "echo"');
        // nothing about a web server needed the user's say-so
        expect(r.posted).toEqual([]);
    }, SLOW);

    test("a key goes in as a secret's name and through ask_user, and never reaches the agent", async () => {
        const keyed = await mcpOverHttp({ bearer: () => KEY });
        const r = rig();
        await r.servers.load();

        // a key written into the config is refused
        expect((await r.call("add_tool_server", { name: "linear", url: keyed.url, headers: { Authorization: `Bearer ${KEY}` } })).text).toContain("looks like a secret");
        const added = await r.call("add_tool_server", { name: "linear", url: keyed.url, headers: { Authorization: { secret: "api-key" } } });
        expect(added.text).toContain('It needs "api-key" before it can start: ask the user with ask_user');
        // it wasn't started without its key
        expect(keyed.seen).toEqual([]);

        const asked = await r.prompts.toolset().call(
            "ask_user",
            { title: "Connect Linear", reason: "To read your issues.", fields: [{ label: "API key", secret: { server: "linear", name: "api-key", prefix: "Bearer " } }] },
            { fromFlow: false },
        );
        expect(asked.isError).toBeFalsy();
        // the user types just the key; the header gets the whole value
        await r.prompts.answer(r.card("prompt")!.id, [KEY]);
        expect(r.vault.get("mcp.linear.api-key")).toBe(`Bearer ${KEY}`);

        await r.servers.warm();
        expect(r.servers.status()[0]).toMatchObject({ phase: "running", tools: 1 });
        const listed = JSON.parse((await r.call("list_tool_servers")).text).servers[0];
        expect(listed.headers).toEqual({ Authorization: { secret: "api-key", saved: true } });
        // every word the agent was given: tool results, notices, cards, and the config
        expect(JSON.stringify([r.results, r.notices, r.posted, r.writes])).not.toContain(KEY);
    }, SLOW);

    test("a program waits for the user to allow it on a card, and so does a change to what it runs", async () => {
        const r = rig();
        await r.servers.load();
        const command = r.program();
        const add = { name: "whoami", command, env: { MY_TOKEN: { secret: "token" }, MODE: "test" }, reason: "It tells me who I am." };

        expect((await r.call("add_tool_server", { ...add, reason: undefined })).text).toContain("give a reason");
        expect((await r.call("add_tool_server", { ...add, command: "no-such-program-anywhere" })).text).toContain("isn't installed on the user's computer");
        expect(r.posted).toEqual([]);

        // asked, and said no: nothing is saved and nothing runs
        expect((await r.call("add_tool_server", add)).text).toContain("nothing runs until they do");
        expect(r.card("tool-server")).toMatchObject({ server: "whoami", change: false, command: [command], env: [{ name: "MY_TOKEN", value: null }, { name: "MODE", value: "test" }], status: "waiting" });
        expect(r.writes).toEqual([]);
        await r.tools.answer(r.card("tool-server")!.id, false);
        expect(r.card("tool-server")!.status).toBe("declined");
        expect(r.notices.at(-1)).toContain("said no to running whoami");
        expect(r.servers.config.servers).toEqual([]);
        await expect(r.tools.answer(r.card("tool-server")!.id, true)).rejects.toThrow("isn't waiting anymore");

        // asked again, and allowed: it's saved, and the agent hears it needs its key
        await r.call("add_tool_server", add);
        await r.tools.answer(r.card("tool-server")!.id, true);
        expect(r.card("tool-server")!.status).toBe("allowed");
        expect(r.servers.config.servers[0]).toMatchObject({ name: "whoami", transport: "stdio", command, args: [] });
        await until(() => r.notices.some((n) => n.includes("allowed whoami")), "the agent to be told");
        expect(r.notices.at(-1)).toContain('It needs "token" before it can start');

        // switching it off runs nothing new: no card
        const cards = r.posted.length;
        expect((await r.call("update_tool_server", { name: "whoami", enabled: false })).text).toBe("Changed whoami. It's switched off.");
        expect(r.posted.length).toBe(cards);
        // a change to what it runs is asked for, and the old one stays until it's allowed
        expect((await r.call("update_tool_server", { name: "whoami", args: ["--verbose"], reason: "A louder whoami." })).text).toContain("nothing runs until they do");
        expect(r.card("tool-server")).toMatchObject({ change: true, command: [command, "--verbose"], status: "waiting" });
        expect(r.servers.config.servers[0]).toMatchObject({ args: [] });
        await r.tools.answer(r.card("tool-server")!.id, true);
        expect(r.servers.config.servers[0]).toMatchObject({ args: ["--verbose"], enabled: false });

        // a flow has no one to allow anything: it can only look
        expect((await r.set.tools({ fromFlow: true })).map((t) => t.name)).toEqual(["list_tool_servers"]);
    }, SLOW);

    test("an allowed program starts, and the agent is told its tools", async () => {
        const r = rig();
        await r.servers.load();
        await r.call("add_tool_server", { name: "whoami", command: r.program(), reason: "It tells me who I am." });
        await r.tools.answer(r.card("tool-server")!.id, true);
        await until(() => r.notices.some((n) => n.includes("allowed whoami")), "the agent to be told");
        expect(r.notices.at(-1)).toContain("It's running with 1 tool: whoami.");
        expect(r.servers.status()[0]).toMatchObject({ phase: "running" });
    }, SLOW);

    test("a server that signs the user in gets a card in the chat, and the agent hears when it's up", async () => {
        let token = "nobody-has-this";
        const web = await mcpOverHttp({ bearer: () => token });
        const r = rig();
        await r.servers.load();

        const added = await r.call("add_tool_server", { name: "web", url: web.url, oauth: true });
        expect(added.text).toContain("The user has to sign in to it: they do on a card in the chat");
        expect(r.card("tool-sign-in")).toMatchObject({ server: "web", url: web.url });
        expect(JSON.parse((await r.call("list_tool_servers")).text).servers[0]).toMatchObject({ oauth: true, signedIn: false, status: expect.stringContaining("needs the user to sign in") });

        // the user signs in (the sign-in itself is tested with the tool servers): the server comes up with its tokens
        token = "a1";
        r.vault.set("mcp.web.oauth", JSON.stringify({ access: "a1", type: "Bearer", refresh: null, expiresAt: null, clientId: "c", clientSecret: null, tokenEndpoint: `${web.url}/token`, clientAuth: "none", resource: web.url }));
        await r.servers.restart("web");
        await until(() => r.notices.some((n) => n.includes("signed in to web")), "the agent to be told");
        expect(r.notices.at(-1)).toContain("It's running with 1 tool: echo.");
        // told once
        await r.servers.restart("web");
        expect(r.notices.filter((n) => n.includes("signed in to web")).length).toBe(1);
        // nothing to sign in to now
        expect((await r.call("ask_tool_server_sign_in", { name: "web" })).text).toContain("doesn't need the user to sign in");
    }, SLOW);
});
