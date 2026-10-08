// pre-auth connection budget (bun test): idle unauthenticated sockets from
// the network cannot lock this machine's own callers out, and one network
// address cannot hold every remote pre-auth slot. 127.0.0.2+ stand in for
// LAN peers: they reach the server like any non-loopback address would.
import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { PaperCraneAuth } from "../papercrane/auth";
import { PaperCraneEngine } from "../papercrane/engine";
import { setupWebSocketServer } from "../papercrane/ws";
import { CraneTransport } from "../../../packages/paperapi/src/ws";

async function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperboard-preauth-"));
    const engine = new PaperCraneEngine(root);
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    auth.injectToken("test-host", "host");
    const server = http.createServer();
    const wss = new WebSocketServer({ server });
    setupWebSocketServer(wss, engine, auth, {});
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    const sockets: net.Socket[] = [];
    return {
        port,
        sockets,
        close: async () => {
            for (const socket of sockets) socket.destroy();
            for (const socket of wss.clients) socket.terminate();
            wss.close();
            await new Promise<void>((resolve) => server.close(() => resolve()));
            auth.dispose();
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}

// an idle pre-auth WebSocket from `from`. Resolves "held" once upgraded and
// left open, or "refused" when the server closes it with 4429.
function idleSocket(f: { port: number; sockets: net.Socket[] }, from: string): Promise<"held" | "refused"> {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host: "127.0.0.1", port: f.port, localAddress: from });
        f.sockets.push(socket);
        let received = Buffer.alloc(0);
        let settle: ReturnType<typeof setTimeout> | null = null;
        socket.on("error", reject);
        socket.on("connect", () =>
            socket.write(
                `GET / HTTP/1.1\r\nHost: 127.0.0.1:${f.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
                    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
            ),
        );
        socket.on("data", (chunk) => {
            received = Buffer.concat([received, chunk]);
            const end = received.indexOf("\r\n\r\n");
            if (end < 0) return;
            const frame = received.subarray(end + 4);
            // close frame: opcode 0x8, status code in the first two payload bytes
            if (frame.length >= 4 && (frame[0] & 0x0f) === 0x8) {
                if (settle) clearTimeout(settle);
                resolve(frame.readUInt16BE(2) === 4429 ? "refused" : "held");
                return;
            }
            settle ??= setTimeout(() => resolve("held"), 100);
        });
    });
}

test("one network address cannot hold more than its share of pre-auth slots", async () => {
    const f = await fixture();
    try {
        const held = await Promise.all(Array.from({ length: 16 }, () => idleSocket(f, "127.0.0.2")));
        expect(held.every((r) => r === "held")).toBe(true);
        expect(await idleSocket(f, "127.0.0.2")).toBe("refused");
        expect(await idleSocket(f, "127.0.0.3")).toBe("held");
    } finally {
        await f.close();
    }
});

test("a full remote pre-auth budget does not lock out this machine", async () => {
    const f = await fixture();
    const sdk = new CraneTransport({ port: f.port, token: "test-host", computerId: "local" });
    try {
        const peers = Array.from({ length: 8 }, (_, i) => `127.0.0.${i + 2}`);
        const held = await Promise.all(peers.flatMap((peer) => Array.from({ length: 16 }, () => idleSocket(f, peer))));
        expect(held.every((r) => r === "held")).toBe(true);
        // remote budget is spent: a ninth peer is turned away...
        expect(await idleSocket(f, "127.0.0.20")).toBe("refused");
        // ...while the loopback caller still connects and authenticates
        expect(await sdk.call("config:set", { id: "panel.a", data: { alive: true } })).toEqual({ success: true });
    } finally {
        sdk.close();
        await f.close();
    }
});
