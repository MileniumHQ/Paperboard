// pre-auth tunnel + action_reply gating (bun test): an unauthenticated LAN
// socket must never open a relay tunnel with the host's stored remote token,
// and pre-auth action_reply frames are dropped. An authenticated socket keeps
// the legit tunnel path working.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "net";
import { setupWebSocketServer } from "../papercrane/ws";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { actionsRegistry } from "../papercrane/actions";

let tmp = "";
let wss: WebSocketServer;
let port = 0;
let upstream: WebSocketServer;
let upstreamPort = 0;
let remotesFile = "";
const TOKEN = "pc_test_remote_auth_token";

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-remoteauth-"));
    const engine = new PaperCraneEngine(tmp);
    const auth = new PaperCraneAuth(false, tmp);
    auth.injectToken(TOKEN, "test");

    // fake paired machine: answers the tunnel auth handshake with success
    upstream = new WebSocketServer({ port: 0 });
    upstream.on("connection", (sock: WebSocket) => {
        sock.on("message", (raw: Buffer) => {
            try {
                const m = JSON.parse(raw.toString("utf8"));
                if (m?.id === "__tunnel-auth") {
                    sock.send(JSON.stringify({ id: "__tunnel-auth", result: { ok: true } }));
                }
            } catch (err) {
                console.debug("[test] upstream parse failed:", String(err));
            }
        });
    });
    await new Promise<void>((resolve) => upstream.on("listening", () => resolve()));
    upstreamPort = (upstream.address() as AddressInfo).port;

    remotesFile = path.join(tmp, "paired_computers.json");
    fs.writeFileSync(
        remotesFile,
        JSON.stringify({
            computers: [
                { id: "peer1", name: "peer1", host: "127.0.0.1", port: upstreamPort, token: "remote-token" },
            ],
        }),
    );

    wss = new WebSocketServer({ port: 0 });
    setupWebSocketServer(wss, engine, auth, { remotesFile });
    await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
    port = (wss.address() as AddressInfo).port;
});

afterAll(() => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    upstream.close();
    fs.rmSync(tmp, { recursive: true, force: true });
});

interface Client {
    ws: WebSocket;
    frames: any[];
}

function connect(): Promise<Client> {
    return new Promise((resolve, reject) => {
        const frames: any[] = [];
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.on("message", (raw: Buffer) => {
            try {
                frames.push(JSON.parse(raw.toString("utf8")));
            } catch {
                frames.push({ _raw: raw.toString("utf8") });
            }
        });
        ws.on("open", () => resolve({ ws, frames }));
        ws.on("error", reject);
    });
}

function send(client: Client, obj: unknown): void {
    client.ws.send(JSON.stringify(obj));
}

async function waitFor(client: Client, pred: (f: any) => boolean, ms = 3000): Promise<any> {
    const start = Date.now();
    while (!client.frames.some(pred)) {
        if (Date.now() - start > ms) throw new Error("waitFor timeout");
        await new Promise((r) => setTimeout(r, 5));
    }
    return client.frames.find(pred);
}

