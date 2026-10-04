// Supervisor endpoints are one-to-one with process ids (bun test, real
// supervisor processes). The old endpoint name replaced "." with "_", so
// "a.b" and "a_b" shared one socket, and a daemon restart re-keyed recovered
// workloads under the substituted name, out of reach of kill and uninstall
// (the AI panel's dev.paperboard.ai.ollama hit exactly this).
import { describe, it, expect, afterEach } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import {
    SupervisedProcessClient,
    getSupervisorSocketPath,
    getSupervisorMetadataPath,
    legacySupervisorEndpointName,
    supervisorEndpointName,
    supervisorSocketPathForName,
} from "../papercrane/supervisor";
import { stopSpawnedSupervisor } from "../papercrane/engineSupervisor";
import { getSocketsDir } from "../papercrane/paths";
import { PaperCraneEngine } from "../papercrane/engine";

const MAIN = path.join(import.meta.dir, "..", "papercrane", "main.ts");
const children: ChildProcess[] = [];
const cleanup: (() => void)[] = [];

afterEach(() => {
    for (const fn of cleanup.splice(0)) fn();
    for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGKILL");
});

async function supervise(id: string): Promise<ChildProcess> {
    const child = spawn(process.execPath, [MAIN, "--supervise", id], { stdio: ["pipe", "ignore", "ignore"], env: process.env });
    children.push(child);
    child.stdin!.end(JSON.stringify({ command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] }));
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(getSupervisorMetadataPath(id))) {
        if (Date.now() > deadline) throw new Error(`supervisor ${id} did not start`);
        await new Promise((r) => setTimeout(r, 25));
    }
    return child;
}

function exited(child: ChildProcess, ms = 8000): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), ms);
        child.once("exit", () => { clearTimeout(timer); resolve(true); });
    });
}

describe("supervisor endpoint names", () => {
    it("are distinct for ids the old substitution merged, and bounded in length", () => {
        expect(supervisorEndpointName("a.b")).not.toBe(supervisorEndpointName("a_b"));
        expect(getSupervisorSocketPath("a.b")).not.toBe(getSupervisorSocketPath("a_b"));
        expect(supervisorEndpointName("x".repeat(128))).toHaveLength(32);
        expect(supervisorEndpointName("a.b")).toBe(supervisorEndpointName("a.b"));
    });

    it("two live workloads whose ids differ only by . and _ stay separate", async () => {
        const dotted = await supervise("dev.test.twin");
        const underscored = await supervise("dev_test_twin");
        const a = new SupervisedProcessClient("dev.test.twin");
        const b = new SupervisedProcessClient("dev_test_twin");
        cleanup.push(() => a.destroy(), () => b.destroy());
        expect(await a.connect()).toBe(true);
        expect(await b.connect()).toBe(true);
        await a.awaitStarted();
        await b.awaitStarted();
        // each id reaches its own supervisor process, not a shared endpoint
        expect(a.pid).toBe(dotted.pid!);
        expect(b.pid).toBe(underscored.pid!);
        a.kill("SIGKILL");
        expect(await exited(dotted)).toBe(true);
        expect(underscored.exitCode).toBeNull();
    }, 30_000);
});

