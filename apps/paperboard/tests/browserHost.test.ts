// browser-mode host (bun test): real HTTP against startBrowserHost on a
// loopback port. The shell and every panel document require the session
// cookie from a single-use launch link; the shell bridge additionally
// requires the exact shell Origin (a panel frame is same-site, so it holds
// the cookie too); foreign Host headers are refused; pushes reach open
// event streams; close() tears the listener and streams down.
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
    SESSION_COOKIE,
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

async function signIn(): Promise<string> {
    const launch = new URL(host.mintLaunchUrl());
    const res = await request(launch.pathname + launch.search);
    expect(res.status).toBe(303);
    const cookie = String(res.headers["set-cookie"]?.[0] ?? "");
    return cookie.split(";")[0];
}

function bridge(channel: string, cookie: string, args: unknown[], origin = host.origin, kind = "invoke") {
    return request(`/_shell/${kind}/${channel}`, {
        method: "POST",
        headers: { cookie, origin, "content-type": "application/json" },
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

describe("sign-in", () => {
    it("serves nothing without a session", async () => {
        expect((await request("/")).status).toBe(401);
        expect((await request("/assets/app.js")).status).toBe(401);
    });

    it("exchanges a launch key for an HttpOnly, SameSite=Strict site cookie", async () => {
        const launch = new URL(host.mintLaunchUrl());
        expect(launch.origin).toBe(host.origin);
        const res = await request(launch.pathname + launch.search);
        expect(res.status).toBe(303);
        expect(res.headers.location).toBe("/");
        const cookie = String(res.headers["set-cookie"]?.[0] ?? "");
        expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
        expect(cookie).toContain("HttpOnly");
        expect(cookie).toContain("SameSite=Strict");
        expect(cookie).toContain(`Domain=${BROWSER_HOST_SUFFIX}`);
    });

    it("launch keys are single use", async () => {
        const launch = new URL(host.mintLaunchUrl());
        expect((await request(launch.pathname + launch.search)).status).toBe(303);
        expect((await request(launch.pathname + launch.search)).status).toBe(403);
        expect((await request("/_shell/launch?key=guess")).status).toBe(403);
    });

    it("a wrong cookie is not a session", async () => {
        expect((await request("/", { headers: { cookie: `${SESSION_COOKIE}=forged` } })).status).toBe(401);
    });

    it("serves the renderer with a session, contained to its directory", async () => {
        const cookie = await signIn();
        const index = await request("/", { headers: { cookie } });
        expect(index.status).toBe(200);
        expect(index.body).toBe("<html>shell</html>");
        expect(index.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
        const asset = await request("/assets/app.js", { headers: { cookie } });
        expect(asset.body).toContain("shell");
        const escape = await request("/..%2f..%2fetc%2fpasswd", { headers: { cookie } });
        expect([403, 404]).toContain(escape.status);
    });
});

describe("host header", () => {
    it("refuses names that are not ours (DNS rebinding)", async () => {
        const cookie = await signIn();
        for (const name of [`attacker.example:${host.port}`, `127.0.0.1:${host.port}`, `${BROWSER_HOST_SUFFIX}.evil.io:${host.port}`]) {
            expect((await request("/", { host: name, headers: { cookie } })).status).toBe(421);
        }
    });
});

describe("shell bridge", () => {
    it("answers the shell origin", async () => {
        const cookie = await signIn();
        const res = await bridge("echo", cookie, [{ id: "local" }]);
        expect(JSON.parse(res.body)).toEqual({ ok: true, result: { echoed: { id: "local" } } });
    });

    it("carries handler failures as failures", async () => {
        const cookie = await signIn();
        const res = await bridge("fails", cookie, []);
        expect(JSON.parse(res.body)).toEqual({ ok: false, error: "CRANE_NOT_READY" });
    });

    it("refuses a panel origin even with the session cookie", async () => {
        const cookie = await signIn();
        const panelOrigin = `http://local.dev.evil.panel.${BROWSER_HOST_SUFFIX}:${host.port}`;
        expect((await bridge("echo", cookie, [], panelOrigin)).status).toBe(403);
        expect((await bridge("note", cookie, [], panelOrigin, "send")).status).toBe(403);
        expect(sends).toEqual([]);
    });

    it("refuses callers without a session", async () => {
        expect((await bridge("echo", "", [])).status).toBe(401);
    });

    it("does not expose unknown or inherited channels", async () => {
        const cookie = await signIn();
        expect((await bridge("computer-remove", cookie, ["local"])).status).toBe(404);
        expect((await bridge("constructor", cookie, [])).status).toBe(404);
    });

    it("delivers sends", async () => {
        const cookie = await signIn();
        expect((await bridge("note", cookie, ["warn", "hello"], host.origin, "send")).status).toBe(204);
        expect(sends).toEqual([["warn", "hello"]]);
    });
});

describe("panel origins", () => {
    it("serve the panel named by the host prefix, framed only by the shell", async () => {
        const cookie = await signIn();
        const res = await request("/index.html?_r=0", {
            host: `local.dev.paperboard.terminal.${BROWSER_HOST_SUFFIX}:${host.port}`,
            headers: { cookie },
        });
        expect(res.status).toBe(200);
        expect(res.body).toBe("<html>panel</html>");
        expect(panelCalls.at(-1)).toEqual(["local", "dev.paperboard.terminal", "/index.html"]);
        // the served policy stays; frame-ancestors is added alongside it
        expect(res.headers["content-security-policy"]).toBe(
            `script-src 'self', frame-ancestors ${host.origin}`,
        );
    });

    it("require the session (a panel document carries a panel token)", async () => {
        const before = panelCalls.length;
        const res = await request("/", { host: `local.dev.paperboard.terminal.${BROWSER_HOST_SUFFIX}:${host.port}` });
        expect(res.status).toBe(401);
        expect(panelCalls.length).toBe(before);
    });
});

describe("events", () => {
    function openStream(cookie: string, headers: Record<string, string> = {}) {
        return new Promise<{ res: http.IncomingMessage; req: http.ClientRequest }>((resolve, reject) => {
            const req = http.request(
                {
                    host: "127.0.0.1",
                    port: host.port,
                    path: "/_shell/events",
                    headers: { host: `${BROWSER_HOST_SUFFIX}:${host.port}`, cookie, ...headers },
                },
                (res) => resolve({ res, req }),
            );
            req.on("error", reject);
            req.end();
        });
    }

    it("pushes named events to open streams", async () => {
        const cookie = await signIn();
        const { res, req } = await openStream(cookie);
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
        const cookie = await signIn();
        const { res, req } = await openStream(cookie, { "sec-fetch-site": "same-site" });
        expect(res.statusCode).toBe(403);
        req.destroy();
    });

    it("drops a stream that stops reading instead of buffering without bound", async () => {
        const cookie = await signIn();
        // a raw socket that never reads: nothing drains the server's buffer
        const socket = net.connect(host.port, "127.0.0.1");
        await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
        socket.write(
            `GET /_shell/events HTTP/1.1\r\nHost: ${BROWSER_HOST_SUFFIX}:${host.port}\r\nCookie: ${cookie}\r\n\r\n`,
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
        const cookie = await signIn();
        const open: http.ClientRequest[] = [];
        let refused = 0;
        for (let i = 0; i < MAX_EVENT_CLIENTS + 2; i++) {
            const { res, req } = await openStream(cookie);
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
        const launch = new URL(local.mintLaunchUrl());
        const signin = await new Promise<http.IncomingMessage>((resolve, reject) => {
            http.get(
                { host: "127.0.0.1", port: local.port, path: launch.pathname + launch.search, headers: { host: launch.host } },
                resolve,
            ).on("error", reject);
        });
        const cookie = String(signin.headers["set-cookie"]?.[0]).split(";")[0];
        const stream = await new Promise<http.IncomingMessage>((resolve, reject) => {
            http.get(
                { host: "127.0.0.1", port: local.port, path: "/_shell/events", headers: { host: launch.host, cookie } },
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
