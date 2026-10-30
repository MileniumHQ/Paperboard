// A workload that cannot start is the creator's error (bun test, real
// supervisor process). On Windows every terminal failed to load conpty: the
// supervisor logged it and exited, but term:create had already answered
// success, so the terminal panel stayed blank and the gameserver's trash pty
// reported only a missing output marker. The supervisor now reports the
// start outcome in its status frame and the client rejects with the reason.
import { describe, it, expect, afterEach } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { batchFileRefusal } from "../papercrane/batchFile";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { SupervisedProcessClient, getSupervisorMetadataPath, getSupervisorSocketPath } from "../papercrane/supervisor";

const MAIN = path.join(import.meta.dir, "..", "papercrane", "main.ts");
const children: ChildProcess[] = [];
const clients: SupervisedProcessClient[] = [];

function exited(child: ChildProcess): Promise<number | null> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
    return new Promise((resolve) => child.once("exit", resolve));
}

afterEach(async () => {
    for (const client of clients.splice(0)) client.destroy();
    await Promise.all(children.splice(0).map(async (child) => {
        const done = exited(child);
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        await done;
    }));
});

async function superviseAndConnect(id: string, config: Record<string, unknown>) {
    const child = spawn(process.execPath, [MAIN, "--supervise", id], {
        stdio: ["pipe", "ignore", "ignore"],
        env: process.env,
    });
    children.push(child);
    child.stdin!.end(JSON.stringify(config));
    const client = new SupervisedProcessClient(id);
    clients.push(client);
    for (let i = 0; i < 100 && !(await client.connect()); i++) {
        await new Promise((r) => setTimeout(r, 50));
    }
    expect(client.isConnected()).toBe(true);
    return { child, client };
}

describe("supervisor start outcome", () => {
    it("rejects with the reason when the pty cannot start", async () => {
        const { child, client } = await superviseAndConnect("start-fail-pty", {
            isPty: true,
            command: "/nonexistent/shell-for-paperboard-test",
        });
        await expect(client.awaitStarted()).rejects.toThrow(/Could not start a terminal/);
        // the failed supervisor exits instead of lingering on its pipe
        expect(await exited(child)).toBe(1);
    }, 15_000);

    it("rejects with the missing working directory", async () => {
        const { child, client } = await superviseAndConnect("start-fail-cwd", {
            isPty: true,
            command: "/bin/sh",
            cwd: "/nonexistent/paperboard-test-cwd",
        });
        await expect(client.awaitStarted()).rejects.toThrow(
            "Working directory does not exist: /nonexistent/paperboard-test-cwd",
        );
        expect(existsSync(getSupervisorMetadataPath(client.id))).toBe(false);
        expect(await exited(child)).toBe(1);
    }, 15_000);

    it("resolves for a workload that started", async () => {
        if (process.platform === "win32") return;
        const { client } = await superviseAndConnect("start-ok", {
            isPty: true,
            command: "/bin/sh",
        });
        await expect(client.awaitStarted()).resolves.toBeUndefined();
        client.kill();
    }, 15_000);

    it("names a batch file instead of timing out when asked to start one (Windows)", async () => {
        if (process.platform !== "win32") return;
        const { client } = await superviseAndConnect("start-fail-batch", { command: "C:\\Windows\\System32\\nothing.cmd", args: [] });
        await expect(client.awaitStarted()).rejects.toThrow(/batch files must be run via cmd\.exe \/c with static args/);
    }, 15_000);

    it("refuses .cmd/.bat commands on Windows only, however the name is dressed", () => {
        for (const name of ["a.cmd", "C:\\x\\Tool.BAT", "run.cmd. ", "run.bat."]) {
            expect(batchFileRefusal(name, "win32")).toMatch(/batch files must be run via cmd\.exe \/c with static args/);
            expect(batchFileRefusal(name, "linux")).toBeNull();
        }
        for (const name of ["cmd.exe", "node.exe", "script.cmd.exe", "bat"]) expect(batchFileRefusal(name, "win32")).toBeNull();
    });
});

// A workload started again under the same id the moment the last one exited
// (a terminal tab whose shell ended) gets the same socket path. The old
// supervisor closed its server on the way out, and closing a unix socket
// server unlinks its path: the replacement's socket, by then. The new
// workload kept running with no endpoint, and its start timed out.
describe("supervisor exit", () => {
    it("leaves the endpoint of a replacement under the same id alone", async () => {
        if (process.platform === "win32") return;
        // compiled, so the replacement binds well inside the old one's exit
        // delay; `bun main.ts` takes longer than that to start
        const dir = mkdtempSync(path.join(tmpdir(), "supervisor-replace-"));
        const source = path.join(dir, "supervisor.ts");
        const launcher = path.join(dir, "supervisor");
        writeFileSync(source, `import { runSupervisor } from ${JSON.stringify(path.resolve(import.meta.dir, "../papercrane/supervisor.ts"))}; await runSupervisor(process.argv.at(-1)!);`);
        const build = Bun.spawnSync([process.execPath, "build", source, "--compile", "--outfile", launcher]);
        if (build.exitCode !== 0) throw new Error(build.stderr.toString());
        const start = async (config: Record<string, unknown>) => {
            const child = spawn(launcher, ["--supervise", "replaced-workload"], { stdio: ["pipe", "ignore", "ignore"], env: process.env });
            children.push(child);
            child.stdin!.end(JSON.stringify(config));
            const client = new SupervisedProcessClient("replaced-workload");
            clients.push(client);
            for (let i = 0; i < 100 && !(await client.connect()); i++) await new Promise((r) => setTimeout(r, 10));
            expect(client.isConnected()).toBe(true);
            return { child, client };
        };
        try {
            const first = await start({ command: "/bin/sh", args: ["-c", "sleep 0.3"] });
            await new Promise((resolve) => first.client.on("exit", resolve));
            const second = await start({ command: "/bin/sh", args: ["-c", "sleep 30"] });
            await exited(first.child);
            expect(existsSync(getSupervisorSocketPath("replaced-workload"))).toBe(true);
            const probe = new SupervisedProcessClient("replaced-workload");
            clients.push(probe);
            expect(await probe.connect()).toBe(true);
            second.client.kill();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 30_000);
});
