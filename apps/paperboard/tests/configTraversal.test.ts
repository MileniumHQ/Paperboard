// config:get/set path traversal refusal (bun test): an id like
// `shell-../../x` must be refused at the RPC boundary with INVALID_PARAMS,
// must throw at the engine level, and must leave everything outside the
// data dir untouched.
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
let sentinelDir = "";
let wss: WebSocketServer;
let port = 0;
let engine: PaperCraneEngine;

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-cfg-"));
    sentinelDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-sentinel-"));
    engine = new PaperCraneEngine(tmp);
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
    fs.rmSync(sentinelDir, { recursive: true, force: true });
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

// id shaped so the pre-fix `sanitizeId(id) || id` fallback built a path
// OUTSIDE the data dir: local/shell-../../<sentinel>/evil.json normalizes
// to <sentinel>/evil.json
function traversalId(): string {
    return `shell-../../${path.basename(sentinelDir)}/evil`;
}

describe("config:get/set traversal refusal", () => {
    it("engine throws on traversal ids without touching disk", async () => {
        const evil = traversalId();
        await expect(engine.setConfig(evil, { pwned: true })).rejects.toThrow();
        await expect(engine.getConfig(evil)).rejects.toThrow();
        expect(fs.existsSync(path.join(sentinelDir, "evil.json"))).toBe(false);
    });

    it("RPC boundary refuses traversal ids with INVALID_PARAMS; sentinel untouched", async () => {
        const sentinel = path.join(sentinelDir, "evil.json");
        fs.writeFileSync(sentinel, JSON.stringify({ original: true }));
        const before = fs.readdirSync(sentinelDir).sort();

        const c = await connect();
        try {
            send(c, { id: 1, action: "config:set", params: { id: traversalId(), data: { pwned: true } } });
            const setResp = await waitFor(c, (f) => f.id === 1);
            expect(setResp.error).toBeTruthy();
            expect(setResp.code).toBe("INVALID_PARAMS");

            send(c, { id: 2, action: "config:get", params: { id: traversalId() } });
            const getResp = await waitFor(c, (f) => f.id === 2);
            expect(getResp.error).toBeTruthy();
            expect(getResp.code).toBe("INVALID_PARAMS");

            expect(JSON.parse(fs.readFileSync(sentinel, "utf8"))).toEqual({ original: true });
            expect(fs.readdirSync(sentinelDir).sort()).toEqual(before);
        } finally {
            c.ws.terminate();
        }
    });

    it("RPC boundary refuses traversal or non-JSON workspace paths", async () => {
        const c = await connect();
        try {
            for (const [frameId, badPath] of [
                [1, "../../evil.json"],
                [2, "/etc/passwd.json"],
                [3, "notes"],
            ] as const) {
                send(c, {
                    id: frameId,
                    action: "config:set",
                    params: {
                        id: "com.example.terminal",
                        data: { pwned: true },
                        path: badPath,
                    },
                });
                const resp = await waitFor(c, (f) => f.id === frameId);
                expect(resp.error).toBeTruthy();
                expect(resp.code).toBe("INVALID_PARAMS");
            }
            expect(fs.existsSync(path.join(tmp, "files", "evil.json"))).toBe(false);
            expect(fs.existsSync(path.join(tmp, "files", "com.example.terminal", "notes"))).toBe(false);
        } finally {
            c.ws.terminate();
        }
    });

    it("a workspace path round-trips into the panel's files dir", async () => {
        const c = await connect();
        try {
            send(c, {
                id: 1,
                action: "config:set",
                params: {
                    id: "com.example.terminal",
                    data: { tabs: [] },
                    path: "tabs.json",
                },
            });
            expect((await waitFor(c, (f) => f.id === 1)).error).toBeUndefined();

            send(c, {
                id: 2,
                action: "config:get",
                params: { id: "com.example.terminal", path: "tabs.json" },
            });
            expect((await waitFor(c, (f) => f.id === 2)).result).toEqual({
                data: { tabs: [] },
            });
            expect(
                fs.existsSync(
                    path.join(tmp, "files", "com.example.terminal", "tabs.json"),
                ),
            ).toBe(true);
        } finally {
            c.ws.terminate();
        }
    });

    it("legit shell-global and panel ids still round-trip through the boundary", async () => {
        const c = await connect();
        try {
            send(c, { id: 1, action: "config:set", params: { id: "shell-last-opened", data: { panelId: "x" } } });
            const setResp = await waitFor(c, (f) => f.id === 1);
            expect(setResp.error).toBeUndefined();

            send(c, { id: 2, action: "config:get", params: { id: "shell-last-opened" } });
            const getResp = await waitFor(c, (f) => f.id === 2);
            expect(getResp.result).toEqual({ data: { panelId: "x" } });
        } finally {
            c.ws.terminate();
        }
    });
});
