// A host can hand the shell a daemon URL instead of a loopback port: the
// transport dials exactly that URL and speaks the same protocol over it.
import { describe, test, expect, afterEach } from "bun:test";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "net";
import { CraneTransport, craneEndpoint } from "../src/ws";

describe("craneEndpoint", () => {
    test("a port is the loopback daemon, a URL is used as given", () => {
        expect(craneEndpoint({ port: 47811 })).toBe("ws://127.0.0.1:47811");
        expect(craneEndpoint({ url: "wss://app.example.com/_crane" })).toBe("wss://app.example.com/_crane");
    });

    test("refuses anything that isn't a WebSocket address", () => {
        expect(() => craneEndpoint({ url: "https://app.example.com/_crane" })).toThrow(/WebSocket/);
        expect(() => craneEndpoint({ url: "not a url" })).toThrow(/isn't a URL/);
        expect(() => craneEndpoint({})).toThrow(/neither/);
        expect(() => craneEndpoint({ port: 70000 })).toThrow(/neither/);
    });
});

describe("CraneTransport with a daemon URL", () => {
    let server: WebSocketServer | null = null;
    afterEach(() => {
        server?.close();
        server = null;
    });

    test("connects to the URL's path and authenticates with the given token", async () => {
        const seen: { path: string; frames: any[] } = { path: "", frames: [] };
        server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
        await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
        server.on("connection", (ws, req) => {
            seen.path = req.url ?? "";
            ws.on("message", (raw) => {
                const frame = JSON.parse(String(raw));
                seen.frames.push(frame);
                const result = frame.action === "auth:verify" ? { success: true } : { echoed: frame.params?.value };
                ws.send(JSON.stringify({ type: "response", id: frame.id, result }));
            });
        });
        const port = (server.address() as AddressInfo).port;
        const transport = new CraneTransport({ computerId: "local" });
        transport.credentialProvider = async () => ({ url: `ws://127.0.0.1:${port}/_crane`, token: "pbw_test" });
        await transport.ensureConnected();
        const answer = await transport.call("test:echo", { value: "hi" });
        transport.close();
        expect(seen.path).toBe("/_crane");
        expect(seen.frames[0]).toMatchObject({ action: "auth:verify", params: { token: "pbw_test" } });
        expect(answer).toEqual({ echoed: "hi" });
    });
});
