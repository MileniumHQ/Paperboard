// A host can hand the shell a daemon URL instead of a loopback port: the
// transport dials exactly that URL and speaks the same protocol over it.
import { describe, test, expect, afterAll, afterEach, beforeEach, setDefaultTimeout } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { AddressInfo } from "net";
import { captureServiceBootContext } from "../src/boot";
import { closeTransport } from "../src/ipc";
import { CraneTransport, craneEndpoint } from "../src/ws";
import { startDaemon, type Daemon } from "./helpers/daemon";

setDefaultTimeout(30_000);

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
                const result = frame.action === "auth:verify" ? { success: true } : { data: frame.params?.id };
                ws.send(JSON.stringify({ type: "response", id: frame.id, result }));
            });
        });
        const port = (server.address() as AddressInfo).port;
        const transport = new CraneTransport({ computerId: "local" });
        transport.credentialProvider = async () => ({ url: `ws://127.0.0.1:${port}/_crane`, token: "pbw_test" });
        await transport.ensureConnected();
        const answer = await transport.call("config:get", { id: "dev.echo" });
        transport.close();
        expect(seen.path).toBe("/_crane");
        expect(seen.frames[0]).toMatchObject({ action: "auth:verify", params: { token: "pbw_test" } });
        expect(answer).toEqual({ data: "dev.echo" });
    });
});

// A Node script finds the daemon through crane.json, which holds the host
// token: the token only goes to a listener that proves it holds it, and a
// process the daemon started as a service never falls back to that file.
describe("CraneTransport with the local handshake file", () => {
    let work: string;
    let fake: WebSocketServer | null = null;
    let daemon: Daemon | null = null;
    beforeEach(() => {
        work = mkdtempSync(join(tmpdir(), "paperapi-handshake-"));
    });
    afterEach(async () => {
        if (fake) {
            for (const client of fake.clients) client.terminate();
            await new Promise<void>((resolve) => fake!.close(() => resolve()));
            fake = null;
        }
        for (const name of ["PAPERBOARD_PANEL_ID", "PAPERCRANE_PORT"]) delete process.env[name];
        captureServiceBootContext();
        rmSync(work, { recursive: true, force: true });
    });
    afterAll(async () => {
        closeTransport();
        await daemon?.stop();
    });

    // a listener that answers the challenge with a proof it can't make, and records what reaches it
    async function impostor(): Promise<{ port: number; connections: number; received: string[] }> {
        fake = new WebSocketServer({ host: "127.0.0.1", port: 0 });
        await new Promise<void>((resolve) => fake!.once("listening", () => resolve()));
        const seen = { port: (fake.address() as AddressInfo).port, connections: 0, received: [] as string[] };
        fake.on("connection", (ws) => {
            seen.connections++;
            ws.on("message", (raw) => seen.received.push(String(raw)));
            ws.send(JSON.stringify({ type: "daemon-proof", proof: "0".repeat(64) }));
        });
        return seen;
    }

    function handshake(port: number): string {
        const file = join(work, "crane.json");
        writeFileSync(file, JSON.stringify({ port, token: "host-secret" }));
        return file;
    }

    test("the host token is never sent to a listener that cannot prove it holds it", async () => {
        const listener = await impostor();
        const transport = new CraneTransport({ computerId: "local", craneJsonPath: handshake(listener.port) });
        try {
            await expect(transport.ensureConnected()).rejects.toThrow(`could not prove it is the Paperboard that wrote ${join(work, "crane.json")}`);
        } finally {
            transport.close();
        }
        expect(listener.connections).toBe(1);
        expect(listener.received).toEqual([]);
    });

    test("the daemon proves itself and the script signs in with the handshake's token", async () => {
        daemon = await startDaemon();
        const transport = new CraneTransport({ computerId: "local" });
        try {
            await transport.ensureConnected();
            expect(transport.isConnected()).toBe(true);
        } finally {
            transport.close();
        }
    });

    test("a process started as a panel's service without its full boot context fails instead of reading crane.json", async () => {
        const listener = await impostor();
        process.env.PAPERBOARD_PANEL_ID = "dev.test.half-booted";
        process.env.PAPERCRANE_PORT = String(listener.port);
        captureServiceBootContext();
        const transport = new CraneTransport({ computerId: "local", craneJsonPath: handshake(listener.port) });
        try {
            await expect(transport.ensureConnected()).rejects.toThrow("This process was started as dev.test.half-booted's service, but PAPERCRANE_PANEL_TOKEN is not set");
        } finally {
            transport.close();
        }
        expect(listener.connections).toBe(0);
    });

    // Inventory: Core contracts — a socket the transport dropped can't take down the one that replaced it.
    test("a refused socket's close, heard after the next socket is up, leaves that socket and its calls alone", async () => {
        // a daemon that proves itself, refuses the first sign-in and answers
        // the second socket's read when the test says
        fake = new WebSocketServer({ host: "127.0.0.1", port: 0 });
        await new Promise<void>((resolve) => fake!.once("listening", () => resolve()));
        const sockets: WebSocket[] = [];
        let firstClosed!: Promise<void>;
        let reply!: (content: string) => void;
        const asked = new Promise<void>((heard) => {
            fake!.on("connection", (ws, req) => {
                const conn = sockets.push(ws) - 1;
                if (conn === 0) firstClosed = new Promise((done) => ws.once("close", () => done()));
                const challenge = String(req.headers["x-papercrane-challenge"]);
                ws.send(JSON.stringify({ type: "daemon-proof", proof: createHmac("sha256", "host-secret").update(`papercrane-local-proof-v1\n${challenge}`).digest("hex") }));
                ws.on("message", (raw) => {
                    const msg = JSON.parse(String(raw));
                    if (msg.action === "auth:verify" && conn === 0) {
                        ws.send(JSON.stringify({ type: "response", id: msg.id, error: "not signed in" }));
                        // the closing handshake waits: the refused socket's
                        // close comes once the next socket is in use
                        (ws as unknown as { _socket: { pause(): void } })._socket.pause();
                    } else if (msg.action === "auth:verify") {
                        ws.send(JSON.stringify({ type: "response", id: msg.id, result: { ok: true } }));
                    } else if (msg.action === "file:read") {
                        reply = (content) => ws.send(JSON.stringify({ type: "response", id: msg.id, result: { content } }));
                        heard();
                    }
                });
            });
        });
        const transport = new CraneTransport({ computerId: "local", craneJsonPath: handshake((fake.address() as AddressInfo).port) });
        try {
            const refused = await transport.ensureConnected().then(() => null, (err: Error) => err.message);
            expect(refused).toBe("not signed in");
            const read = transport.call("file:read", { targetPath: "a.txt" });
            await asked;
            (sockets[0] as unknown as { _socket: { resume(): void } })._socket.resume();
            await firstClosed;
            // quiet: the client hears the first socket's close in the same loopback turn; this leaves it room to
            await new Promise((later) => setTimeout(later, 50));
            reply("kept");
            expect(await read).toEqual({ content: "kept" });
            expect(transport.isConnected()).toBe(true);
            expect(sockets).toHaveLength(2);
        } finally {
            transport.close();
        }
    });
});
