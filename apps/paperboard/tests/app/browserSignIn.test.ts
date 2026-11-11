// Paperboard in the browser hands out the local daemon's credentials and
// every panel, so nothing past the signed-out page may answer a browser
// that Paperboard didn't sign in. The host runs for real on a loopback port.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { sessionCookieName, startBrowserHost, type BrowserHost } from "../../src/main/browserHost";
import { BrowserSessions, SESSION_TTL_MS, SIGN_IN_LINK_TTL_MS } from "../../src/main/browserSessions";
import { tempDir } from "../platform/app/support/temp";

const SECRET = "daemon-master-token";

let dir: string;
let rendererDir: string;
let sessions: BrowserSessions;
let host: BrowserHost;

interface Answer {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: string;
}

// raw requests, so the test picks every header a browser would send (Host included)
function request(
    method: string,
    pathname: string,
    headers: Record<string, string> = {},
    body?: string,
): Promise<Answer> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { host: "127.0.0.1", port: host.port, method, path: pathname, headers: { host: `localhost:${host.port}`, ...headers } },
            (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
            },
        );
        req.on("error", reject);
        req.end(body);
    });
}

const invoke = (cookie?: string, origin = host.origin) =>
    request("POST", "/_shell/invoke/crane-credentials", {
        origin,
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
    }, JSON.stringify({ args: [] }));

async function signIn(): Promise<string> {
    const link = new URL(host.signInUrl());
    const answer = await request("GET", link.pathname + link.search);
    expect(answer.status).toBe(303);
    expect(answer.headers.location).toBe("/");
    const set = String(answer.headers["set-cookie"]);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    return set.split(";")[0]!;
}

beforeAll(async () => {
    dir = tempDir("browser-sign-in");
    rendererDir = path.join(dir, "renderer");
    fs.mkdirSync(rendererDir);
    fs.writeFileSync(path.join(rendererDir, "index.html"), "<p>shell</p>");
    fs.writeFileSync(path.join(rendererDir, "signed-out.html"), "<p>signed out</p>");
    sessions = new BrowserSessions(path.join(dir, "local", "browser-sessions.json"));
    host = await startBrowserHost({
        port: 0,
        sessions,
        rendererDir,
        invoke: { "crane-credentials": () => ({ port: 1, token: SECRET }) },
        servePanel: async () => new Response("<p>panel</p>", { headers: { "content-type": "text/html" } }),
    });
});

afterAll(async () => {
    await host?.close();
});

describe("a browser Paperboard didn't sign in", () => {
    test("gets the signed-out page, and nothing that reaches the daemon or a panel", async () => {
        expect((await request("GET", "/")).headers.location).toBe("/signed-out.html");
        expect((await request("GET", "/signed-out.html")).body).toBe("<p>signed out</p>");
        const creds = await invoke();
        expect(creds.status).toBe(401);
        expect(creds.body).not.toContain(SECRET);
        expect((await request("GET", "/_shell/events")).status).toBe(401);
        expect((await request("GET", "/_panel/local/dev.paperboard.terminal/index.html")).status).toBe(401);
        expect((await invoke(`${sessionCookieName(host.port)}=${"a".repeat(43)}`)).status).toBe(401);
    });

    test("can't reuse a sign-in link or use one past its five minutes", async () => {
        const link = new URL(host.signInUrl());
        expect((await request("GET", link.pathname + link.search)).status).toBe(303);
        const again = await request("GET", link.pathname + link.search);
        expect(again.headers.location).toBe("/signed-out.html?reason=link");
        expect(again.headers["set-cookie"]).toBeUndefined();

        let now = 1_000_000;
        const clocked = new BrowserSessions(path.join(dir, "clocked.json"), () => now);
        const stale = clocked.issueSignInLink();
        now += SIGN_IN_LINK_TTL_MS;
        expect(clocked.redeemSignInLink(stale)).toBeNull();
    });

    test("another site's page is refused even with the cookie, and a rebinding Host gets nothing", async () => {
        const cookie = await signIn();
        expect((await invoke(cookie, "http://evil.example")).status).toBe(403);
        expect((await request("GET", "/", { host: `evil.example:${host.port}`, cookie })).status).toBe(421);
    });
});

describe("a signed-in browser", () => {
    test("reaches the shell and its panels, and loses them when it signs out", async () => {
        const cookie = await signIn();
        expect((await request("GET", "/", { cookie })).body).toBe("<p>shell</p>");
        const creds = await invoke(cookie);
        expect(JSON.parse(creds.body)).toEqual({ ok: true, result: { port: 1, token: SECRET } });
        const panel = await request("GET", "/_panel/local/dev.paperboard.terminal/index.html", { cookie });
        expect(panel.status).toBe(200);
        expect(panel.headers["content-security-policy"]).toContain("frame-ancestors 'self'");

        const out = await request("POST", "/_shell/sign-out", { origin: host.origin, "content-type": "application/json", cookie });
        expect(out.status).toBe(204);
        expect((await invoke(cookie)).status).toBe(401);
    });

    test("stays signed in when Paperboard restarts, and the file keeps no usable token", async () => {
        const cookie = await signIn();
        const token = cookie.split("=")[1]!;
        const file = path.join(dir, "local", "browser-sessions.json");
        expect(fs.readFileSync(file, "utf8")).not.toContain(token);
        if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o077).toBe(0);
        expect(new BrowserSessions(file).isSignedIn(token)).toBe(true);
    });

    test("is signed out after 30 days", () => {
        let now = 1_000_000;
        const clocked = new BrowserSessions(path.join(dir, "expiry.json"), () => now);
        const signed = clocked.redeemSignInLink(clocked.issueSignInLink())!;
        expect(clocked.isSignedIn(signed.token)).toBe(true);
        now += SESSION_TTL_MS;
        expect(clocked.isSignedIn(signed.token)).toBe(false);
    });
});
