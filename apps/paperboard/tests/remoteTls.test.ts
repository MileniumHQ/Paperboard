// Remote computers over TLS (bun test), through the real daemon and the
// real Electron-side client. A daemon reachable from other computers speaks
// only TLS with its own certificate; this machine's clients keep a separate
// plaintext loopback port. Pairing captures the certificate (trust on first
// use) and every later connection is pinned to it: an impostor, a missing
// pin and a plaintext dial are all refused.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { once } from "events";
import { WebSocket } from "ws";
import type { ServerInstance } from "../papercrane/index";
import { PaperCraneClient } from "../src/main/communication/papercrane/PaperCraneClient";
import { certFingerprint } from "../papercrane/pinnedTls";
import { pinnableWebSocket } from "../papercrane/pinnableWebSocket";
import { impostorTls } from "./tlsFixture";

const HOST_TOKEN = "pc_remote_tls_host_token";
// the client treats 127.0.0.1 as this computer; 127.0.0.2 reaches the same
// daemon (Linux routes all of 127/8 to lo) but is dialed as a remote one
const REMOTE_ADDR = "127.0.0.2";
let tmp = "";
let savedDir: string | undefined;
let daemon: ServerInstance;
let daemonCert = "";
const clients: PaperCraneClient[] = [];

function client(): PaperCraneClient {
    const c = new PaperCraneClient();
    clients.push(c);
    return c;
}

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-remote-tls-"));
    savedDir = process.env.PAPERBOARD_DIR;
    process.env.PAPERBOARD_DIR = tmp;
    const { startPaperCraneServer } = await import("../papercrane/index");
    daemon = await startPaperCraneServer({
        host: "0.0.0.0",
        port: 0,
        headless: true,
        advertise: false,
        staticToken: HOST_TOKEN,
    });
    daemonCert = JSON.parse(fs.readFileSync(path.join(tmp, "local", "tls_identity.json"), "utf8")).cert;
});

afterAll(() => {
    for (const c of clients) c.disconnect();
    daemon?.stop();
    if (savedDir === undefined) delete process.env.PAPERBOARD_DIR;
    else process.env.PAPERBOARD_DIR = savedDir;
    fs.rmSync(tmp, { recursive: true, force: true });
});

async function pairNewClient(): Promise<{ token: string; cert: string }> {
    const code = daemon.auth.startPairing();
    const pairing = client();
    await pairing.connectForPairing(REMOTE_ADDR, daemon.port);
    const res = await pairing.pair(code, "remote-tls-test");
    pairing.disconnect();
    return { token: res.token, cert: pairing.getCert()! };
}

describe("the daemon's listeners", () => {
    it("serves this machine's clients on a separate plaintext loopback port", async () => {
        expect(daemon.localPort).not.toBe(daemon.port);
        const handshake = JSON.parse(fs.readFileSync(path.join(tmp, "local", "crane.json"), "utf8"));
        expect(handshake.port).toBe(daemon.localPort);
        const local = new WebSocket(`ws://127.0.0.1:${daemon.localPort}`);
        try {
            await once(local, "open");
            const reply = once(local, "message");
            local.send(JSON.stringify({ id: 1, action: "auth:verify", params: { token: HOST_TOKEN } }));
            expect(JSON.parse((await reply)[0].toString()).error).toBeUndefined();
        } finally {
            local.terminate();
        }
    });

    it("refuses plaintext on the port other computers reach", async () => {
        const Socket = pinnableWebSocket();
        const plain = new Socket(`ws://127.0.0.1:${daemon.port}`);
        const outcome = await new Promise<string>((resolve) => {
            plain.on("open", () => resolve("open"));
            plain.on("error", () => resolve("refused"));
        });
        plain.terminate();
        expect(outcome).toBe("refused");
    });

    it("keeps one identity across restarts of the same install", async () => {
        const { loadOrCreateTlsIdentity } = await import("../papercrane/tlsIdentity");
        expect(loadOrCreateTlsIdentity(path.join(tmp, "local")).cert).toBe(daemonCert);
    });

    it("refuses --no-auth on a non-loopback host", async () => {
        const { startPaperCraneServer } = await import("../papercrane/index");
        await expect(
            startPaperCraneServer({ host: "0.0.0.0", port: 0, headless: true, advertise: false, noAuth: true }),
        ).rejects.toThrow(/loopback/);
    });
});

describe("pairing and pinned reconnects", () => {
    it("pairing captures the daemon's certificate", async () => {
        const { token, cert } = await pairNewClient();
        expect(token).toMatch(/^pc_/);
        expect(certFingerprint(cert)).toBe(certFingerprint(daemonCert));
    });

    it("a paired client reconnects pinned and works over RPC and HTTP", async () => {
        const { token, cert } = await pairNewClient();
        const paired = client();
        await paired.connect(REMOTE_ADDR, daemon.port, token, cert);
        const info = await paired.call<{ service?: string }>("system:info");
        expect(info.service).toBe("papercrane");
        const health = await paired.request("health");
        expect(health.ok).toBe(true);
    });

    it("refuses a daemon that presents a different certificate", async () => {
        const { token } = await pairNewClient();
        const fooled = client();
        await expect(fooled.connect(REMOTE_ADDR, daemon.port, token, impostorTls.cert)).rejects.toThrow();
        await expect(fooled.request("health")).rejects.toThrow();
    });

    it("refuses to dial a paired remote that has no pinned certificate", async () => {
        const { token } = await pairNewClient();
        const unpinned = client();
        await expect(unpinned.connect(REMOTE_ADDR, daemon.port, token)).rejects.toThrow(/pair it again/);
    });
});

