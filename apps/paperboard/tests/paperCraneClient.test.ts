// PaperCraneClient wire-shape regression (bun test): token-last params and
// protocol-version parity with PaperAPI's CraneTransport. Stream tracking
// lives in PaperAPI now; the app client only serves the updater surface.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "net";
import { PaperCraneClient } from "../src/main/communication/papercrane/PaperCraneClient";
import { PROTOCOL_VERSION } from "../papercrane/protocol";

let wss: WebSocketServer;
let port = 0;
const seen: { action?: string; params?: any }[] = [];

beforeAll(async () => {
    await new Promise<void>((resolve) => {
        wss = new WebSocketServer({ port: 0 }, () => {
            port = (wss.address() as AddressInfo).port;
            resolve();
        });
    });
    wss.on("connection", (ws: WebSocket) => {
        ws.on("message", (raw: unknown) => {
            const msg = JSON.parse((raw as Buffer).toString("utf8"));
            seen.push(msg);
            ws.send(
                JSON.stringify({
                    type: "response",
                    id: msg.id,
                    result: { ok: true },
                }),
            );
        });
    });
});

afterAll(() => {
    for (const client of wss.clients) client.terminate();
    wss.close();
});

describe("PaperCraneClient wire shape", () => {
    it("a daemon response without a valid count is unavailable, never zero", async () => {
        const client = new PaperCraneClient();
        try {
            await client.connect("127.0.0.1", port, "tok");
            await expect(client.runningServiceCount()).rejects.toThrow("invalid running panel count");
        } finally {
            client.disconnect();
        }
    });

    it("sends token last and carries the protocol version from the shared constant", async () => {
        const client = new PaperCraneClient();
        try {
            await client.connect("127.0.0.1", port, "tok");
            await client.call("system:info");
            const frame = seen.find((s) => s.action === "system:info");
            expect(frame).toBeDefined();
            // the token cannot be clobbered by a params field of the same name
            expect(frame?.params?.token).toBe("tok");
            expect(frame?.params?.v).toBe(PROTOCOL_VERSION);
        } finally {
            client.disconnect();
        }
    });

    it("a params token field cannot impersonate the credential", async () => {
        const client = new PaperCraneClient();
        try {
            await client.connect("127.0.0.1", port, "real-token");
            await client.call("system:info", { token: "evil-token" } as any);
            const frame = seen.find((s) => s.action === "system:info" && s.params?.token === "real-token");
            expect(frame).toBeDefined();
            expect(frame?.params?.token).toBe("real-token");
        } finally {
            client.disconnect();
        }
    });
});
