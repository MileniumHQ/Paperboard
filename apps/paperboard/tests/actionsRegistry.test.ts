// registration namespace ownership (bun test): a name registered by one socket
// cannot be overwritten or unregistered by a different socket — the daemon
// replies with a typed CONFLICT instead of silently replacing the entry.
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

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-actionreg-"));
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

describe("registration namespace ownership", () => {
    it("a second socket cannot register a name owned by another socket (CONFLICT)", async () => {
        const a = await connect();
        const b = await connect();
        try {
            send(a, { id: 1, action: "actions:register", params: { panelId: "dev.one", action: "run" } });
            await waitFor(a, (f) => f.id === 1 && !f.error);

            send(b, { id: 2, action: "actions:register", params: { panelId: "dev.one", action: "run" } });
            const resp = await waitFor(b, (f) => f.id === 2);
            expect(resp.error).toBeTruthy();
            expect(resp.code).toBe("CONFLICT");

            // the original owner still holds the name
            const listed = actionsRegistry.list("dev.one");
            expect(listed).toHaveLength(1);
            expect(listed[0].action).toBe("run");
        } finally {
            a.ws.terminate();
            b.ws.terminate();
        }
    });

    it("the owning socket may re-register the same name (idempotent update)", async () => {
        const a = await connect();
        try {
            send(a, { id: 1, action: "actions:register", params: { panelId: "dev.two", action: "run" } });
            await waitFor(a, (f) => f.id === 1 && !f.error);

            send(a, { id: 2, action: "actions:register", params: { panelId: "dev.two", action: "run" } });
            const resp = await waitFor(a, (f) => f.id === 2);
            expect(resp.result).toEqual({ success: true });
        } finally {
            a.ws.terminate();
        }
    });

    it("registerMultiple is atomic: one conflict refuses the whole batch", async () => {
        const a = await connect();
        const b = await connect();
        try {
            send(a, { id: 1, action: "actions:register", params: { panelId: "dev.three", action: "keep" } });
            await waitFor(a, (f) => f.id === 1 && !f.error);

            send(b, { id: 2, action: "actions:register", params: { panelId: "dev.three", actions: ["fresh", "keep"] } });
            const resp = await waitFor(b, (f) => f.id === 2);
            expect(resp.code).toBe("CONFLICT");

            const listed = actionsRegistry.list("dev.three");
            expect(listed.map((l) => l.action)).toEqual(["keep"]);
        } finally {
            a.ws.terminate();
            b.ws.terminate();
        }
    });

    it("a non-owning socket cannot unregister another socket's action", async () => {
        const a = await connect();
        const b = await connect();
        try {
            send(a, { id: 1, action: "actions:register", params: { panelId: "dev.four", action: "run" } });
            await waitFor(a, (f) => f.id === 1 && !f.error);

            send(b, { id: 2, action: "actions:unregister", params: { panelId: "dev.four", action: "run" } });
            const resp = await waitFor(b, (f) => f.id === 2);
            expect(resp.code).toBe("CONFLICT");

            expect(actionsRegistry.list("dev.four")).toHaveLength(1);
        } finally {
            a.ws.terminate();
            b.ws.terminate();
        }
    });

    it("the owning socket can unregister its own action", async () => {
        const a = await connect();
        try {
            send(a, { id: 1, action: "actions:register", params: { panelId: "dev.five", action: "run" } });
            await waitFor(a, (f) => f.id === 1 && !f.error);

            send(a, { id: 2, action: "actions:unregister", params: { panelId: "dev.five", action: "run" } });
            const resp = await waitFor(a, (f) => f.id === 2);
            expect(resp.result).toEqual({ success: true });
            expect(actionsRegistry.list("dev.five")).toHaveLength(0);
        } finally {
            a.ws.terminate();
        }
    });

    it("triggers are owned like actions", async () => {
        const a = await connect();
        const b = await connect();
        try {
            send(a, { id: 1, action: "triggers:register", params: { panelId: "dev.six", trigger: "webhook" } });
            await waitFor(a, (f) => f.id === 1 && !f.error);

            send(b, { id: 2, action: "triggers:register", params: { panelId: "dev.six", trigger: "webhook" } });
            const resp = await waitFor(b, (f) => f.id === 2);
            expect(resp.code).toBe("CONFLICT");

            send(b, { id: 3, action: "triggers:unregister", params: { panelId: "dev.six", trigger: "webhook" } });
            const unreg = await waitFor(b, (f) => f.id === 3);
            expect(unreg.code).toBe("CONFLICT");

            expect(actionsRegistry.listTriggers("dev.six")).toHaveLength(1);
        } finally {
            a.ws.terminate();
            b.ws.terminate();
        }
    });

    it("closing the owner socket frees the name for a new registration", async () => {
        const a = await connect();
        send(a, { id: 1, action: "actions:register", params: { panelId: "dev.seven", action: "run" } });
        await waitFor(a, (f) => f.id === 1 && !f.error);
        a.ws.terminate();
        await new Promise((r) => setTimeout(r, 50));

        const b = await connect();
        try {
            send(b, { id: 2, action: "actions:register", params: { panelId: "dev.seven", action: "run" } });
            const resp = await waitFor(b, (f) => f.id === 2);
            expect(resp.result).toEqual({ success: true });
        } finally {
            b.ws.terminate();
        }
    });
});