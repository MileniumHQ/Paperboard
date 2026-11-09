import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { parseServer } from "../src/service/mcpConfig";
import { McpServers } from "../src/service/mcpServers";
import { findProgram } from "../src/service/which";
import type { ToolsConfig, ToolsView } from "../src/toolsContract";
import { SLOW, tempDir, TestHost } from "./support/host";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
});

function servers(stored: unknown = null) {
    const root = tempDir("tools");
    const host = new TestHost();
    const vault = new Map<string, string>();
    const writes: ToolsConfig[] = [];
    const views: ToolsView[] = [];
    const s = new McpServers({
        host: { ...host, findProgram },
        store: { read: async () => stored, write: async (c) => void writes.push(structuredClone(c)) },
        vault: {
            get: async (n) => vault.get(n) ?? null,
            set: async (n, v) => void vault.set(n, v),
            delete: async (n) => vault.delete(n),
            list: async () => [...vault.keys()],
        },
        onChange: (v) => views.push(structuredClone(v)),
    });
    cleanups.push(async () => {
        await s.shutdown();
        await host.close();
        fs.rmSync(root, { recursive: true, force: true });
    });
    return { root, host, s, vault, writes, views };
}

function serve(handler: http.RequestListener) {
    const server = http.createServer(handler);
    cleanups.push(() => new Promise<void>((ok) => server.close(() => ok())));
    return new Promise<string>((ok) => server.listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

// Tool-server secrets and config.
describe("tool-server config", () => {
    test("plaintext secrets are refused with a pointer to the vault", () => {
        const stdio = (env: Record<string, unknown>) => ({ name: "gh", transport: "stdio", command: "gh-server", env });
        const http = (url: string, headers: Record<string, unknown> = {}) => ({ name: "web", transport: "http", url, headers });
        for (const raw of [stdio({ GITHUB_TOKEN: "abc" }), stdio({ API_KEY: "abc" }), stdio({ HARMLESS: "ghp_0123456789" }), http("http://127.0.0.1:9/mcp", { Authorization: "Bearer abc" })]) {
            expect(() => parseServer(raw)).toThrow(/looks like a secret. Keep it in the vault/);
        }
        expect(() => parseServer(http("http://me:hunter2@127.0.0.1:9/mcp"))).toThrow(/use a header with a secret instead/);
        expect(() => parseServer(http("http://127.0.0.1:9/mcp?api_key=abc"))).toThrow(/carries "api_key" in plaintext/);
        expect(parseServer(stdio({ GITHUB_TOKEN: { secret: "token" } }))).toMatchObject({ env: { GITHUB_TOKEN: { secret: "token" } } });
    });

    test("unknown keys are refused and a server runs on this computer", () => {
        expect(() => parseServer({ name: "gh", transport: "stdio", command: "gh-server", shell: true })).toThrow('gh: "shell" isn\'t a setting');
        expect(() => parseServer({ name: "web", transport: "http", url: "http://127.0.0.1:9/mcp", proxy: "x" })).toThrow('web: "proxy" isn\'t a setting');
        for (const where of ["vm", "remote", "cloud"]) {
            expect(() => parseServer({ name: "web", where, transport: "http", url: "https://example.com/mcp" })).toThrow('where is "host": a tool server runs on this computer');
        }
        expect(() => parseServer({ name: "gh", transport: "stdio", command: "npx -y server" })).toThrow(/put its arguments in the argument list/);
    });

    test("a secret is stored as mcp.<server>.<name>, injected at start, and never written to tools.json or shown", async () => {
        const { root, s, vault, writes, views } = servers();
        await s.load();
        const program = path.join(root, "whoami-server");
        fs.copyFileSync(path.join(import.meta.dir, "support", "mcpServer.mjs"), program);
        fs.chmodSync(program, 0o755);
        await s.save({ name: "whoami", transport: "stdio", command: program, args: [], env: { MY_TOKEN: { secret: "token" } } });
        await s.setSecret("whoami", "token", "s3cret-value");
        expect([...vault.entries()]).toEqual([["mcp.whoami.token", "s3cret-value"]]);
        await s.warm();
        expect(s.status()).toEqual([{ name: "whoami", phase: "running", error: null, tools: 1 }]);
        expect(await s.callTool("whoami", "whoami", {})).toMatchObject({ text: "token=s3cret-value", isError: false });
        const view = await s.view();
        expect(view.secrets).toEqual({ whoami: ["token"] });
        for (const shown of [JSON.stringify(writes), JSON.stringify(views), JSON.stringify(view)]) expect(shown).not.toContain("s3cret-value");
        expect(writes.at(-1)!.servers[0]).toMatchObject({ env: { MY_TOKEN: { secret: "token" } } });
    }, SLOW);

    test("an unreadable tools.json is reported and never written over", async () => {
        const { s, writes } = servers("not a config");
        await s.load();
        expect((await s.view()).configError).toBe("tools.json isn't a set of settings");
        await expect(s.save({ name: "gh", transport: "stdio", command: "gh-server" })).rejects.toThrow(/tools.json can't be read .* Nothing was changed/);
        await expect(s.setActions(false)).rejects.toThrow(/Nothing was changed/);
        expect(writes).toEqual([]);
    });

    test("over HTTP, a redirect is refused rather than followed with the headers", async () => {
        const reached: http.IncomingHttpHeaders[] = [];
        const elsewhere = await serve((req, res) => {
            reached.push(req.headers);
            res.end("{}");
        });
        const first = await serve((_req, res) => res.writeHead(307, { location: `${elsewhere}/mcp` }).end());
        const { s } = servers();
        await s.load();
        await s.save({ name: "web", transport: "http", url: `${first}/mcp`, headers: { Authorization: { secret: "auth" } } });
        await s.setSecret("web", "auth", "Bearer secret-header");
        await s.warm();
        expect(s.status()[0]!.phase).toBe("failed");
        expect(reached).toEqual([]);
    }, SLOW);
});
