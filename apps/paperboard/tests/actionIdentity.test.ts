// Action and trigger identity over the real wire (bun test): the namespace
// a scoped socket writes to is its token claim, an action_reply only
// settles a call it was dispatched, and `internal` actions answer only
// their own panel (or the host). Real WS server, real auth, real tokens.
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
let auth: PaperCraneAuth;
let port = 0;
const HOST = "pc_actions_identity_host";

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-action-identity-"));
    const engine = new PaperCraneEngine(tmp);
    auth = new PaperCraneAuth(false, tmp);
    auth.injectToken(HOST, "host");
    wss = new WebSocketServer({ port: 0 });
    setupWebSocketServer(wss, engine, auth, {});
    await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
    port = (wss.address() as AddressInfo).port;
});

afterAll(() => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    auth.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
});

interface Client {
    ws: WebSocket;
    frames: any[];
}

async function connect(token: string): Promise<Client> {
    const frames: any[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("message", (raw: Buffer) => frames.push(JSON.parse(raw.toString("utf8"))));
    await new Promise<void>((resolve, reject) => {
        ws.on("open", () => resolve());
        ws.on("error", reject);
    });
    const client = { ws, frames };
    send(client, { id: "auth", action: "auth:verify", params: { token } });
    const res = await waitFor(client, (f) => f.id === "auth");
    if (res.error) throw new Error(res.error);
    return client;
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

describe("scoped sockets write only their own namespace", () => {
    it("registering an action under another panel's id is refused FORBIDDEN", async () => {
        const a = await connect(auth.issuePanelToken("panel.alpha"));
        try {
            send(a, { id: 1, action: "actions:register", params: { panelId: "panel.beta", action: "run" } });
            const res = await waitFor(a, (f) => f.id === 1);
            expect(res.code).toBe("FORBIDDEN");
            send(a, { id: 2, action: "actions:register", params: { panelId: "panel.alpha", action: "run" } });
            expect((await waitFor(a, (f) => f.id === 2)).result).toEqual({ success: true });
        } finally {
            a.ws.terminate();
        }
    });

    it("emitting another panel's trigger or event is refused, and nothing is broadcast", async () => {
        const a = await connect(auth.issuePanelToken("panel.alpha"));
        const listener = await connect(HOST);
        try {
            send(listener, { id: "sub", action: "events:subscribe", params: { events: ["*"] } });
            await waitFor(listener, (f) => f.id === "sub");
            send(a, { id: 1, action: "triggers:emit", params: { panelId: "panel.beta", trigger: "fire", output: 1 } });
            send(a, { id: 2, action: "actions:emit", params: { panelId: "panel.beta", event: "fire", payload: 1 } });
            expect((await waitFor(a, (f) => f.id === 1)).code).toBe("FORBIDDEN");
            expect((await waitFor(a, (f) => f.id === 2)).code).toBe("FORBIDDEN");
            send(a, { id: 3, action: "triggers:emit", params: { panelId: "panel.alpha", trigger: "fire", output: 2 } });
            await waitFor(listener, (f) => f.type === "event" && f.event === "triggers:panel.alpha:fire");
            expect(listener.frames.some((f) => f.type === "event" && String(f.event).includes("panel.beta"))).toBe(false);
        } finally {
            a.ws.terminate();
            listener.ws.terminate();
        }
    });
});

describe("action replies and internal actions", () => {
    it("only the called socket can settle a call; the caller learns who is calling", async () => {
        const target = await connect(auth.issuePanelToken("panel.target"));
        const caller = await connect(auth.issuePanelToken("panel.caller"));
        const spoofer = await connect(auth.issuePanelToken("panel.spoofer"));
        try {
            send(target, { id: 1, action: "actions:register", params: { panelId: "panel.target", action: "ping" } });
            await waitFor(target, (f) => f.id === 1);
            send(caller, { id: 2, action: "actions:call", params: { panelId: "panel.target", action: "ping" } });
            const call = await waitFor(target, (f) => f.type === "action_call");
            expect(call.caller).toEqual({ panelId: "panel.caller" });
            // a different authenticated socket cannot answer it
            send(spoofer, { type: "action_reply", callId: call.callId, result: "forged" });
            await new Promise((r) => setTimeout(r, 50));
            expect(caller.frames.some((f) => f.id === 2)).toBe(false);
            send(target, { type: "action_reply", callId: call.callId, result: "real" });
            expect((await waitFor(caller, (f) => f.id === 2)).result).toEqual({ result: "real" });
        } finally {
            target.ws.terminate();
            caller.ws.terminate();
            spoofer.ws.terminate();
        }
    });

    it("internal actions refuse other panels but answer their own panel and the host", async () => {
        const owner = await connect(auth.issuePanelToken("panel.secretive"));
        const ownUi = await connect(auth.issuePanelToken("panel.secretive"));
        const other = await connect(auth.issuePanelToken("panel.nosy"));
        const host = await connect(HOST);
        try {
            send(owner, {
                id: 1,
                action: "actions:register",
                params: { panelId: "panel.secretive", action: "testProvider", schema: { id: "testProvider", internal: true } },
            });
            await waitFor(owner, (f) => f.id === 1);
            owner.ws.on("message", (raw: Buffer) => {
                const m = JSON.parse(raw.toString("utf8"));
                if (m.type === "action_call") owner.ws.send(JSON.stringify({ type: "action_reply", callId: m.callId, result: "ok" }));
            });

            send(other, { id: 2, action: "actions:call", params: { panelId: "panel.secretive", action: "testProvider" } });
            expect((await waitFor(other, (f) => f.id === 2)).code).toBe("FORBIDDEN");
            expect(owner.frames.some((f) => f.type === "action_call")).toBe(false);

            send(ownUi, { id: 3, action: "actions:call", params: { panelId: "panel.secretive", action: "testProvider" } });
            expect((await waitFor(ownUi, (f) => f.id === 3)).result).toEqual({ result: "ok" });
            send(host, { id: 4, action: "actions:call", params: { panelId: "panel.secretive", action: "testProvider" } });
            expect((await waitFor(host, (f) => f.id === 4)).result).toEqual({ result: "ok" });
        } finally {
            for (const c of [owner, ownUi, other, host]) c.ws.terminate();
        }
    });
});
