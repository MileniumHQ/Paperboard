import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as net from "node:net";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { BUILD_TIMEOUT_MS, buildCrane, REPO_DIR } from "../platform/app/support/build";
import { CraneSocket, startCrane, WAIT_MS, watch, type RunningCrane } from "../platform/app/support/crane";
import { tempDataDir } from "../platform/app/support/temp";

const PANEL = "dev.paperboard.monitored";
const SECRETS = ["hunter2-config-value", "s3cr3t-vault-value", "env-secret-value"];

let daemon: RunningCrane;
let host: CraneSocket;
let panelToken: string;
beforeAll(async () => {
    const crane = await buildCrane();
    daemon = await startCrane(crane.file, tempDataDir("monitor"));
    host = await CraneSocket.authed(daemon.handshake.port, daemon.handshake.token);
    panelToken = (await host.call("auth:panel-token", { panelId: PANEL })).token;
}, BUILD_TIMEOUT_MS);
afterAll(async () => {
    host?.close();
    await daemon?.stop();
});

// A WebSocket client on a plain TCP socket, so the test can stop reading
// from it the way a stuck watcher does.
class RawSocket {
    private buffer = Buffer.alloc(0);
    private waiting: { id: number; resolve: () => void } | null = null;
    closed: Promise<{ code: number; reason: string }>;
    private onClose!: (close: { code: number; reason: string }) => void;
    private constructor(readonly tcp: net.Socket) {
        this.closed = new Promise((resolve) => (this.onClose = resolve));
        tcp.on("data", (chunk: Buffer) => {
            this.buffer = Buffer.concat([this.buffer, chunk]);
            this.drain();
        });
    }
    static open(port: number): Promise<RawSocket> {
        const tcp = net.connect(port, "127.0.0.1");
        return new Promise((resolve, reject) => {
            tcp.once("error", reject);
            tcp.once("connect", () => {
                tcp.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
                let head = Buffer.alloc(0);
                const onHead = (chunk: Buffer) => {
                    head = Buffer.concat([head, chunk]);
                    const end = head.indexOf("\r\n\r\n");
                    if (end < 0) return;
                    tcp.off("data", onHead);
                    if (!head.subarray(0, end).toString().startsWith("HTTP/1.1 101")) return reject(new Error(head.toString()));
                    const socket = new RawSocket(tcp);
                    socket.buffer = head.subarray(end + 4);
                    resolve(socket);
                };
                tcp.on("data", onHead);
            });
        });
    }
    request(frame: { id: number; action: string; params: object }): Promise<void> {
        const body = Buffer.from(JSON.stringify(frame));
        const mask = crypto.randomBytes(4);
        const header = body.length < 126 ? Buffer.from([0x81, 0x80 | body.length]) : Buffer.from([0x81, 0x80 | 126, body.length >> 8, body.length & 255]);
        const masked = Buffer.from(body.map((b, i) => b ^ mask[i % 4]));
        return new Promise((resolve) => {
            this.waiting = { id: frame.id, resolve };
            this.tcp.write(Buffer.concat([header, mask, masked]));
        });
    }
    private drain(): void {
        for (;;) {
            if (this.buffer.length < 2) return;
            const opcode = this.buffer[0] & 15;
            let length = this.buffer[1] & 127;
            let offset = 2;
            if (length === 126) { if (this.buffer.length < 4) return; length = this.buffer.readUInt16BE(2); offset = 4; }
            else if (length === 127) { if (this.buffer.length < 10) return; length = Number(this.buffer.readBigUInt64BE(2)); offset = 10; }
            if (this.buffer.length < offset + length) return;
            const payload = this.buffer.subarray(offset, offset + length);
            this.buffer = this.buffer.subarray(offset + length);
            if (opcode === 8) this.onClose({ code: payload.readUInt16BE(0), reason: payload.subarray(2).toString() });
            else if (opcode === 1 && this.waiting) {
                const msg = JSON.parse(payload.toString());
                if (msg.type === "response" && msg.id === this.waiting.id) {
                    if (msg.error) throw new Error(msg.error);
                    const { resolve } = this.waiting;
                    this.waiting = null;
                    resolve();
                }
            }
        }
    }
}

// what a panel does that carries secrets in its values, inputs and env
async function panelTraffic(): Promise<void> {
    const panel = await CraneSocket.authed(daemon.handshake.port, panelToken);
    await panel.call("config:set", { id: PANEL, data: { password: SECRETS[0] } });
    await panel.call("secrets:set", { panelId: PANEL, name: "api-key", value: SECRETS[1] });
    await panel.call("process:run", { id: "monitored-job", command: process.execPath, args: ["-e", "0"], env: { API_KEY: SECRETS[2] } });
    panel.close();
}

