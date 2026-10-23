// A supervised child's stdin: a pipe by default (stdin frames write to it),
// or empty and closed with `stdin: "ignore"`, for programs that read their
// stdin to the end before they run (`opencode run` does, and otherwise
// waits forever). Real supervisor processes, as in supervisorIdentity.test.ts,
// and the in-process supervisor the Electron app uses.
import { describe, it, expect, afterEach } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EmbeddedSupervisor } from "../papercrane/embeddedSupervisor";
import { getSupervisorMetadataPath } from "../papercrane/supervisor";

const MAIN = path.join(import.meta.dir, "..", "papercrane", "main.ts");
const supervisors: ChildProcess[] = [];
const dirs: string[] = [];
const embedded: EmbeddedSupervisor[] = [];

afterEach(async () => {
    for (const workload of embedded.splice(0)) workload.kill("SIGKILL");
    // SIGTERM lets each supervisor stop its workload before it exits
    for (const child of supervisors.splice(0)) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        if (!(await exited(child, 3000))) {
            child.kill("SIGKILL");
            await exited(child, 3000);
        }
    }
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function exited(child: ChildProcess, ms: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), ms);
        child.once("exit", () => {
            clearTimeout(timer);
            resolve(true);
        });
    });
}

/** A program that writes `marker` once its stdin ends, then exits. */
function readerSource(marker: string): string {
    return `process.stdin.resume(); process.stdin.on("end", () => { require("fs").writeFileSync(${JSON.stringify(marker)}, "eof"); process.exit(0); });`;
}

/** Supervise a child that writes `marker` once its stdin ends, then exits. */
async function superviseReader(id: string, stdin: "pipe" | "ignore" | undefined) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "supervisor-stdin-"));
    dirs.push(dir);
    const marker = path.join(dir, "eof");
    const source = readerSource(marker);
    const child = spawn(process.execPath, [MAIN, "--supervise", id], { stdio: ["pipe", "ignore", "ignore"], env: process.env });
    supervisors.push(child);
    child.stdin!.end(JSON.stringify({ command: process.execPath, args: ["-e", source], ...(stdin ? { stdin } : {}) }));
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(getSupervisorMetadataPath(id))) {
        if (Date.now() > deadline) throw new Error(`supervisor ${id} did not start`);
        await new Promise((r) => setTimeout(r, 25));
    }
    return { child, marker };
}

async function appears(file: string, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (!fs.existsSync(file)) {
        if (Date.now() > deadline) return false;
        await new Promise((r) => setTimeout(r, 25));
    }
    return true;
}

describe("a supervised child's stdin", () => {
    it('with stdin "ignore" is closed from the start: a program reading it to the end runs', async () => {
        const { marker } = await superviseReader("dev.test.stdin.ignore", "ignore");
        expect(await appears(marker, 8000)).toBe(true);
    }, 30_000);

    it("by default stays an open pipe, so the same program is still waiting", async () => {
        const { child, marker } = await superviseReader("dev.test.stdin.pipe", undefined);
        expect(await appears(marker, 1500)).toBe(false);
        expect(child.exitCode).toBeNull();
    }, 30_000);
});

describe("an embedded (in-process) supervised child's stdin", () => {
    async function embeddedReader(id: string, stdin: "pipe" | "ignore" | undefined) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "supervisor-stdin-"));
        dirs.push(dir);
        const marker = path.join(dir, "eof");
        const workload = new EmbeddedSupervisor(id, {
            id,
            type: "child_process",
            command: process.execPath,
            args: ["-e", readerSource(marker)],
            ...(stdin ? { stdin } : {}),
        });
        embedded.push(workload);
        expect(await workload.connect()).toBe(true);
        return marker;
    }

    it('with stdin "ignore" is closed from the start', async () => {
        expect(await appears(await embeddedReader("dev.test.stdin.embedded.ignore", "ignore"), 8000)).toBe(true);
    }, 30_000);

    it("by default stays an open pipe", async () => {
        expect(await appears(await embeddedReader("dev.test.stdin.embedded.pipe", undefined), 1500)).toBe(false);
    }, 30_000);
});