describe("pre-auth remote tunnel gating", () => {
    it("unauth socket sending remote:open gets AUTH_REQUIRED and no tunnel opens", async () => {
        const c = await connect();
        try {
            send(c, { type: "remote:open", tunnelId: "t-unauth", computerId: "peer1" });
            const resp = await waitFor(c, (f) => f.type === "tunnel-closed" && f.id === "t-unauth");
            expect(resp.error).toBeTruthy();
            expect(resp.code).toBe("AUTH_REQUIRED");

            await new Promise((r) => setTimeout(r, 200));
            expect(c.frames.find((f) => f.type === "tunnel-open")).toBeUndefined();
        } finally {
            c.ws.terminate();
        }
    });

    it("pre-auth action_reply frames are dropped before reaching the registry", async () => {
        const c = await connect();
        const seen: unknown[][] = [];
        const orig = actionsRegistry.handleReply.bind(actionsRegistry);
        (actionsRegistry as any).handleReply = (...args: unknown[]) => {
            seen.push(args);
            return orig(...(args as [string, unknown, string | undefined]));
        };
        try {
            c.ws.send(JSON.stringify({ type: "action_reply", callId: "call_nope", result: 1 }));
            await new Promise((r) => setTimeout(r, 150));
            expect(seen).toHaveLength(0);
        } finally {
            (actionsRegistry as any).handleReply = orig;
            c.ws.terminate();
        }
    });

    it("authenticated socket can still open a tunnel (regression)", async () => {
        const c = await connect();
        try {
            send(c, { id: 1, action: "auth:verify", params: { token: TOKEN } });
            const ok = await waitFor(c, (f) => f.id === 1);
            expect(ok.error).toBeUndefined();

            send(c, { type: "remote:open", tunnelId: "t-authed", computerId: "peer1" });
            const opened = await waitFor(
                c,
                (f) => f.type === "tunnel-open" && f.id === "t-authed",
                5000,
            );
            expect(opened).toBeTruthy();
        } finally {
            c.ws.terminate();
        }
    });

    it("unreachable upstream yields exactly one tunnel-closed (single teardown)", async () => {
        // grab a port nothing listens on: bind, read, release
        const probe = new WebSocketServer({ port: 0 });
        await new Promise<void>((resolve) => probe.on("listening", () => resolve()));
        const deadPort = (probe.address() as AddressInfo).port;
        await new Promise<void>((resolve) => probe.close(() => resolve()));
        const raw = JSON.parse(fs.readFileSync(remotesFile, "utf8"));
        raw.computers.push({ id: "dead", name: "dead", host: "127.0.0.1", port: deadPort, token: "x" });
        fs.writeFileSync(remotesFile, JSON.stringify(raw));

        const c = await connect();
        try {
            send(c, { id: 1, action: "auth:verify", params: { token: TOKEN } });
            await waitFor(c, (f) => f.id === 1);
            send(c, { type: "remote:open", tunnelId: "t-dead", computerId: "dead" });
            const closed = await waitFor(
                c,
                (f) => f.type === "tunnel-closed" && f.id === "t-dead",
                5000,
            );
            expect(closed.reason).toBe("unreachable");
            // the late upstream close must not emit a second frame
            await new Promise((r) => setTimeout(r, 400));
            expect(
                c.frames.filter((f) => f.type === "tunnel-closed" && f.id === "t-dead"),
            ).toHaveLength(1);
        } finally {
            c.ws.terminate();
        }
    });

    it("client-initiated remote:close tears down silently", async () => {
        const c = await connect();
        try {
            send(c, { id: 1, action: "auth:verify", params: { token: TOKEN } });
            await waitFor(c, (f) => f.id === 1);
            send(c, { type: "remote:open", tunnelId: "t-quiet", computerId: "peer1" });
            await waitFor(c, (f) => f.type === "tunnel-open" && f.id === "t-quiet", 5000);
            send(c, { type: "remote:close", id: "t-quiet" });
            await new Promise((r) => setTimeout(r, 300));
            expect(
                c.frames.filter((f) => f.type === "tunnel-closed" && f.id === "t-quiet"),
            ).toHaveLength(0);
        } finally {
            c.ws.terminate();
        }
    });

    it("exact id wins over a colliding name; ambiguous names refuse instead of guessing", async () => {
        const raw = JSON.parse(fs.readFileSync(remotesFile, "utf8"));
        // "peer1" is a live id; add a DEAD remote sharing the name "peer1"
        // and a pair of live remotes sharing only a name
        const probe = new WebSocketServer({ port: 0 });
        await new Promise<void>((resolve) => probe.on("listening", () => resolve()));
        const deadPort = (probe.address() as AddressInfo).port;
        await new Promise<void>((resolve) => probe.close(() => resolve()));
        raw.computers.push(
            { id: "ghost", name: "peer1", host: "127.0.0.1", port: deadPort, token: "x" },
            { id: "twin-a", name: "twins", host: "127.0.0.1", port: upstreamPort, token: "remote-token" },
            { id: "twin-b", name: "twins", host: "127.0.0.1", port: upstreamPort, token: "remote-token" },
        );
        fs.writeFileSync(remotesFile, JSON.stringify(raw));

        const c = await connect();
        try {
            send(c, { id: 1, action: "auth:verify", params: { token: TOKEN } });
            await waitFor(c, (f) => f.id === 1);
            // "peer1" matches a live id and a dead name: the id must win
            send(c, { type: "remote:open", tunnelId: "t-exact", computerId: "peer1" });
            const opened = await waitFor(
                c,
                (f) => f.type === "tunnel-open" && f.id === "t-exact",
                5000,
            );
            expect(opened).toBeTruthy();
            // "twins" matches two names and no id: refuse, don't first-match
            send(c, { type: "remote:open", tunnelId: "t-amb", computerId: "twins" });
            const closed = await waitFor(
                c,
                (f) => f.type === "tunnel-closed" && f.id === "t-amb",
                5000,
            );
            expect(closed.reason).toBe("ambiguous-computer");
            expect(
                c.frames.find((f) => f.type === "tunnel-open" && f.id === "t-amb"),
            ).toBeUndefined();
        } finally {
            c.ws.terminate();
        }
    });

    it("a socket past the tunnel cap is refused with too-many-tunnels", async () => {
        const c = await connect();
        try {
            send(c, { id: 1, action: "auth:verify", params: { token: TOKEN } });
            await waitFor(c, (f) => f.id === 1);
            for (let n = 0; n < 32; n++) {
                send(c, { type: "remote:open", tunnelId: `t-cap-${n}`, computerId: "peer1" });
                await waitFor(
                    c,
                    (f) => f.type === "tunnel-open" && f.id === `t-cap-${n}`,
                    5000,
                );
            }
            send(c, { type: "remote:open", tunnelId: "t-cap-over", computerId: "peer1" });
            const closed = await waitFor(
                c,
                (f) => f.type === "tunnel-closed" && f.id === "t-cap-over",
                5000,
            );
            expect(closed.reason).toBe("too-many-tunnels");
        } finally {
            c.ws.terminate();
        }
    });
});