// The traffic monitor redacts and is host-only.
describe("traffic monitor", () => {
    test("this computer's host sees calls, events and workload states, with values, inputs, env and tokens only as their shape", async () => {
        const watcher = await CraneSocket.authed(daemon.handshake.port, daemon.handshake.token);
        expect(await watcher.call("monitor:subscribe")).toMatchObject({ success: true });
        await panelTraffic();
        const set = await watcher.waitFrame("config:set record", (f) => f.type === "monitor" && f.record.method === "config:set");
        expect(set.record).toMatchObject({ type: "rpc", panel: PANEL, ok: true, args: { id: PANEL, data: { type: "object", keys: ["password"] } } });
        const secret = await watcher.waitFrame("secrets:set record", (f) => f.type === "monitor" && f.record.method === "secrets:set");
        expect(secret.record.args).toEqual({ panelId: PANEL, name: "api-key", value: { type: "string", size: SECRETS[1].length } });
        const run = await watcher.waitFrame("process:run record", (f) => f.type === "monitor" && f.record.method === "process:run");
        expect(run.record.args.env).toEqual({ type: "object", keys: ["API_KEY"] });
        await watcher.waitFrame("workload record", (f) => f.type === "monitor" && f.record.type === "workload" && f.record.id === "monitored-job");
        const everything = JSON.stringify(watcher.frames);
        for (const value of [...SECRETS, panelToken, daemon.handshake.token]) expect(everything).not.toContain(value);
        watcher.close();
    }, WAIT_MS);

    test("panel, relay and paired-computer tokens are refused", async () => {
        const { code } = await host.call("system:pairing-start");
        const pairing = await CraneSocket.open(daemon.handshake.port);
        const { token: paired } = await pairing.call("auth:pair", { code, clientName: "laptop" });
        pairing.close();
        const relay = (await host.call("auth:panel-token", { panelId: PANEL, relayTo: "rack" })).token;
        for (const token of [panelToken, paired, relay]) {
            const socket = await CraneSocket.authed(daemon.handshake.port, token);
            const refused = await socket.send("monitor:subscribe");
            expect(refused.code).toBe("FORBIDDEN");
            expect(refused.result).toBeNull();
            socket.close();
        }
    }, WAIT_MS);

    test("a watcher that falls behind is closed with 4429 instead of fed a feed with holes", async () => {
        const slow = await RawSocket.open(daemon.handshake.port);
        await slow.request({ id: 1, action: "auth:verify", params: { token: daemon.handshake.token } });
        await slow.request({ id: 2, action: "monitor:subscribe", params: {} });
        // it stops reading
        slow.tcp.pause();
        // records of ~32 KiB each (argument names are shown), 64 MiB in all:
        // past the daemon's 32 MiB queue and whatever the kernel buffers
        const params: Record<string, number> = {};
        for (let i = 0; i < 32; i++) params[`${String(i).padStart(2, "0")}${"k".repeat(1000)}`] = i;
        const flood = await CraneSocket.authed(daemon.handshake.port, daemon.handshake.token);
        const replies = Array.from({ length: 2048 }, () => flood.send("system:ip", params, WAIT_MS * 2));
        await Promise.all(replies);
        flood.close();
        slow.tcp.resume();
        expect(await slow.closed).toEqual({ code: 4429, reason: "Slow monitor consumer" });
        slow.tcp.destroy();
    }, WAIT_MS * 3);

    test("`paperapi monitor` prints the same redacted records", async () => {
        const cli = spawn(process.execPath, [path.join(REPO_DIR, "packages", "paperapi", "bin", "cli.ts"), "monitor", "--json"], {
            env: { ...process.env, PAPERBOARD_DIR: daemon.dataDir }, stdio: ["ignore", "pipe", "pipe"],
        });
        const out = watch(cli, "paperapi monitor");
        await out.waitFor("watching note", (text) => text.includes("Watching every panel"));
        await panelTraffic();
        await out.waitFor("config:set line", (text) => text.split("\n").some((l) => l.includes(`"method":"config:set"`)));
        const line = out.output().split("\n").find((l) => l.includes(`"method":"config:set"`))!;
        expect(JSON.parse(line)).toMatchObject({ type: "rpc", panel: PANEL, args: { data: { type: "object", keys: ["password"] } } });
        for (const value of [...SECRETS, panelToken, daemon.handshake.token]) expect(out.output()).not.toContain(value);
        cli.kill("SIGINT");
        expect((await out.exited).code).toBe(0);
    }, WAIT_MS);
});
