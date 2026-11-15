// The shell's channels are declared once (src/shared/shellContract.ts) and
// every host serves exactly them: browser mode serves the ones the contract
// gives it, reading each call's args before its handler runs, and a host
// whose handlers drift from the contract doesn't start. The window's side
// is checked in the real Electron app (shellSecurity.test.ts). The browser
// host runs for real on a loopback port, with the handlers browser mode uses.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as http from "node:http";
import * as path from "node:path";
import { sessionCookieName, startBrowserHost, type BrowserHost } from "../../src/main/browserHost";
import { BrowserSessions } from "../../src/main/browserSessions";
import { createShellInvokeHandlers } from "../../src/main/communication/shellHandlers";
import { shellServer } from "../../src/main/communication/shellServer";
import { SHELL_CALLS, SHELL_SENDS } from "../../src/shared/shellContract";
import { tempDir } from "../platform/app/support/temp";

let host: BrowserHost;
let cookie: string;

const calls = () =>
    createShellInvokeHandlers({
        appVersion: () => "0.0.0-test",
        launchOptions: () => ({ mobile: false }),
        graphics: () => ({ gpu: true }),
        openPath: async () => "",
        appSettingsChanged: async () => null,
    });

function post(pathname: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                host: "127.0.0.1",
                port: host.port,
                method: "POST",
                path: pathname,
                headers: { host: `localhost:${host.port}`, origin: host.origin, "content-type": "application/json", cookie, ...headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString("utf8") }));
                res.on("error", reject);
            },
        );
        req.on("error", reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
    });
}

beforeAll(async () => {
    const dir = tempDir("shell-channels");
    host = await startBrowserHost({
        port: 0,
        sessions: new BrowserSessions(path.join(dir, "browser-sessions.json")),
        rendererDir: dir,
        shell: shellServer("browser", calls(), { "renderer-log": () => undefined }),
        servePanel: async () => new Response("", { status: 404 }),
    });
    cookie = "";
    const link = new URL(host.signInUrl());
    const signedIn = await new Promise<string>((resolve, reject) => {
        http.get({ host: "127.0.0.1", port: host.port, path: link.pathname + link.search, headers: { host: `localhost:${host.port}` } }, (res) => {
            res.resume();
            resolve(String(res.headers["set-cookie"]).split(";")[0]!);
        }).on("error", reject);
    });
    expect(signedIn.startsWith(`${sessionCookieName(host.port)}=`)).toBe(true);
    cookie = signedIn;
});

afterAll(async () => {
    await host?.close();
});

// Inventory: Core contracts — browser mode serves exactly the calls and sends the contract gives it, each reading its args first.
test("browser mode serves the declared browser calls and sends, refusing args the contract doesn't name, and nothing else", async () => {
    for (const [channel, definition] of Object.entries(SHELL_CALLS)) {
        const answer = await post(`/_shell/invoke/${channel}`, { args: { notAField: true } });
        if ("browser" in definition) {
            expect({ channel, status: answer.status }).toEqual({ channel, status: 200 });
            const { ok, error } = JSON.parse(answer.body);
            expect({ channel, ok, error }).toEqual({ channel, ok: false, error: expect.stringContaining(`The shell's ${channel} call was refused: `) });
        } else {
            expect({ channel, status: answer.status, body: answer.body }).toEqual({ channel, status: 404, body: `Channel not available in browser mode: ${channel}` });
        }
    }
    for (const [channel, definition] of Object.entries(SHELL_SENDS)) {
        const answer = await post(`/_shell/send/${channel}`, { args: { notAField: true } });
        expect({ channel, status: answer.status }).toEqual({ channel, status: "browser" in definition ? 400 : 404 });
    }
    const switched = JSON.parse((await post("/_shell/invoke/computer-switch", { args: { id: 7 } })).body);
    expect(switched.error).toBe(`The shell's computer-switch call was refused: the field "id": expected text, got number`);
    expect((await post("/_shell/invoke/not-a-channel", {})).status).toBe(404);
});

// Inventory: Core contracts — a host whose handlers miss a declared channel, or add one, refuses to start and names it.
test("a host missing a declared channel, or serving one the contract doesn't give it, doesn't start", () => {
    const { "computers-list": _dropped, ...missing } = calls();
    expect(() => shellServer("browser", missing as ReturnType<typeof calls>, { "renderer-log": () => undefined })).toThrow(
        "The browser shell host doesn't serve the calls its contract declares: missing computers-list.",
    );
    const extra = { ...calls(), "update-check": async () => undefined };
    expect(() => shellServer("browser", extra, { "renderer-log": () => undefined })).toThrow(
        "The browser shell host doesn't serve the calls its contract declares: not declared for it: update-check.",
    );
    expect(() => shellServer("window", calls() as never, {} as never)).toThrow(/missing app-update-state, update-queue, /);
});