describe("daemon restart recovery", () => {
    it("recovers a running workload under its own id, so kill reaches it", async () => {
        const id = "dev.test.recover.ollama";
        const child = await supervise(id);
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "supervisor-recover-"));
        cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
        const engine = new PaperCraneEngine(root);
        await engine.recoverRunningSupervisors();
        expect(await engine.isProcessRunning(id)).toBe(true);
        expect((engine as any).clients.has(legacySupervisorEndpointName(id))).toBe(false);
        await engine.killProcess(id);
        expect(await exited(child)).toBe(true);
    }, 30_000);

    it("refuses to start a second workload over a live supervisor for the same id", async () => {
        const id = "dev.test.already.running";
        const child = await supervise(id);
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "supervisor-dup-"));
        cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
        const engine = new PaperCraneEngine(root);
        await expect(engine.startProcess(id, process.execPath, ["-e", "0"])).rejects.toThrow(/already running/);
        // the first workload keeps its endpoint and stays reachable
        const client = new SupervisedProcessClient(id);
        cleanup.push(() => client.destroy());
        expect(await client.connect()).toBe(true);
        expect(child.exitCode).toBeNull();
    }, 30_000);

    it("recovers a supervisor still listening under the pre-digest name", async () => {
        const id = "dev.test.legacy.proc";
        const legacyName = legacySupervisorEndpointName(id);
        const socketPath = supervisorSocketPathForName(legacyName);
        const metaPath = path.join(getSocketsDir(), `${legacyName}.json`);
        const received: string[] = [];
        const server = net.createServer((socket) => {
            socket.write(JSON.stringify({ type: "status", pid: 1, childPid: 1, running: true, isPty: false }) + "\n");
            socket.on("data", (chunk) => received.push(String(chunk)));
        });
        await new Promise<void>((resolve) => server.listen(socketPath, resolve));
        fs.writeFileSync(metaPath, JSON.stringify({ id }));
        cleanup.push(() => { server.close(); fs.rmSync(metaPath, { force: true }); fs.rmSync(socketPath, { force: true }); });
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "supervisor-legacy-"));
        cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
        const engine = new PaperCraneEngine(root);
        await engine.recoverRunningSupervisors();
        expect((engine as any).clients.has(id)).toBe(true);
        (engine as any).clients.get(id).kill("SIGTERM");
        const deadline = Date.now() + 3000;
        while (!received.join("").includes('"kill"')) {
            if (Date.now() > deadline) throw new Error("kill never reached the legacy supervisor");
            await new Promise((r) => setTimeout(r, 10));
        }
        (engine as any).clients.get(id).destroy();
    }, 30_000);

    it("does not adopt metadata that names an id the file does not belong to", async () => {
        const stray = path.join(getSocketsDir(), `${supervisorEndpointName("dev.test.real")}.json`);
        fs.writeFileSync(stray, JSON.stringify({ id: "dev.test.impostor" }));
        cleanup.push(() => fs.rmSync(stray, { force: true }));
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "supervisor-stray-"));
        cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
        const engine = new PaperCraneEngine(root);
        await engine.recoverRunningSupervisors();
        expect((engine as any).clients.has("dev.test.impostor")).toBe(false);
    });
});

// ─── Failed spawn must not orphan a detached supervisor ─────────────────────
describe("failed spawn recovery", () => {
    // stopping a detached supervisor is more than sending a signal: the
    // exit is observed. In real daemon failure paths the spawned
    // supervisor that never became ready (or never reported a start)
    // goes through exactly this teardown; under `bun test` the daemon
    // cannot spawn supervisor children itself (bun treats `--supervise`
    // as a script path), so this drives the teardown directly.
    it("observes the supervisor's exit and removes its endpoint", async () => {
        const id = "dev.test.orphan.stop";
        const child = await supervise(id);
        expect(child.exitCode).toBeNull();
        await stopSpawnedSupervisor(id, child);
        expect(await exited(child, 8000)).toBe(true);
        // endpoint cleanup, so nothing later mistakes it for a live one
        expect(fs.existsSync(getSupervisorMetadataPath(id))).toBe(false);
        expect(fs.existsSync(getSupervisorSocketPath(id))).toBe(false);
    }, 30_000);

    it("is a no-op on an already-exited supervisor", async () => {
        const id = "dev.test.orphan.stopped";
        const child = await supervise(id);
        child.kill("SIGTERM");
        await exited(child);
        await stopSpawnedSupervisor(id, child);
        expect(child.exitCode !== null).toBe(true);
    }, 30_000);
});

// ─── Live workload budget ────────────────────────────────────────────────────
describe("live workload budget", () => {
    it("refuses creation past the budget instead of spawning another supervisor", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "supervisor-cap-"));
        cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
        const engine = new PaperCraneEngine(root);
        for (let i = 0; i < 128; i++) {
            (engine as any).clients.set(`dev.test.stub.${i}`, { id: `dev.test.stub.${i}`, isConnected: () => true, destroy: () => { /* stub */ } });
        }
        await expect(engine.startProcess("dev.test.stub.overhead", process.execPath, ["-e", "0"]))
            .rejects.toThrow(/Too many live supervised workloads/);
        expect((engine as any).clients.has("dev.test.stub.overhead")).toBe(false);
    });

    it("a dead entry does not consume budget: it is replaced, not rejected", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "supervisor-cap-replace-"));
        cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
        const engine = new PaperCraneEngine(root);
        for (let i = 0; i < 127; i++) {
            (engine as any).clients.set(`dev.test.stub.${i}`, { id: `dev.test.stub.${i}`, isConnected: () => true, destroy: () => { /* stub */ } });
        }
        let destroyed = false;
        (engine as any).clients.set("dev.test.stale", {
            id: "dev.test.stale",
            isConnected: () => false,
            destroy: () => { destroyed = true; },
        });
        // the spawn itself fails under `bun test` (see failed-spawn note),
        // but that is proof enough the budget refusal never happened
        await expect(engine.startProcess("dev.test.stale", process.execPath, ["-e", "0"]))
            .rejects.not.toThrow(/Too many live supervised workloads/);
        expect(destroyed).toBe(true);
        expect((engine as any).clients.has("dev.test.stale")).toBe(false);
    });
});
