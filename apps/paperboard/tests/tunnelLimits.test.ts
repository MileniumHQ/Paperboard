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
import { pinnableWebSocket } from "../papercrane/pinnableWebSocket";
import { remoteTls } from "./tlsFixture";

const NpmWebSocket = pinnableWebSocket();
const { WebSocketServer: FixtureWebSocketServer } = import.meta.require(
    path.join(path.dirname(import.meta.require.resolve("ws/package.json")), "index.js"),
) as typeof import("ws");
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
    heartbeatMs = HEARTBEAT_MS,
): Promise<void> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-tunnel-limits-"));
    const auth = new PaperCraneAuth(false, dir);
    const server = https.createServer({ key: remoteTls.key, cert: remoteTls.cert });
    const remote = new FixtureWebSocketServer({ server });
    const local = new FixtureWebSocketServer({ port: 0, host: "127.0.0.1" });
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
        setupWebSocketServer(local, new PaperCraneEngine(dir), auth, { remotesFile, tunnelHeartbeatMs: heartbeatMs });
        if (!local.address()) await new Promise<void>((resolve) => local.once("listening", resolve));
        const frames: any[] = [];
        client = new NpmWebSocket(`ws://127.0.0.1:${(local.address() as AddressInfo).port}`);
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

// Use the actual TCP read side, rather than a mocked bufferedAmount. A
// sender stays bounded too: each write waits for its callback, with at most
// 64 MiB generated in either direction even on the defective implementation.
async function flood(socket: WebSocket, frame: string): Promise<void> {
    for (let n = 0; n < 64 && socket.readyState === WebSocket.OPEN; n++) {
        const sent = await new Promise<boolean>((resolve) => socket.send(frame, (error) => resolve(!error)));
        if (!sent) return; // observed socket failure ends this fixture workload
    }
}

for (const direction of ["upstream-to-local", "local-to-upstream"] as const) {
    it(`bounds ${direction} tunnel queues and tears down the upstream`, async () => {
        let upstream: WebSocket | undefined;
        let remoteClosed = false;
        let startFlood: (() => Promise<void>) | undefined;
        const chunk = "x".repeat(1024 * 1024);
        await withTunnel(true, (socket) => {
            upstream = socket;
            socket.on("error", () => socket.terminate());
            socket.once("close", () => { remoteClosed = true; });
            socket.on("message", (raw: Buffer) => {
                if (raw[0] !== 123) return; // the workload payload is deliberately opaque
                const message = JSON.parse(raw.toString());
                socket.send(JSON.stringify({ id: message.id, result: { success: true } }));
                if (message.id === "__tunnel-scope") {
                    if (direction === "local-to-upstream") socket.pause();
                    else startFlood = () => flood(socket, chunk);
                }
            });
        }, async ({ client, frames, local }) => {
            await until(() => frames.some((f) => f.type === "tunnel-open"), "relay tunnel open");
            // Exercise the narrowest principal: this socket can relay but
            // has no authority to call local panel RPCs.
            client.send(JSON.stringify({ id: 2, action: "panel:list" }));
            await until(() => frames.some((f) => f.id === 2), "relay-only refusal");
            expect(frames.find((f) => f.id === 2).error).toContain("only relays");
            const serverSocket = [...local.clients][0]!;
            let localCloseCode: number | undefined;
            client.once("close", (code) => { localCloseCode = code; });
            let pendingFlood: Promise<void> | undefined;
            try {
                if (direction === "upstream-to-local") {
                    client.pause();
                    pendingFlood = startFlood!();
                } else {
                    pendingFlood = flood(client, JSON.stringify({ type: "tunnel", id: "t1", payload: chunk }));
                }
                await until(() => serverSocket.readyState !== WebSocket.OPEN, "slow tunnel consumer closed", 4000);
                expect(serverSocket.bufferedAmount).toBeLessThanOrEqual(32 * 1024 * 1024);
                // Teardown is immediate, even when the destination cannot
                // read the queued close frame. Resume only to observe it.
                if (direction === "upstream-to-local") {
                    await until(() => remoteClosed, "upstream teardown while client is stalled");
                }
                client.resume();
                upstream!.resume();
                await until(() => remoteClosed && localCloseCode !== undefined, "both tunnel ends closed");
                expect(localCloseCode).toBe(4429);
            } finally {
                client.terminate();
                upstream?.terminate();
                await pendingFlood;
            }
        }, 15_000);
    }, 10000);
}
