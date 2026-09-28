// loopback WebDAV relay (bun test): a real DAV daemon behind the real relay.
// The client never sends a credential; the relay adds the session's Basic
// auth. Connections are served only when the kernel reports the client
// socket belongs to this user, a refused peer gets nothing, the upstream's
// password challenge never reaches the file manager, and a quiet relay
// closes itself.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as http from "http";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { DavSessionStore } from "../papercrane/dav";
import { handleHttpRequest } from "../papercrane/http";
import {
    startDavRelay,
    socketOwnerUid,
    relayFolderUrl,
    MAX_RELAY_CONNECTIONS,
    type DavRelay,
} from "../src/main/davRelay";

const TOKEN = "relay-test-main-token";
let tmp = "";
let upstream: http.Server;
let upstreamOrigin = "";
let session: { user: string; pass: string };
const relays: DavRelay[] = [];

async function relayWith(overrides: Partial<Parameters<typeof startDavRelay>[0]> = {}): Promise<DavRelay> {
    const relay = await startDavRelay({
        upstream: upstreamOrigin,
        user: session.user,
        pass: session.pass,
        idleMs: 60_000,
        onIdle: () => undefined,
        ...overrides,
    });
    relays.push(relay);
    return relay;
}

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dav-relay-test-"));
    const engine = new PaperCraneEngine(tmp);
    const auth = new PaperCraneAuth(false, tmp);
    auth.injectToken(TOKEN, "test");
    const sessions = new DavSessionStore();
    upstream = http.createServer((req, res) => {
        handleHttpRequest(engine, req, res, { auth, sessions });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const addr = upstream.address();
    upstreamOrigin = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    fs.mkdirSync(path.join(tmp, "files"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "files", "note.txt"), "hello");
    const res = await fetch(`${upstreamOrigin}/dav/session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ idleMs: 60_000 }),
    });
    session = (await res.json()) as { user: string; pass: string };
});

afterAll(async () => {
    await Promise.all(relays.map((r) => r.close()));
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("relaying", () => {
    it("serves the remote folder with no credential from the client", async () => {
        const relay = await relayWith();
        const res = await fetch(`http://127.0.0.1:${relay.port}/dav/files/`, {
            method: "PROPFIND",
            headers: { Depth: "1" },
        });
        expect(res.status).toBe(207);
        expect(await res.text()).toContain("note.txt");
    });

    it("writes, moves and reads files through the relay", async () => {
        const relay = await relayWith();
        const base = `http://127.0.0.1:${relay.port}/dav/files`;
        expect((await fetch(`${base}/a.txt`, { method: "PUT", body: "moved bytes" })).status).toBeLessThan(300);
        const moved = await fetch(`${base}/a.txt`, {
            method: "MOVE",
            headers: { Destination: `${base}/b.txt` },
        });
        expect(moved.status).toBeLessThan(300);
        expect(await (await fetch(`${base}/b.txt`)).text()).toBe("moved bytes");
        expect(fs.readFileSync(path.join(tmp, "files", "b.txt"), "utf8")).toBe("moved bytes");
    });

    it("never passes the upstream's password challenge to the file manager", async () => {
        const relay = await relayWith({ pass: "wrong-password" });
        const res = await fetch(`http://127.0.0.1:${relay.port}/dav/`, {
            method: "PROPFIND",
            headers: { Depth: "0" },
        });
        expect(res.status).toBe(401);
        expect(res.headers.get("www-authenticate")).toBeNull();
    });

    it("answers 502 when the remote computer is unreachable", async () => {
        const relay = await relayWith({ upstream: "http://127.0.0.1:1" });
        const res = await fetch(`http://127.0.0.1:${relay.port}/dav/`, { method: "PROPFIND" });
        expect(res.status).toBe(502);
    });
});

describe("who may connect", () => {
    it("accepts this user through the real socket owner check", async () => {
        // default verifyPeer: reads /proc/net/tcp for the client socket's uid
        const relay = await relayWith();
        const res = await fetch(`http://127.0.0.1:${relay.port}/dav/`, { method: "PROPFIND", headers: { Depth: "0" } });
        expect(res.status).toBe(207);
    });

    it("drops a connection the owner check refuses, before any HTTP", async () => {
        const relay = await relayWith({ verifyPeer: async () => false });
        const socket = net.connect(relay.port, "127.0.0.1");
        let received = "";
        socket.on("data", (chunk) => (received += chunk));
        socket.on("connect", () => socket.write("PROPFIND /dav/ HTTP/1.1\r\nHost: x\r\nDepth: 0\r\n\r\n"));
        await new Promise<void>((resolve) => socket.on("close", () => resolve()));
        expect(received).toBe("");
    });

    it("caps open connections", async () => {
        const gate = Promise.withResolvers<boolean>();
        const held = gate.promise;
        const release = () => gate.resolve(true);
        const relay = await relayWith({ verifyPeer: () => held });
        const open: net.Socket[] = [];
        for (let i = 0; i < MAX_RELAY_CONNECTIONS; i++) {
            const s = net.connect(relay.port, "127.0.0.1");
            s.on("error", () => undefined);
            open.push(s);
            await new Promise((r) => s.once("connect", r));
        }
        const extra = net.connect(relay.port, "127.0.0.1");
        extra.on("error", () => undefined);
        await new Promise<void>((resolve) => extra.on("close", () => resolve()));
        release();
        for (const s of open) s.destroy();
    });

    it("reads the client socket's owner uid from /proc/net/tcp", () => {
        const table = [
            "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
            // the relay's accepted end (local 0xBB80 = 48000, remote 0xC350 = 50000)
            "   0: 0100007F:BB80 0100007F:C350 01 00000000:00000000 00:00000000 00000000  1000        0 1",
            // the client's end: local 50000, remote 48000, owned by uid 1001
            "   1: 0100007F:C350 0100007F:BB80 01 00000000:00000000 00:00000000 00000000  1001        0 2",
        ].join("\n");
        expect(socketOwnerUid(table, 50000, 48000)).toBe(1001);
        expect(socketOwnerUid(table, 50001, 48000)).toBeNull();
    });
});

describe("lifetime", () => {
    it("closes itself when quiet and reports it", async () => {
        let idled = false;
        const relay = await relayWith({ idleMs: 50, onIdle: () => (idled = true) });
        await new Promise((r) => setTimeout(r, 200));
        expect(idled).toBe(true);
        const refused = await fetch(`http://127.0.0.1:${relay.port}/dav/`).then(
            () => false,
            () => true,
        );
        expect(refused).toBe(true);
    });
});

describe("relayFolderUrl", () => {
    it("names WebDAV the way the desktop's file manager expects", () => {
        expect(relayFolderUrl("KDE", 4100, "files/dev.paperboard.terminal")).toBe(
            "webdav://127.0.0.1:4100/dav/files/dev.paperboard.terminal/",
        );
        expect(relayFolderUrl("GNOME", 4100, "")).toBe("dav://127.0.0.1:4100/dav/");
        expect(relayFolderUrl(undefined, 4100, "a b")).toBe("dav://127.0.0.1:4100/dav/a%20b/");
    });
});
