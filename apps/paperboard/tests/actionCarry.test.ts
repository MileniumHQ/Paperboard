// Only the socket an action call was sent to may carry it (bun test, real
// daemon sockets). A service that asks for a backup of its own panel names
// the call it is answering (duringCall); the daemon answers that call for it
// once the backup has stopped the service. Another connection naming the
// call must not be able to hold or answer it.
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
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-actioncarry-"));
    const engine = new PaperCraneEngine(tmp);
    const auth = new PaperCraneAuth(true, tmp);
    wss = new WebSocketServer({ port: 0 });
    setupWebSocketServer(wss, engine, auth, {});
    await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
    port = (wss.address() as AddressInfo).port;
});

afterAll(() => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    fs.rmSync(tmp, { recursive: true, force: true });
});

interface Client { ws: WebSocket; frames: any[] }

function connect(): Promise<Client> {
    return new Promise((resolve, reject) => {
        const frames: any[] = [];
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.on("message", (raw: Buffer) => frames.push(JSON.parse(raw.toString("utf8"))));
        ws.on("open", () => resolve({ ws, frames }));
        ws.on("error", reject);
    });
}

const send = (client: Client, obj: unknown) => client.ws.send(JSON.stringify(obj));

async function waitFor(client: Client, pred: (f: any) => boolean): Promise<any> {
    const start = Date.now();
    while (!client.frames.some(pred)) {
        if (Date.now() - start > 3000) throw new Error("waitFor timeout");
        await new Promise((r) => setTimeout(r, 5));
    }
    return client.frames.find(pred);
}

describe("carrying an action call", () => {
    it("is refused to a connection the call was not sent to, and ignored once the call is over", async () => {
        const service = await connect();
        const caller = await connect();
        const other = await connect();
        try {
            send(service, { id: 1, action: "actions:register", params: { panelId: "dev.carry", action: "run" } });
            await waitFor(service, (f) => f.id === 1 && !f.error);
            send(caller, { id: 1, action: "actions:call", params: { panelId: "dev.carry", action: "run", args: [] } });
            const call = await waitFor(service, (f) => f.type === "action_call");

            send(other, { id: 2, action: "backup:create", params: { panelId: "dev.carry", duringCall: call.callId } });
            const refused = await waitFor(other, (f) => f.id === 2);
            expect(refused.code).toBe("FORBIDDEN");
            expect(refused.error).toContain("not sent to this connection");

            // answered: the call is over, so naming it carries nothing and the
            // backup fails on its own terms (no location chosen)
            send(service, { type: "action_reply", callId: call.callId, result: "done" });
            await waitFor(caller, (f) => f.id === 1 && f.result?.result === "done");
            send(service, { id: 3, action: "backup:create", params: { panelId: "dev.carry", duringCall: call.callId } });
            const late = await waitFor(service, (f) => f.id === 3);
            expect(late.code).toBe("CONFLICT");
        } finally {
            service.ws.terminate();
            caller.ws.terminate();
            other.ws.terminate();
        }
    });
});
