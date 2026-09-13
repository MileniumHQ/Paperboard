// Client protocol parity (bun test): the two WS clients that speak the
// same daemon protocol share one invariant — token LAST (a params object
// carrying a token field can never clobber the real credential) and one
// wire version from a constant. Regression test for the polarity drift
// where PaperCraneClient spread token first while PaperAPI spread it last.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "net";
import { PaperCraneClient } from "../src/main/communication/papercrane/PaperCraneClient";
import { PROTOCOL_VERSION } from "../papercrane/protocol";

const ROOT = path.join(import.meta.dir, "..", "..", "..");

let wss: WebSocketServer;
let port = 0;
const seen: { action?: string; params?: any }[] = [];

beforeAll(async () => {
    wss = new WebSocketServer({ port: 0 });
    wss.on("connection", (sock: WebSocket) => {
        sock.on("message", (raw: Buffer) => {
            try {
                const m = JSON.parse(raw.toString("utf8"));
                seen.push({ action: m.action, params: m.params });
                sock.send(JSON.stringify({ type: "response", id: m.id, result: { success: true } }));
            } catch (err) {
                console.debug("[test] fake daemon parse failed:", String(err));
            }
        });
    });
    await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
    port = (wss.address() as AddressInfo).port;
});

afterAll(() => {
    for (const client of wss.clients) client.terminate();
    wss.close();
});

describe("client protocol parity", () => {
    it("a params token field cannot clobber the real credential", async () => {
        seen.length = 0;
        const client = new PaperCraneClient();
        try {
            await client.connect("127.0.0.1", port, "real-token");
            await client.call("term:exists", { id: "t1", token: "evil-token" } as any);
            const frame = seen.find((s) => s.action === "term:exists");
            expect(frame?.params?.token).toBe("real-token");
            expect(frame?.params?.id).toBe("t1");
        } finally {
            client.disconnect();
            client.stopEmbeddedServer();
        }
    });

    it("PaperCraneClient speaks the shared protocol version", async () => {
        seen.length = 0;
        const client = new PaperCraneClient();
        try {
            await client.connect("127.0.0.1", port, "real-token");
            await client.call("term:exists", { id: "t1" });
            const frame = seen.find((s) => s.action === "term:exists");
            expect(frame?.params?.v).toBe(PROTOCOL_VERSION);
        } finally {
            client.disconnect();
            client.stopEmbeddedServer();
        }
    });

    it("PaperAPI's protocol constant matches the daemon's", () => {
        const source = fs.readFileSync(
            path.join(ROOT, "packages", "paperapi", "src", "protocol.ts"),
            "utf8",
        );
        const m = /PROTOCOL_VERSION\s*=\s*(\d+)/.exec(source);
        expect(m?.[1]).toBe(String(PROTOCOL_VERSION));
        // and PaperAPI sends it token-last at the call site
        const wsSource = fs.readFileSync(
            path.join(ROOT, "packages", "paperapi", "src", "ws.ts"),
            "utf8",
        );
        expect(wsSource).toContain("{ ...params, token: this.token, v: PROTOCOL_VERSION }");
    });
});
