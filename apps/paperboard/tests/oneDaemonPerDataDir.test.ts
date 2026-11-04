// A second daemon for a data directory that already has a live one refuses
// to start (bun test). It used to start, overwrite crane.json with its own
// port and token, and delete the file when it exited: every local client,
// the desktop app included, lost the first daemon while it kept running.
// This runs two real daemon processes on one data directory.
import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { tempDir } from "./craneDaemon";

const MAIN = path.resolve(import.meta.dir, "../papercrane/main.ts");
const running: ReturnType<typeof Bun.spawn>[] = [];
const dirs: string[] = [];

afterEach(async () => {
    for (const proc of running.splice(0)) {
        if (proc.exitCode === null) {
            proc.kill("SIGTERM");
            await proc.exited;
        }
    }
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// a headless daemon from source, ready once its handshake names its own PID
async function start(dir: string): Promise<ReturnType<typeof Bun.spawn>> {
    const proc = Bun.spawn([process.execPath, MAIN, "--headless", "--host", "127.0.0.1", "--port", "0"], {
        env: { ...process.env, PAPERBOARD_DIR: dir },
        stdout: "ignore",
        stderr: "pipe",
    });
    running.push(proc);
    const handshake = path.join(dir, "local", "crane.json");
    const deadline = Date.now() + 15_000;
    for (;;) {
        // written atomically: once it exists it parses
        if (fs.existsSync(handshake) && JSON.parse(fs.readFileSync(handshake, "utf8")).pid === proc.pid) return proc;
        if (proc.exitCode !== null) throw new Error(`the daemon exited (${proc.exitCode}): ${await new Response(proc.stderr as ReadableStream).text()}`);
        if (Date.now() > deadline) throw new Error("the daemon did not write its handshake");
        await Bun.sleep(20);
    }
}

function serve(dir: string) {
    return spawnSync(process.execPath, [MAIN, "--headless", "--host", "127.0.0.1", "--port", "0"], {
        env: { ...process.env, PAPERBOARD_DIR: dir },
        encoding: "utf8",
        timeout: 20_000,
    });
}

test("a second daemon on a live daemon's data directory exits 1 and leaves the first one reachable", async () => {
    const dir = tempDir("pb-one-daemon-");
    dirs.push(dir);
    const first = await start(dir);
    const handshake = path.join(dir, "local", "crane.json");
    const before = fs.readFileSync(handshake, "utf8");
    const firstPid = first.pid;

    const second = serve(dir);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain(`A Paperboard server daemon is already running for ${dir} (PID ${firstPid}). Stop it first, or start this one with another --data-dir.`);
    expect(second.stdout.includes("Listening on")).toBe(false);

    // the first daemon's handshake is untouched and it still answers
    expect(fs.readFileSync(handshake, "utf8")).toBe(before);
    const status = spawnSync(process.execPath, [MAIN, "status", "--json"], { env: { ...process.env, PAPERBOARD_DIR: dir }, encoding: "utf8" });
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ running: true, pid: firstPid });
}, 60_000);

test("a crane.json left by a daemon that is gone does not stop a new one", async () => {
    const dir = tempDir("pb-one-daemon-stale-");
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, "local"), { recursive: true });
    // a port nothing listens on
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const freePort = (probe.address() as net.AddressInfo).port;
    probe.close();
    await once(probe, "close");
    fs.writeFileSync(path.join(dir, "local", "crane.json"), JSON.stringify({ port: freePort, token: "stale", pid: 999999 }));
    const daemon = await start(dir);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "local", "crane.json"), "utf8")).pid).toBe(daemon.pid);
}, 60_000);
