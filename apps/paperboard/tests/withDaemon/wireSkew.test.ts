import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { WebSocketServer } from "ws";
import { PaperCraneClient } from "../../src/main/communication/papercrane/PaperCraneClient";
import { DAEMON_CHALLENGE_HEADER, DAEMON_PROOF_TYPE, daemonProof } from "daemon/security/handshake";
import { PROTOCOL_VERSION } from "daemon/core/protocol";
import { dataDir, restoreEnv } from "testkit/fs";
import { startDaemon, stopDaemon } from "testkit/inproc";
import { TEST_TIMEOUT_MS } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);
afterEach(stopDaemon);

// A shell and a daemon of different releases talk to each other on the same
// protocol version, so checked params refuse only what the daemon never
// served, and the shell reads only what every daemon answers.
describe("a peer of another release", () => {
    test("an older peer's request shapes still work: no params, nulls for what it left out, fields this daemon doesn't know", async () => {
        const daemon = await startDaemon();
        const host = await daemon.rpc();
        // a frame without params at all, as 0.1's tray asked
        host.send({ id: "bare", action: "term:shells" });
        const shells = await host.next((frame) => frame?.id === "bare", undefined, "the answer to a frame without params");
        expect(shells.error).toBeUndefined();
        expect(Array.isArray(shells.result.shells)).toBe(true);
        // null for an optional field reads as left out
        expect(await host.ok("package:isInstalled", { packageName: "nodejs", version: null })).toEqual({ installed: false });
        expect(await host.ok("file:write", { targetPath: "notes.txt", content: "hi", appId: null })).toMatchObject({ path: expect.any(String) });
        expect(await host.ok("config:set", { id: "test.old", path: null, data: { v: 1 } })).toEqual({ success: true });
        expect(await host.ok("config:get", { id: "test.old", path: null })).toEqual({ data: { v: 1 } });
        // a flag the old daemon read as "only true is true"
        expect(await host.ok("secrets:set", { panelId: "test.old", name: "k", value: "v", legacyFlag: "yes" })).toEqual({ success: true });
        expect(await host.ok("secrets:get", { panelId: "test.old", name: "k" })).toEqual({ found: true, value: "v" });
        // a name the vault could never hold is not found, as it always was
        expect(await host.ok("secrets:get", { panelId: "test.old", name: 42 })).toEqual({ found: false, value: null });
        await host.close();
    });

    test("a newer peer's request shapes work: fields added after this release travel past the checks", async () => {
        const daemon = await startDaemon();
        const host = await daemon.rpc();
        const future = { addedLater: { nested: [1, 2] }, trace: "abc" };
        expect(await host.ok("file:write", { targetPath: "a.json", content: "{}", ...future })).toMatchObject({ path: expect.any(String) });
        expect(await host.ok("file:read", { targetPath: "a.json", ...future })).toEqual({ content: "{}" });
        expect(await host.ok("problems:report", { panelId: "test.new", key: "k", title: "Title", message: "Message", severity: "high" })).toEqual({ success: true });
        expect((await host.ok("problems:list", { panelId: "test.new", ...future })).problems).toHaveLength(1);
        const answer = await host.call("system:info", { v: PROTOCOL_VERSION, ...future });
        expect(answer.error).toBeUndefined();
        expect(answer.result).toMatchObject({ service: "papercrane", os: expect.any(String), arch: expect.any(String) });
        await host.close();
    });

    test("events:subscribe reads as every release sent it: entries that aren't names pass over, added fields travel, and a missing list is refused naming it", async () => {
        const daemon = await startDaemon();
        const host = await daemon.rpc();
        expect(await host.ok("events:subscribe", { events: ["problems:changed", 7, null, "backup:progress"] })).toEqual({ success: true, count: 2 });
        expect(await host.ok("events:subscribe", { events: [], since: 3 })).toEqual({ success: true, count: 0 });
        const missing = await host.fail("events:subscribe", { names: ["problems:changed"] });
        expect(missing.code).toBe("INVALID_PARAMS");
        expect(missing.error).toContain("events:subscribe");
        const many = await host.fail("events:subscribe", { events: Array.from({ length: 513 }, (_, i) => `e${i}`) });
        expect(many).toEqual({ error: "Request failed: Too many event subscriptions (max 512) (in events:subscribe)", code: "INVALID_PARAMS" });
        await host.close();
    });

    test("the shell reads a 0.1 daemon's answers: a self-update it started at once, and a panel list with nothing else in it", async () => {
        const token = `pc_${"cd".repeat(24)}`;
        const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
        await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
        // each answer exactly as v0.1.1's daemon gave it
        const answers: Record<string, unknown> = {
            "auth:verify": { success: true, hostname: "rack", os: "linux", osVersion: "24.04", distroId: "ubuntu", distroName: "Ubuntu", arch: "x64" },
            "system:update": { success: true, message: "Update initiated" },
            "panel:list": { panels: [{ id: "dev.paperboard.terminal", name: "Terminal", version: "0.1.1" }] },
            "service:count": { running: 2 },
        };
        wss.on("connection", (ws, req) => {
            const challenge = req.headers[DAEMON_CHALLENGE_HEADER];
            if (typeof challenge === "string") ws.send(JSON.stringify({ type: DAEMON_PROOF_TYPE, proof: daemonProof(token, challenge) }));
            ws.on("message", (data) => {
                const frame = JSON.parse(String(data));
                ws.send(JSON.stringify({ type: "response", id: frame.id, result: answers[frame.action] }));
            });
        });
        const dir = dataDir();
        fs.writeFileSync(path.join(dir, "local", "crane.json"), JSON.stringify({ port: (wss.address() as { port: number }).port, token }));
        const previous = process.env.PAPERBOARD_DIR;
        process.env.PAPERBOARD_DIR = dir;
        const client = new PaperCraneClient();
        try {
            await client.connect("127.0.0.1");
            await client.updateCrane("0.1.2", "https://i.paperboard.dev/crane/0.1.2/papercrane-linux-x64.tar.gz", crypto.randomBytes(32).toString("hex"), "c2lnbmF0dXJl");
            expect(await client.listPanels()).toEqual([{ id: "dev.paperboard.terminal", name: "Terminal", version: "0.1.1" }]);
            expect(await client.runningServiceCount()).toBe(2);
            // an answer missing what the shell reads is refused, naming the action
            answers["service:count"] = { count: 2 };
            await expect(client.runningServiceCount()).rejects.toThrow(`Paperboard Server's answer to service:count doesn't fit: the field "running" is missing`);
        } finally {
            client.disconnect();
            restoreEnv("PAPERBOARD_DIR", previous);
            await new Promise<void>((resolve) => wss.close(() => resolve()));
        }
    });
});
