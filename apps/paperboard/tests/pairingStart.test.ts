// Pairing opens only on request (bun test, real standalone daemon). A fresh
// daemon listening on the LAN used to open pairing by itself whenever no
// device was paired yet, with no expiry; now only [p] in the TUI or
// --start-pairing at launch shows a code.
import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";

const MAIN = path.resolve(import.meta.dir, "../papercrane/main.ts");

async function pairAttempt(extraArgs: string[]): Promise<string> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pairing-start-"));
    const child = Bun.spawn([process.execPath, MAIN, "--host", "127.0.0.1", "--port", "0", ...extraArgs], {
        env: { ...process.env, PAPERBOARD_DIR: root }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const output = new Response(child.stdout).text();
    const errors = new Response(child.stderr).text();
    let ws: WebSocket | undefined;
    try {
        const handshake = path.join(root, "local", "crane.json");
        const deadline = Date.now() + 8000;
        while (!fs.existsSync(handshake)) {
            if (Date.now() > deadline || child.exitCode !== null) throw new Error(`daemon did not start: ${await errors}`);
            await Bun.sleep(10);
        }
        const { port } = JSON.parse(fs.readFileSync(handshake, "utf8"));
        ws = new WebSocket(`ws://127.0.0.1:${port}`);
        await once(ws, "open");
        const reply = once(ws, "message");
        ws.send(JSON.stringify({ id: 1, action: "auth:pair", params: { code: "000000" } }));
        return String(JSON.parse(String((await reply)[0])).error);
    } finally {
        ws?.terminate();
        child.kill();
        await child.exited; await output; await errors;
        fs.rmSync(root, { recursive: true, force: true });
    }
}

test("a fresh daemon with nothing paired does not open pairing by itself", async () => {
    expect(await pairAttempt([])).toMatch(/not currently active/);
}, 15_000);

test("--start-pairing opens pairing at launch", async () => {
    expect(await pairAttempt(["--start-pairing"])).toMatch(/Invalid pairing code/);
}, 15_000);
