// The packaged Electron shell must reach its own daemon. It used to load
// from file://, which the daemon's WebSocket origin allowlist refuses
// (4403), so every packaged launch showed "could not connect to its local
// server" while dev (http://localhost) worked. The shell is now served from
// SHELL_ORIGIN; these tests hold the daemon and the shell host to that.
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { PaperCraneAuth } from "../papercrane/auth";
import { PaperCraneEngine } from "../papercrane/engine";
import { setupWebSocketServer } from "../papercrane/ws";
import { handleHttpRequest } from "../papercrane/http";
import { DavSessionStore } from "../papercrane/dav";
import { PROTOCOL_VERSION } from "../papercrane/protocol";
import { readShellFile, SHELL_ORIGIN } from "../src/main/shellAssets";

async function daemon() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperboard-shellorigin-"));
    const engine = new PaperCraneEngine(root);
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    auth.injectToken("test-host", "host");
    const sessions = new DavSessionStore();
    const remotesFile = path.join(root, "remotes.json");
    fs.writeFileSync(remotesFile, JSON.stringify({ computers: [] }));
    const server = http.createServer((req, res) => handleHttpRequest(engine, req, res, { auth, sessions }));
    const wss = new WebSocketServer({ server });
    setupWebSocketServer(wss, engine, auth, { remotesFile });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    return {
        port,
        close: async () => {
            for (const socket of wss.clients) socket.terminate();
            wss.close();
            await new Promise<void>((resolve) => server.close(() => resolve()));
            auth.dispose(); sessions.revokeAll();
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}

describe("shell origin reaches the daemon", () => {
    test("a socket from the shell origin authenticates; file:// stays refused", async () => {
        const d = await daemon();
        const sockets: WebSocket[] = [];
        try {
            const shell = new WebSocket(`ws://127.0.0.1:${d.port}`, { headers: { Origin: SHELL_ORIGIN } });
            sockets.push(shell);
            // a refused socket closes instead of answering: report the code
            const outcome = new Promise<{ reply?: any; closed?: number }>((resolve) => {
                shell.once("message", (data) => resolve({ reply: JSON.parse(String(data)) }));
                shell.once("close", (code) => resolve({ closed: code }));
            });
            shell.once("open", () =>
                shell.send(JSON.stringify({ id: 1, action: "auth:verify", params: { token: "test-host", v: PROTOCOL_VERSION } })),
            );
            const { reply, closed } = await outcome;
            expect(closed).toBeUndefined();
            expect(reply.id).toBe(1);
            expect(reply.result.success).toBe(true);

            const file = new WebSocket(`ws://127.0.0.1:${d.port}`, { headers: { Origin: "file://" } });
            sockets.push(file);
            const [code] = await once(file, "close");
            expect(code).toBe(4403);
        } finally {
            for (const s of sockets) s.terminate();
            await d.close();
        }
    });
});

describe("readShellFile", () => {
    let rendererDir = "";
    let outside = "";
    beforeAll(() => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-shellassets-"));
        rendererDir = path.join(tmp, "renderer");
        fs.mkdirSync(path.join(rendererDir, "assets"), { recursive: true });
        fs.writeFileSync(path.join(rendererDir, "index.html"), "<html>shell</html>");
        fs.writeFileSync(path.join(rendererDir, "assets", "app.js"), "console.log(1)");
        outside = path.join(tmp, "outside.txt");
        fs.writeFileSync(outside, "secret");
    });
    afterAll(() => fs.rmSync(path.dirname(rendererDir), { recursive: true, force: true }));

    test("serves renderer files with their type", async () => {
        const index = await readShellFile(rendererDir, "/");
        expect(index.ok && index.data.toString()).toBe("<html>shell</html>");
        expect(index.ok && index.headers["Content-Type"]).toContain("text/html");
        const js = await readShellFile(rendererDir, "/assets/app.js");
        expect(js.ok && js.headers["Content-Type"]).toContain("javascript");
    });

    test("refuses traversal, reports missing and malformed paths", async () => {
        expect(await readShellFile(rendererDir, "/../outside.txt")).toEqual({ ok: false, status: 403 });
        expect(await readShellFile(rendererDir, "/%2e%2e/outside.txt")).toEqual({ ok: false, status: 403 });
        expect(await readShellFile(rendererDir, "/nope.js")).toEqual({ ok: false, status: 404 });
        expect(await readShellFile(rendererDir, "/assets")).toEqual({ ok: false, status: 404 });
        expect(await readShellFile(rendererDir, "/%E0%A4%A")).toEqual({ ok: false, status: 400 });
    });
});