// The shell's connection to a paired computer must survive idling, a daemon
// restart and a dead network path, and must say so when its credential is
// gone. Before: the socket stayed unauthenticated until the first RPC, the
// daemon closed it after its 10s handshake window ("Connection Lost" seconds
// after launch), and nothing ever reconnected it.
describe("a paired computer's connection", () => {
    it("stays connected while idle past the daemon's handshake window", async () => {
        const { token, cert } = await pairNewClient();
        const idle = client();
        await idle.connect(REMOTE_ADDR, daemon.port, token, cert);
        await new Promise((r) => setTimeout(r, 11_000));
        expect(idle.getStatus().connected).toBe(true);
    }, 20_000);

    it("reports a revoked pairing instead of connecting or retrying", async () => {
        const { token, cert } = await pairNewClient();
        daemon.auth.revokeToken(token);
        const revoked = client();
        await expect(revoked.connect(REMOTE_ADDR, daemon.port, token, cert)).rejects.toThrow(
            /pair it again/,
        );
        await new Promise((r) => setTimeout(r, 300));
        expect(revoked.getStatus()).toMatchObject({ connected: false, error: expect.stringMatching(/pair it again/) });
    });

    it("reconnects by itself after the daemon restarts", async () => {
        const { token, cert } = await pairNewClient();
        const kept = new PaperCraneClient({ reconnectBaseMs: 100, reconnectMaxMs: 200 });
        clients.push(kept);
        await kept.connect(REMOTE_ADDR, daemon.port, token, cert);
        const port = daemon.port;
        const dropped = new Promise<void>((resolve) => {
            const onStatus = (s: { connected: boolean }) => {
                if (!s.connected) {
                    kept.off("status", onStatus);
                    resolve();
                }
            };
            kept.on("status", onStatus);
        });
        daemon.stop();
        await dropped;
        const { startPaperCraneServer } = await import("../papercrane/index");
        daemon = await startPaperCraneServer({
            host: "0.0.0.0",
            port,
            headless: true,
            advertise: false,
            staticToken: HOST_TOKEN,
        });
        for (let i = 0; i < 50 && !kept.getStatus().connected; i++) {
            await new Promise((r) => setTimeout(r, 100));
        }
        expect(kept.getStatus().connected).toBe(true);
        const info = await kept.call<{ service?: string }>("system:info");
        expect(info.service).toBe("papercrane");
    }, 20_000);
});

describe("a computer that stops answering", () => {
    it("is detected by the heartbeat and reconnected", async () => {
        const net = await import("net");
        const { WebSocketServer } = await import("ws");
        const peer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
        await once(peer, "listening");
        peer.on("connection", (ws) => {
            ws.on("message", (raw) => {
                const msg = JSON.parse(raw.toString());
                ws.send(JSON.stringify({ type: "response", id: msg.id, result: { success: true } }));
            });
        });
        // the path between the app and the computer: a frozen hop drops
        // every byte without closing anything, like a sleeping peer
        let frozen = false;
        let connections = 0;
        const hops = new Set<import("net").Socket>();
        const path = net.createServer((inbound) => {
            connections++;
            const outbound = net.connect((peer.address() as { port: number }).port, "127.0.0.1");
            hops.add(inbound).add(outbound);
            inbound.on("data", (d) => !frozen && outbound.write(d));
            outbound.on("data", (d) => !frozen && inbound.write(d));
            inbound.on("close", () => outbound.destroy());
            outbound.on("close", () => inbound.destroy());
            inbound.on("error", () => outbound.destroy());
            outbound.on("error", () => inbound.destroy());
        });
        path.listen(0, "127.0.0.1");
        await once(path, "listening");
        const c = new PaperCraneClient({ heartbeatMs: 100, reconnectBaseMs: 50, reconnectMaxMs: 50 });
        clients.push(c);
        try {
            await c.connect("127.0.0.1", (path.address() as { port: number }).port, "tok");
            expect(c.getStatus().connected).toBe(true);
            frozen = true;
            for (let i = 0; i < 40 && c.getStatus().connected; i++) {
                await new Promise((r) => setTimeout(r, 50));
            }
            expect(c.getStatus()).toMatchObject({ connected: false, error: "The computer stopped responding" });
            frozen = false;
            for (let i = 0; i < 40 && !c.getStatus().connected; i++) {
                await new Promise((r) => setTimeout(r, 50));
            }
            expect(c.getStatus().connected).toBe(true);
            expect(connections).toBeGreaterThanOrEqual(2);
        } finally {
            c.disconnect();
            for (const hop of hops) hop.destroy();
            path.close();
            for (const ws of peer.clients) ws.terminate();
            peer.close();
        }
    }, 10_000);
});
