import { test, expect } from "bun:test";
import * as http from "node:http";
import { createHmac } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WebSocketServer } from "ws";
import { PaperCraneClient } from "../src/main/communication/papercrane/PaperCraneClient";
import { startPaperCraneServer } from "../papercrane/index";
import { craneHandshakePath, readCraneHandshake } from "../papercrane/handshake";

const staleToken = "pc_" + "d".repeat(48);
const replay = createHmac("sha256", staleToken).update(`papercrane-local-proof-v1\n${"a".repeat(64)}`).digest("hex");
for (const proof of [undefined, "0".repeat(64), replay]) {
    test(`a stale-port fake health listener never receives the master token (proof=${proof?.slice(0, 14) ?? "absent"})`, async () => {
        const token = staleToken;
        const seen: string[] = [];
        const fake = http.createServer((_req, res) => { res.writeHead(200); res.end("healthy"); });
        const wss = new WebSocketServer({ server: fake });
        wss.on("connection", ws => {
            if (proof) ws.send(JSON.stringify({ type: "daemon-proof", proof }));
            ws.on("message", raw => {
                seen.push(String(raw));
                const msg = JSON.parse(String(raw));
                ws.send(JSON.stringify({ type: "response", id: msg.id, result: { success: true } }));
            });
        });
        const client = new PaperCraneClient();
        try {
            await new Promise<void>(resolve => fake.listen(0, "127.0.0.1", resolve));
            const port = (fake.address() as import("net").AddressInfo).port;
            fs.writeFileSync(craneHandshakePath(), JSON.stringify({ port, token }), { mode: 0o600 });
            expect((await client.connect("127.0.0.1")).connected).toBe(true);
            expect(seen.some(frame => frame.includes(token))).toBe(false);
            expect(client.getEmbeddedServer()).not.toBeNull();
            expect(client.getToken()).not.toBe(token);
        } finally {
            client.disconnect(); client.stopEmbeddedServer();
            for (const ws of wss.clients) ws.terminate();
            wss.close();
            await new Promise<void>(resolve => fake.close(() => resolve()));
        }
    });
}

test("an embedded restart rejects the previous daemon token", async () => {
    fs.rmSync(craneHandshakePath(), { force: true });
    const client = new PaperCraneClient();
    const obsolete = new PaperCraneClient();
    try {
        await client.connect("127.0.0.1");
        const previous = client.getToken()!;
        client.disconnect(); client.stopEmbeddedServer();
        await client.connect("127.0.0.1");
        let accepted = false;
        try { await obsolete.connect("127.0.0.1", client.getPort(), previous); accepted = true; }
        catch (err) { expect(String(err)).toMatch(/refused|sign in|pair/i); }
        expect(accepted).toBe(false);
        expect(client.getToken()).not.toBe(previous);
    } finally { obsolete.disconnect(); client.disconnect(); client.stopEmbeddedServer(); }
});

test("stop removes only its own crane.json and tears down its exit hooks", async () => {
    const before = ["exit", "SIGTERM", "SIGINT"].map(signal => process.listenerCount(signal));
    const first = await startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });
    let second: Awaited<ReturnType<typeof startPaperCraneServer>> | undefined;
    try {
        second = await startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });
        first.stop();
        expect(readCraneHandshake()?.port).toBe(second.localPort);
        second.stop();
        expect(fs.existsSync(craneHandshakePath())).toBe(false);
        expect(["exit", "SIGTERM", "SIGINT"].map(signal => process.listenerCount(signal))).toEqual(before);
    } finally { first.stop(); second?.stop(); }
});

test("a verified local daemon is reused without starting another embedded daemon", async () => {
    const daemon = await startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });
    const client = new PaperCraneClient();
    try {
        expect(client.getLocalCredentials()).toBeNull();
        expect((await client.connect("127.0.0.1")).connected).toBe(true);
        expect(client.getLocalCredentials()).toEqual({ port: daemon.localPort, token: client.getToken()! });
        expect(client.getEmbeddedServer()).toBeNull();
        expect(client.getPort()).toBe(daemon.localPort);
        expect(await client.call("system:info")).toHaveProperty("service", "papercrane");
        client.disconnect();
        expect(client.getLocalCredentials()).toBeNull();
    } finally { client.disconnect(); daemon.stop(); }
});

test("SIGTERM removes the standalone daemon's crane.json", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-handshake-exit-"));
    const file = path.join(root, "local/crane.json");
    const child = Bun.spawn([process.execPath, "papercrane/main.ts", "--headless", "--host", "127.0.0.1", "--port", "0"], { env: { ...process.env, PAPERBOARD_DIR: root }, stdout: "pipe", stderr: "pipe" });
    const output = new Response(child.stdout).text();
    const errors = new Response(child.stderr).text();
    try {
        const deadline = Date.now() + 5000;
        while (!fs.existsSync(file)) {
            if (child.exitCode !== null || Date.now() > deadline) throw new Error("standalone daemon did not start");
            await Bun.sleep(10);
        }
        child.kill("SIGTERM");
        await child.exited;
        expect(fs.existsSync(file)).toBe(false);
    } finally {
        child.kill(); await child.exited; await output; await errors;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("process exit removes the embedded daemon's crane.json", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-handshake-exit-"));
    const child = Bun.spawn([process.execPath, "-e", 'import { startPaperCraneServer } from "./papercrane/index"; await startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false }); process.exit(0);'], { env: { ...process.env, PAPERBOARD_DIR: root }, stdout: "pipe", stderr: "pipe" });
    try {
        const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect({ code, err }).toEqual({ code: 0, err: "" });
        expect(out).toContain("Listening on");
        expect(fs.existsSync(path.join(root, "local/crane.json"))).toBe(false);
    } finally { child.kill(); await child.exited; fs.rmSync(root, { recursive: true, force: true }); }
});

test("handshake cleanup failure reaches the client while still closing the daemon", async () => {
    const client = new PaperCraneClient();
    try {
        await client.connect("127.0.0.1");
        const port = client.getPort();
        fs.writeFileSync(craneHandshakePath(), "{broken");
        expect(() => client.stopEmbeddedServer()).toThrow();
        await expect(fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
    } finally {
        client.disconnect();
        fs.rmSync(craneHandshakePath(), { force: true });
        client.stopEmbeddedServer();
    }
});
