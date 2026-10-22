import { expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as https from "node:https";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { setupWebSocketServer } from "../papercrane/ws";
import { PaperCraneAuth } from "../papercrane/auth";
import { PaperCraneEngine } from "../papercrane/engine";
import { remoteTls } from "./tlsFixture";

const HEARTBEAT_MS = 40;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean, description: string, ms = 3000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`Timed out: ${description}`);
        await sleep(5);
    }
}

// Real pinned TLS upstream and authenticated daemon socket; only the remote's
// protocol replies are fixtures. All resources belong to this invocation.
async function withTunnel(
    scoped: boolean,
    onRemote: (socket: WebSocket) => void,
    run: (fixture: { client: WebSocket; frames: any[]; local: WebSocketServer; remote: WebSocketServer }) => Promise<void>,
): Promise<void> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-tunnel-limits-"));
    const auth = new PaperCraneAuth(false, dir);
    const server = https.createServer({ key: remoteTls.key, cert: remoteTls.cert });
    const remote = new WebSocketServer({ server });
    const local = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    let client: WebSocket | undefined;
    try {
        remote.on("connection", onRemote);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const remotesFile = path.join(dir, "remotes.json");
        fs.writeFileSync(remotesFile, JSON.stringify({ computers: [{
            id: "peer1", name: "peer1", host: "127.0.0.1", port: (server.address() as AddressInfo).port,
            token: "remote-token", cert: remoteTls.cert,
        }] }));
        auth.injectToken("pc_tunnel_limits", "host");
        const token = scoped ? auth.issueRelayToken("com.example.fixture", "peer1") : "pc_tunnel_limits";
        setupWebSocketServer(local, new PaperCraneEngine(dir), auth, { remotesFile, tunnelHeartbeatMs: HEARTBEAT_MS });
        if (!local.address()) await new Promise<void>((resolve) => local.once("listening", resolve));
        const frames: any[] = [];
        client = new WebSocket(`ws://127.0.0.1:${(local.address() as AddressInfo).port}`);
        client.on("message", (raw: Buffer) => frames.push(JSON.parse(raw.toString())));
        await new Promise<void>((resolve, reject) => {
            client!.once("open", resolve);
            client!.once("error", reject);
        });
        client.send(JSON.stringify({ id: 1, action: "auth:verify", params: { token } }));
        await until(() => frames.some((f) => f.id === 1), "local authentication");
        expect(frames.find((f) => f.id === 1).error).toBeUndefined();
        client.send(JSON.stringify({ type: "remote:open", tunnelId: "t1", computerId: "peer1" }));
        await run({ client, frames, local, remote });
    } finally {
        client?.terminate();
        for (const socket of local.clients) socket.terminate();
        for (const socket of remote.clients) socket.terminate();
        await Promise.all([
            new Promise<void>((resolve) => local.close(() => resolve())),
            new Promise<void>((resolve) => remote.close(() => resolve())),
            new Promise<void>((resolve) => server.close(() => resolve())),
        ]);
        auth.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

for (const scoped of [false, true]) {
    it(`handshake replays own one heartbeat and release it on remote:close (${scoped ? "relay" : "host"})`, async () => {
        const live = new Set<ReturnType<typeof setInterval>>();
        const originalSet = globalThis.setInterval;
        const originalClear = globalThis.clearInterval;
        globalThis.setInterval = ((fn: TimerHandler, ms: number, ...args: any[]) => {
            const handle = originalSet(fn, ms, ...args);
            if (ms === HEARTBEAT_MS) live.add(handle);
            return handle;
        }) as typeof setInterval;
        globalThis.clearInterval = ((handle: ReturnType<typeof setInterval>) => {
            live.delete(handle);
            originalClear(handle);
        }) as typeof clearInterval;
        let pings = 0;
        let scopeRequests = 0;
        try {
            await withTunnel(scoped, (socket) => {
                socket.on("ping", () => pings++);
                socket.on("message", (raw: Buffer) => {
                    const message = JSON.parse(raw.toString());
                    if (message.id === "__tunnel-scope") scopeRequests++;
                    // Replay both steps, including scope on the unscoped path.
                    for (let n = 0; n < 20; n++) socket.send(JSON.stringify({ id: message.id, result: { success: true } }));
                    if (!scoped) socket.send(JSON.stringify({ id: "__tunnel-scope", result: { success: true } }));
                });
            }, async ({ client, frames, remote }) => {
                await until(() => frames.some((f) => f.type === "tunnel-open"), "tunnel open");
                await sleep(240);
                const liveWhileOpen = live.size;
                client.send(JSON.stringify({ type: "remote:close", id: "t1" }));
                await until(() => remote.clients.size === 0, "upstream teardown");
                await sleep(80);
                expect({
                    opens: frames.filter((f) => f.type === "tunnel-open").length,
                    liveWhileOpen,
                    liveAfterClose: live.size,
                    scopeRequests,
                }).toEqual({ opens: 1, liveWhileOpen: 1, liveAfterClose: 0, scopeRequests: scoped ? 1 : 0 });
                expect(pings).toBeGreaterThan(0);
                expect(pings).toBeLessThanOrEqual(8);
            });
        } finally {
            // Also clean up the leaked handles when running against unfixed code.
            for (const handle of live) originalClear(handle);
            globalThis.setInterval = originalSet;
            globalThis.clearInterval = originalClear;
        }
    });
}

it("an unsolicited scope reply cannot open a tunnel before auth succeeds", async () => {
    let upstream: WebSocket | undefined;
    await withTunnel(true, (socket) => {
        upstream = socket;
        socket.on("message", (raw: Buffer) => {
            const message = JSON.parse(raw.toString());
            if (message.id === "__tunnel-auth") socket.send(JSON.stringify({ id: "__tunnel-scope", result: { success: true } }));
            if (message.id === "__tunnel-scope") socket.send(JSON.stringify({ id: message.id, result: { success: true } }));
        });
    }, async ({ frames }) => {
        await until(() => upstream !== undefined, "upstream connected");
        await sleep(80);
        expect(frames.some((f) => f.type === "tunnel-open")).toBe(false);
        upstream!.send(JSON.stringify({ id: "__tunnel-auth", result: { success: true } }));
        await until(() => frames.some((f) => f.type === "tunnel-open"), "authenticated tunnel open");
    });
});
