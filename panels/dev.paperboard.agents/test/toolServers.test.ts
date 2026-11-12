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
        expect(s.status()).toEqual([{ name: "whoami", phase: "running", needsSignIn: false, error: null, tools: 1 }]);
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

// Signing in to a web server (OAuth) and the older SSE transport, against real servers on loopback.
describe("signing in to a tool server", () => {
    /** an MCP server that wants a bearer token, and its own authorization server */
    async function oauthServer(o: { refuseRegistration?: boolean; secretOnly?: boolean } = {}) {
        const st = { valid: "a1", issued: 0, registered: [] as string[], challenge: "", refreshes: 0, resource: "", asked: "", secretSeen: false };
        let base = "";
        const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
            res.writeHead(status, { "Content-Type": "application/json", ...headers });
            res.end(JSON.stringify(body));
        };
        const read = (req: http.IncomingMessage) => new Promise<string>((ok) => {
            let b = "";
            req.on("data", (c) => (b += c));
            req.on("end", () => ok(b));
        });
        base = await serve(async (req, res) => {
            const url = new URL(req.url!, base);
            if (url.pathname === "/.well-known/oauth-protected-resource/mcp") return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [`${base}/as`] });
            if (url.pathname === "/.well-known/oauth-authorization-server/as") {
                return json(res, 200, {
                    issuer: `${base}/as`,
                    authorization_endpoint: `${base}/as/authorize`,
                    token_endpoint: `${base}/as/token`,
                    registration_endpoint: `${base}/as/register`,
                    code_challenge_methods_supported: ["S256"],
                    ...(o.secretOnly ? { token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"] } : {}),
                });
            }
            if (url.pathname === "/as/register") {
                if (o.refuseRegistration) return void res.writeHead(403).end();
                const body = JSON.parse(await read(req));
                st.registered.push(...body.redirect_uris);
                st.asked = body.token_endpoint_auth_method;
                if (o.secretOnly) return json(res, 201, { client_id: "paperboard-1", client_secret: "shh", token_endpoint_auth_method: "client_secret_post" });
                return json(res, 201, { client_id: "paperboard-1", token_endpoint_auth_method: "none" });
            }
            if (url.pathname === "/as/authorize") {
                st.challenge = url.searchParams.get("code_challenge")!;
                st.resource = url.searchParams.get("resource")!;
                const back = new URL(url.searchParams.get("redirect_uri")!);
                back.searchParams.set("code", "the-code");
                back.searchParams.set("state", url.searchParams.get("state")!);
                res.writeHead(302, { Location: back.href }).end();
                return;
            }
            if (url.pathname === "/as/token") {
                const p = new URLSearchParams(await read(req));
                if (o.secretOnly && p.get("client_secret") !== "shh") return json(res, 401, { error: "invalid_client" });
                st.secretSeen ||= p.get("client_secret") === "shh";
                if (p.get("grant_type") === "authorization_code") {
                    const hash = (await import("node:crypto")).createHash("sha256").update(p.get("code_verifier")!).digest("base64url");
                    if (p.get("code") !== "the-code" || hash !== st.challenge || p.get("client_id") !== "paperboard-1") return json(res, 400, { error: "invalid_grant" });
                    st.issued++;
                    return json(res, 200, { access_token: st.valid, token_type: "bearer", refresh_token: "r1", expires_in: 3600 });
                }
                if (p.get("grant_type") === "refresh_token" && p.get("refresh_token") === "r1") {
                    st.refreshes++;
                    return json(res, 200, { access_token: st.valid, token_type: "Bearer", expires_in: 3600 });
                }
                return json(res, 400, { error: "invalid_grant" });
            }
            if (url.pathname === "/mcp") {
                if (req.headers.authorization !== `Bearer ${st.valid}`) {
                    res.writeHead(401, { "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` }).end();
                    return;
                }
                const m = JSON.parse(await read(req));
                if (m.id === undefined) return void res.writeHead(202).end();
                if (m.method === "initialize") return json(res, 200, { jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake" } } });
                if (m.method === "tools/list") return json(res, 200, { jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "echo", description: "echo", inputSchema: { type: "object" } }] } });
                return json(res, 200, { jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "hi" }] } });
            }
            res.writeHead(404).end();
        });
        return { base, st };
    }

    /** the user's browser: follows the sign-in page's redirect to wherever it sends it */
    async function browse(url: string) {
        const r = await fetch(url, { redirect: "manual" });
        return r.headers.get("location")!;
    }

    async function until(check: () => boolean) {
        for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
        expect(check()).toBe(true);
    }

    test("a server that answers 401 is signed in to with PKCE, and its tokens live only in the vault", async () => {
        const { base, st } = await oauthServer();
        const { s, vault, writes } = servers();
        await s.save({ name: "web", transport: "http", url: `${base}/mcp` });
        await s.warm();
        expect(s.status()[0]).toMatchObject({ phase: "failed", needsSignIn: true });

        const view = await s.signIn("web");
        const pending = view.signIns.web!;
        expect(st.registered).toEqual([pending.callback]);
        expect(pending.callback).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
        // the browser comes back to the service's own loopback listener
        const back = await browse(pending.url);
        const page = await fetch(back);
        expect(page.status).toBe(200);
        await until(() => s.status()[0]!.phase === "running");

        expect(st.resource).toBe(`${base}/mcp`);
        expect(s.status()[0]).toEqual({ name: "web", phase: "running", needsSignIn: false, error: null, tools: 1 });
        expect(JSON.parse(vault.get("mcp.web.oauth")!)).toMatchObject({ access: "a1", refresh: "r1", clientId: "paperboard-1" });
        expect(JSON.stringify(writes)).not.toContain("a1");
        expect(writes.at(-1)!.servers[0]).toMatchObject({ oauth: true });
        expect((await s.view()).signIns).toEqual({});

        // a token the server stops accepting is renewed with the refresh token, once
        st.valid = "a2";
        await s.restart("web");
        expect(s.status()[0]!.phase).toBe("running");
        expect(st.refreshes).toBe(1);
        expect(JSON.parse(vault.get("mcp.web.oauth")!)).toMatchObject({ access: "a2", refresh: "r1" });

        // removing it takes its tokens with it
        await s.remove("web");
        expect(vault.has("mcp.web.oauth")).toBe(false);
    });

    test("an address from another sign-in, or with no code, is refused", async () => {
        const { base } = await oauthServer();
        const { s } = servers();
        await s.save({ name: "web", transport: "http", url: `${base}/mcp`, oauth: true });
        const pending = (await s.signIn("web")).signIns.web!;
        await expect(s.finishSignIn("web", `${pending.callback}?code=x&state=wrong`)).rejects.toThrow(/different sign-in/);
        await expect(s.finishSignIn("web", `http://127.0.0.1:1/elsewhere?code=x`)).rejects.toThrow(/isn't the address/);
        const state = new URL(pending.url).searchParams.get("state");
        await expect(s.finishSignIn("web", `${pending.callback}?error=access_denied&state=${state}`)).rejects.toThrow(/refused: access_denied/);
        expect((await s.view()).signIns.web!.error).toMatch(/refused/);
    });

    test("a sign-in caught on another device is handed over and finishes the same", async () => {
        const { base } = await oauthServer();
        const { s, vault } = servers();
        await s.save({ name: "web", transport: "http", url: `${base}/mcp`, oauth: true });
        const pending = (await s.signIn("web")).signIns.web!;
        await s.finishSignIn("web", await browse(pending.url));
        expect(vault.has("mcp.web.oauth")).toBe(true);
        expect(s.status()[0]!.phase).toBe("running");
    });

    test("a server that only lets in apps it approved says so; one that wants a client secret gets one", async () => {
        const refused = await oauthServer({ refuseRegistration: true });
        const a = servers();
        await a.s.save({ name: "closed", transport: "http", url: `${refused.base}/mcp`, oauth: true });
        await expect(a.s.signIn("closed")).rejects.toThrow(/only lets apps it has approved sign in/);

        const secretOnly = await oauthServer({ secretOnly: true });
        const b = servers();
        await b.s.save({ name: "web", transport: "http", url: `${secretOnly.base}/mcp`, oauth: true });
        const pending = (await b.s.signIn("web")).signIns.web!;
        expect(secretOnly.st.asked).toBe("client_secret_post");
        await b.s.finishSignIn("web", await browse(pending.url));
        expect(secretOnly.st.secretSeen).toBe(true);
        expect(b.s.status()[0]!.phase).toBe("running");
    });

    test("the older SSE transport: messages go to the address the stream names, answers come on the stream", async () => {
        const streams = new Set<http.ServerResponse>();
        let base = "";
        base = await serve((req, res) => {
            const url = new URL(req.url!, base);
            if (req.method === "GET" && url.pathname === "/sse") {
                res.writeHead(200, { "Content-Type": "text/event-stream" });
                res.write("event: endpoint\ndata: /messages?session=1\n\n");
                streams.add(res);
                req.on("close", () => streams.delete(res));
                return;
            }
            if (req.method === "POST" && url.pathname === "/messages") {
                let b = "";
                req.on("data", (c) => (b += c));
                req.on("end", () => {
                    res.writeHead(202).end();
                    const m = JSON.parse(b);
                    if (m.id === undefined) return;
                    const result = m.method === "initialize" ? { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "old" } } : { tools: [{ name: "a", inputSchema: { type: "object" } }, { name: "b", inputSchema: { type: "object" } }] };
                    for (const s of streams) s.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result })}\n\n`);
                });
                return;
            }
            res.writeHead(404).end();
        });
        cleanups.push(() => {
            for (const s of streams) s.destroy();
        });
        const { s } = servers();
        await s.save({ name: "old", transport: "http", url: `${base}/sse`, sse: true });
        await s.warm();
        expect(s.status()[0]).toMatchObject({ phase: "running", tools: 2 });
    });
});
