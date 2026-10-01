import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { PaperCraneAuth } from "../papercrane/auth";
import { PaperCraneEngine } from "../papercrane/engine";
import { setupWebSocketServer } from "../papercrane/ws";
import { handleHttpRequest } from "../papercrane/http";
import { DavSessionStore } from "../papercrane/dav";
import { CraneTransport } from "../../../packages/paperapi/src/ws";
import { pinnedTlsOptions } from "../papercrane/pinnedTls";
import { pinnableWebSocket } from "../papercrane/pinnableWebSocket";
import { remoteTls } from "./tlsFixture";

// tls: serve as a remote computer's daemon does (TLS only, pinned by peers)
async function fixture(remotes?: { port: number }, options: { tls?: boolean } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperboard-wire-"));
    const engine = new PaperCraneEngine(root);
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    auth.injectToken("test-host", "host");
    const sessions = new DavSessionStore();
    const remotesFile = path.join(root, "remotes.json");
    fs.writeFileSync(remotesFile, JSON.stringify({ computers: remotes ? [{ id: "remote", host: "127.0.0.1", port: remotes.port, token: "test-host", cert: remoteTls.cert }] : [] }));
    const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => handleHttpRequest(engine, req, res, { auth, sessions });
    const server = options.tls ? https.createServer({ key: remoteTls.key, cert: remoteTls.cert }, onRequest) : http.createServer(onRequest);
    const wss = new WebSocketServer({ server });
    setupWebSocketServer(wss, engine, auth, { remotesFile });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    return { engine, auth, port, wss,
        close: async () => {
            for (const socket of wss.clients) socket.terminate();
            wss.close();
            await new Promise<void>((resolve) => server.close(() => resolve()));
            auth.dispose(); sessions.revokeAll();
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}

test("malformed pre-auth text closes only its socket; authenticated SDK remains usable", async () => {
    const f = await fixture();
    const sdk = new CraneTransport({ port: f.port, token: "test-host", computerId: "local" });
    try {
        const bad = new WebSocket(`ws://127.0.0.1:${f.port}`);
        await once(bad, "open");
        const closed = once(bad, "close");
        bad.send(Buffer.from([0xff]), { binary: false });
        await closed;
        expect(await sdk.call("config:set", { id: "panel.a", data: { alive: true } })).toEqual({ success: true });
    } finally { sdk.close(); await f.close(); }
});

test("standalone entry survives malformed unauthenticated frames and serves another client", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "standalone-wire-"));
    const child = Bun.spawn([process.execPath, path.resolve(import.meta.dir, "../papercrane/main.ts"), "--host", "127.0.0.1", "--port", "0", "--headless"], {
        env: { ...process.env, PAPERBOARD_DIR: root }, stdout: "pipe", stderr: "pipe",
    });
    const output = new Response(child.stdout).text();
    const errors = new Response(child.stderr).text();
    let sdk: CraneTransport | undefined;
    let bad: WebSocket | undefined;
    try {
        const handshake = path.join(root, "local", "crane.json");
        const deadline = Date.now() + 5000;
        while (!fs.existsSync(handshake)) {
            if (Date.now() > deadline || child.exitCode !== null) throw new Error("Standalone daemon did not become ready");
            await Bun.sleep(10);
        }
        const credentials = JSON.parse(fs.readFileSync(handshake, "utf8"));
        bad = new WebSocket(`ws://127.0.0.1:${credentials.port}`);
        await once(bad, "open");
        const closed = once(bad, "close");
        bad.send(Buffer.from([0xff]), { binary: false });
        await closed;
        sdk = new CraneTransport({ ...credentials, computerId: "local" });
        expect((await sdk.call("system:info")).service).toBe("papercrane");
        expect(child.exitCode).toBeNull();
    } finally {
        bad?.terminate(); sdk?.close(); child.kill();
        await child.exited; await output; await errors;
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 10_000);

test("panel credential issuance is host-only and claim-carrying", async () => {
    const f = await fixture();
    const host = new CraneTransport({ port: f.port, token: "test-host", computerId: "local" });
    const scoped = new CraneTransport({ port: f.port, token: f.auth.issuePanelToken("panel.a"), computerId: "local" });
    try {
        const issued = await host.call<{ token: string }>("auth:panel-token", { panelId: "panel.b" });
        expect(f.auth.matchToken(issued.token)?.panelId).toBe("panel.b");
        await expect(scoped.call("auth:panel-token", { panelId: "panel.c" })).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(f.auth.verifyHostToken(issued.token)).toBe(false);
    } finally { host.close(); scoped.close(); await f.close(); }
});

test("scoped authorization agrees over RPC, HTTP and authenticated remote relay", async () => {
    const remote = await fixture(undefined, { tls: true });
    const local = await fixture(remote);
    const token = local.auth.issuePanelToken("panel.a");
    const sdk = new CraneTransport({ port: local.port, token, computerId: "remote", panelId: "panel.a" });
    try {
        await remote.engine.setConfig("panel.b", { private: true });
        await expect(sdk.call("config:get", { id: "panel.b" })).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(await sdk.call("config:set", { id: "panel.a", data: { remote: true } })).toEqual({ success: true });
        expect(await remote.engine.getConfig("panel.a")).toEqual({ remote: true });
        await expect(sdk.call("auth:scope", { panelId: "panel.b" })).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(sdk.call("auth:verify", { token: "test-host" })).rejects.toThrow();
        const PinnedSocket = pinnableWebSocket();
        const raw = new PinnedSocket(`wss://127.0.0.1:${remote.port}`, pinnedTlsOptions(remoteTls.cert));
        await once(raw, "open");
        const send = async (action: string, params: unknown) => {
            const response = once(raw, "message");
            raw.send(JSON.stringify({ id: 1, action, params }));
            return JSON.parse((await response)[0].toString());
        };
        try {
            expect((await send("auth:verify", { token: "test-host" })).error).toBeUndefined();
            expect((await send("auth:scope", { panelId: "panel.a" })).error).toBeUndefined();
            expect((await send("auth:verify", { token: "test-host" })).code).toBe("FORBIDDEN");
        } finally { raw.terminate(); }
        for (const endpoint of ["/dav/configs/panel.b.json", "/panel/panel.b/index.html"]) {
            const response = await fetch(`http://127.0.0.1:${local.port}${endpoint}`, { headers: { Authorization: `Bearer ${token}` } });
            expect(response.status).toBe(401);
        }
        const session = await fetch(`http://127.0.0.1:${local.port}/dav/session`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "{}" });
        expect(session.status).toBe(401);
    } finally { sdk.close(); await local.close(); await remote.close(); }
});

