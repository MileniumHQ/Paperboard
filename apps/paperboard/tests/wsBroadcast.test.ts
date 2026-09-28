// per-socket broadcast subscriptions (bun test): a socket that never declares
// events:subscribe receives no broadcast frames; interest is full-replace, and
// a "*" declaration opts into everything.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "net";
import { setupWebSocketServer } from "../papercrane/ws";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";

let tmp = "";
let wss: WebSocketServer;
let port = 0;

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-wsb-"));
    const engine = new PaperCraneEngine(tmp);
    const auth = new PaperCraneAuth(true, tmp);
    wss = new WebSocketServer({ port: 0 });
    setupWebSocketServer(wss, engine, auth, {});
    await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
    port = (wss.address() as AddressInfo).port;
});

afterAll(() => {
    try {
        for (const client of wss.clients) client.terminate();
        wss.close();
    } catch (err) {
        console.debug("[test] ws already closed:", String(err));
    }
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
        ws.on("message", (raw: Buffer) => frames.push(JSON.parse(raw.toString("utf8"))));
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

describe("events:subscribe broadcast filtering", () => {
    it("only subscribed sockets receive broadcasts; a bare socket receives none", async () => {
        const a = await connect();
        const b = await connect();

        // exact-name interest: only "actions:dev.x:boom"
        send(a, { id: 1, action: "events:subscribe", params: { events: ["actions:dev.x:boom"] } });
        await waitFor(a, (f) => f.id === 1 && !f.error);

        // A emits two events; the daemon fans out to subscribers only
        send(a, { id: 2, action: "actions:emit", params: { panelId: "dev.x", event: "other" } });
        send(a, { id: 3, action: "actions:emit", params: { panelId: "dev.x", event: "boom" } });
        await waitFor(a, (f) => f.type === "event" && f.event === "actions:dev.x:boom");

        const aOther = a.frames.find(
            (f) => f.type === "event" && f.event === "actions:dev.x:other",
        );
        expect(aOther).toBeUndefined();

        await new Promise((r) => setTimeout(r, 100));
        expect(b.frames.filter((f) => f.type === "event")).toHaveLength(0);

        a.ws.terminate();
        b.ws.terminate();
    });

    it("a socket may declare the specific interpolated name", async () => {
        const a = await connect();
        send(a, {
            id: 1,
            action: "events:subscribe",
            params: { events: ["actions:dev.x:boom"] },
        });
        await waitFor(a, (f) => f.id === 1 && !f.error);

        send(a, { id: 2, action: "actions:emit", params: { panelId: "dev.x", event: "boom" } });
        await waitFor(a, (f) => f.type === "event" && f.event === "actions:dev.x:boom");

        // the unscoped all-panels channel no longer exists
        expect(
            a.frames.find((f) => f.type === "event" && f.event === "actions:event"),
        ).toBeUndefined();

        a.ws.terminate();
    });

    it("* opts into every broadcast event", async () => {
        const a = await connect();
        send(a, { id: 1, action: "events:subscribe", params: { events: ["*"] } });
        await waitFor(a, (f) => f.id === 1 && !f.error);

        send(a, { id: 2, action: "actions:emit", params: { panelId: "dev.y", event: "pulse" } });
        await waitFor(a, (f) => f.type === "event" && f.event === "actions:dev.y:pulse");

        a.ws.terminate();
    });

    it("subscribe is full-replace: removing interest stops delivery", async () => {
        const a = await connect();
        send(a, { id: 1, action: "events:subscribe", params: { events: ["actions:dev.z:e"] } });
        await waitFor(a, (f) => f.id === 1 && !f.error);

        send(a, { id: 2, action: "actions:emit", params: { panelId: "dev.z", event: "e" } });
        await waitFor(a, (f) => f.type === "event" && f.event === "actions:dev.z:e");

        // empty declaration = unsubscribe from everything
        send(a, { id: 3, action: "events:subscribe", params: { events: [] } });
        await waitFor(a, (f) => f.id === 3 && !f.error);

        send(a, { id: 4, action: "actions:emit", params: { panelId: "dev.z", event: "e" } });
        await new Promise((r) => setTimeout(r, 100));
        const afterUnsub = a.frames.filter(
            (f) => f.type === "event" && f.event === "actions:dev.z:e",
        );
        expect(afterUnsub).toHaveLength(1);

        a.ws.terminate();
    });

    it("rejects oversized declarations with INVALID_PARAMS", async () => {
        const a = await connect();
        const events = Array.from({ length: 513 }, (_, i) => `evt:${i}`);
        send(a, { id: 1, action: "events:subscribe", params: { events } });
        const resp = await waitFor(a, (f) => f.id === 1);
        expect(resp.error).toBeTruthy();
        expect(resp.code).toBe("INVALID_PARAMS");
        a.ws.terminate();
    });
});