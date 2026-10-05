// browser-mode host (bun test): real HTTP against startBrowserHost on a
// loopback port. Browser mode is a DEV TOOL with no sign-in: the shell,
// panels and events are served to any loopback client. What still holds is
// the Host check (DNS rebinding), the loopback-alias redirect, the shell
// bridge's exact-Origin + JSON checks, and the bounded event streams.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as http from "http";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import {
    startBrowserHost,
    type BrowserHost,
    BROWSER_HOST_SUFFIX,
    MAX_EVENT_BACKLOG_BYTES,
    MAX_EVENT_CLIENTS,
} from "../src/main/browserHost";

interface Reply {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: string;
}

let host: BrowserHost;
let rendererDir = "";
const panelCalls: Array<[string, string, string]> = [];
const sends: unknown[][] = [];

function request(
    pathname: string,
    opts: { host?: string; method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                host: "127.0.0.1",
                port: host.port,
                path: pathname,
                method: opts.method ?? "GET",
                headers: { host: opts.host ?? `${BROWSER_HOST_SUFFIX}:${host.port}`, ...opts.headers },
            },
            (res) => {
                let body = "";
                res.setEncoding("utf8");
                res.on("data", (c) => (body += c));
                res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
            },
        );
        req.on("error", reject);
        if (opts.body) req.write(opts.body);
        req.end();
    });
}

function bridge(channel: string, args: unknown[], origin = host.origin, kind = "invoke") {
    return request(`/_shell/${kind}/${channel}`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ args }),
    });
}

beforeAll(async () => {
    rendererDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-browserhost-"));
    fs.writeFileSync(path.join(rendererDir, "index.html"), "<html>shell</html>");
    fs.mkdirSync(path.join(rendererDir, "assets"));
    fs.writeFileSync(path.join(rendererDir, "assets", "app.js"), "console.log('shell')");
    host = await startBrowserHost({
        port: 0,
        rendererDir,
        invoke: {
            echo: (args) => ({ echoed: args }),
            fails: () => {
                throw new Error("CRANE_NOT_READY");
            },
        },
        send: { note: (...args) => void sends.push(args) },
        servePanel: async (comp, panelId, pathname) => {
            panelCalls.push([comp, panelId, pathname]);
            return new Response("<html>panel</html>", {
                headers: { "Content-Type": "text/html", "Content-Security-Policy": "script-src 'self'" },
            });
        },
    });
});

afterAll(async () => {
    await host.close();
    fs.rmSync(rendererDir, { recursive: true, force: true });
});

