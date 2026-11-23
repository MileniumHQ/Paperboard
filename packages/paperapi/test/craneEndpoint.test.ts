// A host can hand the shell a daemon URL instead of a loopback port: the
// transport dials exactly that URL and speaks the same protocol over it.
import { describe, test, expect, afterAll, afterEach, beforeEach, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "net";
import { captureServiceBootContext } from "../src/boot";
import { closeTransport } from "../src/ipc";
import { CraneTransport } from "../src/ws";
import { startDaemon, type Daemon } from "./helpers/daemon";

setDefaultTimeout(30_000);

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
});
