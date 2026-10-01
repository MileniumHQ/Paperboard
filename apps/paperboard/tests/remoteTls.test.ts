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