describe("shell is served without sign-in", () => {
    it("serves the renderer document and assets directly", async () => {
        const index = await request("/");
        expect(index.status).toBe(200);
        expect(index.body).toBe("<html>shell</html>");
        expect(index.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
        const asset = await request("/assets/app.js");
        expect(asset.body).toContain("shell");
        const escape = await request("/..%2f..%2fetc%2fpasswd");
        expect([403, 404]).toContain(escape.status);
    });
});

describe("host header", () => {
    it("refuses names that are not ours (DNS rebinding)", async () => {
        for (const name of [`attacker.example:${host.port}`, `${BROWSER_HOST_SUFFIX}.evil.io:${host.port}`]) {
            expect((await request("/", { host: name })).status).toBe(421);
        }
    });

    it("redirects loopback aliases to the canonical origin", async () => {
        // an SSH -L tunnel (or someone told only the port) arrives as
        // localhost/127.0.0.1; send them to the origin the panel subdomains
        // hang off, preserving the path
        for (const name of [`localhost:${host.port}`, `127.0.0.1:${host.port}`, `[::1]:${host.port}`]) {
            const res = await request("/some/path?x=1", { host: name });
            expect(res.status).toBe(302);
            expect(res.headers.location).toBe(
                `http://${BROWSER_HOST_SUFFIX}:${host.port}/some/path?x=1`,
            );
        }
    });
});

describe("shell bridge", () => {
    it("answers the shell origin", async () => {
        const res = await bridge("echo", [{ id: "local" }]);
        expect(JSON.parse(res.body)).toEqual({ ok: true, result: { echoed: { id: "local" } } });
    });

    it("carries handler failures as failures", async () => {
        const res = await bridge("fails", []);
        expect(JSON.parse(res.body)).toEqual({ ok: false, error: "CRANE_NOT_READY" });
    });

    it("refuses a panel origin", async () => {
        const panelOrigin = `http://local.dev.evil.panel.${BROWSER_HOST_SUFFIX}:${host.port}`;
        expect((await bridge("echo", [], panelOrigin)).status).toBe(403);
        expect((await bridge("note", [], panelOrigin, "send")).status).toBe(403);
        expect(sends).toEqual([]);
    });

    it("refuses a caller without the exact shell origin", async () => {
        expect((await bridge("echo", [], "http://evil.example")).status).toBe(403);
    });

    it("does not expose unknown or inherited channels", async () => {
        expect((await bridge("computer-remove", ["local"])).status).toBe(404);
        expect((await bridge("constructor", [])).status).toBe(404);
    });

    it("delivers sends", async () => {
        expect((await bridge("note", ["warn", "hello"], host.origin, "send")).status).toBe(204);
        expect(sends).toEqual([["warn", "hello"]]);
    });
});

describe("panel origins", () => {
    it("serve the panel named by the host prefix, framed only by the shell", async () => {
        const res = await request("/index.html?_r=0", {
            host: `local.dev.paperboard.terminal.${BROWSER_HOST_SUFFIX}:${host.port}`,
        });
        expect(res.status).toBe(200);
        expect(res.body).toBe("<html>panel</html>");
        expect(panelCalls.at(-1)).toEqual(["local", "dev.paperboard.terminal", "/index.html"]);
        // the served policy stays; frame-ancestors is added alongside it
        expect(res.headers["content-security-policy"]).toBe(
            `script-src 'self', frame-ancestors ${host.origin}`,
        );
    });
});

describe("events", () => {
    function openStream(headers: Record<string, string> = {}) {
        return new Promise<{ res: http.IncomingMessage; req: http.ClientRequest }>((resolve, reject) => {
            const req = http.request(
                {
                    host: "127.0.0.1",
                    port: host.port,
                    path: "/_shell/events",
                    headers: { host: `${BROWSER_HOST_SUFFIX}:${host.port}`, ...headers },
                },
                (res) => resolve({ res, req }),
            );
            req.on("error", reject);
            req.end();
        });
    }

    it("pushes named events to open streams", async () => {
        const { res, req } = await openStream();
        expect(res.statusCode).toBe(200);
        let text = "";
        const got = new Promise<void>((resolve) => {
            res.on("data", (chunk) => {
                text += chunk;
                if (text.includes("event: computers-changed")) resolve();
            });
        });
        host.push("computers-changed", { activeId: "local" });
        await got;
        expect(text).toContain(`data: {"activeId":"local"}`);
        req.destroy();
    });

    it("refuses cross-origin streams", async () => {
        const { res, req } = await openStream({ "sec-fetch-site": "same-site" });
        expect(res.statusCode).toBe(403);
        req.destroy();
    });

    it("drops a stream that stops reading instead of buffering without bound", async () => {
        // a raw socket that never reads: nothing drains the server's buffer
        const socket = net.connect(host.port, "127.0.0.1");
        await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
        socket.write(
            `GET /_shell/events HTTP/1.1\r\nHost: ${BROWSER_HOST_SUFFIX}:${host.port}\r\n\r\n`,
        );
        socket.pause();
        await new Promise((r) => setTimeout(r, 50));
        const big = "x".repeat(64 * 1024);
        // well past the backlog cap plus whatever the kernel socket buffers hold
        const pushes = Math.ceil((MAX_EVENT_BACKLOG_BYTES * 16) / big.length);
        for (let i = 0; i < pushes; i++) {
            host.push("computers-changed", big);
            await new Promise((r) => setImmediate(r));
        }
        // a dropped stream ends once the client drains what was sent; a
        // stream still held open never does
        const closed = new Promise<boolean>((resolve) => {
            socket.once("close", () => resolve(true));
            setTimeout(() => resolve(false), 3000).unref();
        });
        socket.resume();
        const dropped = await closed;
        socket.destroy();
        expect(dropped).toBe(true);
    });

    it("caps concurrent streams", async () => {
        const open: http.ClientRequest[] = [];
        let refused = 0;
        for (let i = 0; i < MAX_EVENT_CLIENTS + 2; i++) {
            const { res, req } = await openStream();
            open.push(req);
            if (res.statusCode === 503) refused++;
        }
        expect(refused).toBeGreaterThanOrEqual(2);
        for (const req of open) req.destroy();
    });
});

describe("close", () => {
    it("ends streams and stops listening", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-browserhost-close-"));
        const local = await startBrowserHost({
            port: 0,
            rendererDir: dir,
            invoke: {},
            servePanel: async () => new Response(""),
        });
        const stream = await new Promise<http.IncomingMessage>((resolve, reject) => {
            http.get(
                { host: "127.0.0.1", port: local.port, path: "/_shell/events", headers: { host: `${BROWSER_HOST_SUFFIX}:${local.port}` } },
                resolve,
            ).on("error", reject);
        });
        const ended = new Promise<void>((resolve) => stream.on("close", () => resolve()));
        stream.resume();
        await local.close();
        await ended;
        const refused = await new Promise<string>((resolve) => {
            http.get({ host: "127.0.0.1", port: local.port, path: "/" }, () => resolve("answered")).on("error", (err: any) =>
                resolve(err.code),
            );
        });
        // nothing answers (Bun reports a reset where Node reports a refusal)
        expect(["ECONNREFUSED", "ECONNRESET"]).toContain(refused);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe("renderer dev proxy", () => {
    it("never lets the request path choose the upstream host", async () => {
        const seen: { dev: string[]; other: string[] } = { dev: [], other: [] };
        const listen = (log: string[]) =>
            new Promise<http.Server>((resolve) => {
                const server = http.createServer((req, res) => {
                    log.push(req.url ?? "");
                    res.end("upstream");
                });
                server.listen(0, "127.0.0.1", () => resolve(server));
            });
        const dev = await listen(seen.dev);
        const other = await listen(seen.other);
        const devPort = (dev.address() as net.AddressInfo).port;
        const otherPort = (other.address() as net.AddressInfo).port;
        const proxied = await startBrowserHost({
            port: 0,
            rendererDevUrl: `http://127.0.0.1:${devPort}`,
            invoke: {},
            servePanel: async () => new Response("x"),
        });
        try {
            const target = proxied;
            const send = (pathname: string) =>
                new Promise<number>((resolve, reject) => {
                    const req = http.request(
                        {
                            host: "127.0.0.1",
                            port: target.port,
                            path: pathname,
                            headers: { host: `${BROWSER_HOST_SUFFIX}:${target.port}` },
                        },
                        (res) => {
                            res.resume();
                            res.on("end", () => resolve(res.statusCode ?? 0));
                        },
                    );
                    req.on("error", reject);
                    req.end();
                });
            expect(await send("/main.js")).toBe(200);
            await send(`//127.0.0.1:${otherPort}/secret`);
            await send(`http://127.0.0.1:${otherPort}/secret`);
            expect(seen.other).toEqual([]);
            expect(seen.dev[0]).toBe("/main.js");
            expect(seen.dev).toContain(`//127.0.0.1:${otherPort}/secret`);
        } finally {
            await proxied.close();
            dev.close();
            other.close();
        }
    });
});