test("explicit shell credential provider initializes additional remote transports without ambient IPC", async () => {
    const remote = await fixture(undefined, { tls: true });
    const local = await fixture(remote);
    const api = await import("../../../packages/paperapi/src/index");
    const dispose = api.configureHostConnection(async () => ({ port: local.port, token: "test-host" }));
    try {
        await api.initPaperApi({ computerId: "local" });
        await remote.engine.setConfig("panel.remote", { host: "remote" });
        expect(await api.config.get("panel.remote", undefined, "remote")).toEqual({ host: "remote" });
        expect(await local.engine.getConfig("panel.remote")).toBeNull();
    } finally { dispose(); await local.close(); await remote.close(); }
});

test("live revocation closes both direct and relay sockets, and invalidates DAV credentials", async () => {
    const remote = await fixture(undefined, { tls: true });
    const local = await fixture(remote);
    const token = local.auth.issuePanelToken("panel.a");
    const direct = new CraneTransport({ port: local.port, token, computerId: "local" });
    const relay = new CraneTransport({ port: local.port, token, computerId: "remote" });
    try {
        await direct.ensureConnected(); await relay.ensureConnected();
        local.auth.revokePanelTokens("panel.a");
        await Bun.sleep(40);
        await expect(direct.call("config:set", { id: "panel.a", data: 1 })).rejects.toThrow();
        await expect(relay.call("config:set", { id: "panel.a", data: 1 })).rejects.toThrow();
        const response = await fetch(`http://127.0.0.1:${local.port}/dav/session`, { method: "POST", headers: { Authorization: "Bearer test-host" }, body: "{}" });
        const session = await response.json() as { user: string; pass: string };
        local.auth.revokeToken("test-host");
        const read = await fetch(`http://127.0.0.1:${local.port}/dav/`, { headers: { Authorization: `Basic ${Buffer.from(`${session.user}:${session.pass}`).toString("base64")}` } });
        expect(read.status).toBe(401);
    } finally { direct.close(); relay.close(); await local.close(); await remote.close(); }
});

test("service hydration waits for initialization and rejects failed initialization", async () => {
    const f = await fixture();
    const api = await import("../../../packages/paperapi/src/index");
    let release!: () => void;
    let disposeBridge: (() => void) | undefined;
    const initializing = new Promise<void>((resolve) => { release = resolve; });
    try {
        await api.initPaperApi({ port: f.port, token: "test-host", computerId: "local" });
        const service = api.definePanelService({ id: "panel.ready", state: { phase: "starting" },
            onInit: async (ctx) => { await initializing; ctx.setState({ phase: "ready" }); } });
        const deadline = Date.now() + 2000;
        while (!(await api.actionsApi.list("panel.ready")).some((action) => action.action === "__getState")) {
            if (Date.now() > deadline) throw new Error("Hydration handler was not registered");
            await Bun.sleep(5);
        }
        let completed = false;
        const bridge = api.createPanelBridge({ panelId: "panel.ready", defaultState: { phase: "default" } });
        disposeBridge = bridge.dispose;
        const hydration = api.actionsApi.call("panel.ready", "__getState").then((state) => { completed = true; return state; });
        await Bun.sleep(20);
        expect(completed).toBe(false);
        release(); await service.ready;
        expect(await hydration).toEqual({ phase: "ready" });
        const { hydratePanelBridges } = await import("../../../packages/paperapi/src/panelHydration");
        await hydratePanelBridges("panel.ready");
        expect(bridge.getState()).toEqual({ phase: "ready" });
        expect(bridge.getStatus().ready).toBe(true);
        const failed = api.definePanelService({ id: "panel.failed", state: {}, onInit: async () => { throw new Error("fixture hydration failed"); } });
        await expect(failed.ready).rejects.toThrow("fixture hydration failed");
        await expect(api.actionsApi.call("panel.failed", "__getState")).rejects.toThrow("fixture hydration failed");
    } finally { release(); disposeBridge?.(); api.closeTransport("local"); await f.close(); }
});
