// Stopping the daemon, headless or not, leaves the workloads it supervises running
// (bun test, a real compiled daemon, real supervisors). A service manager
// stops and restarts the daemon for an update; the SIGTERM handler used to
// SIGKILL every supervised workload, so a game server lost its world's
// unsaved progress each time, and a daemon started without --headless still
// did. Supervisors are detached so the next daemon
// adopts what they keep running.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { CraneTransport } from "../../../packages/paperapi/src/ws";
import { compileCrane, startCrane, tempDir, type CraneDaemon } from "./craneDaemon";
import { getSupervisorMetadataPath } from "../papercrane/supervisor";

const ID = "dev.test.signal.workload";
const MARK = "papercrane-signal-test-workload";
const WORKLOAD = ["-e", `setInterval(() => {}, 1000) // ${MARK}`];

let root = "";
let bin = "";
const daemons: CraneDaemon[] = [];
const transports: CraneTransport[] = [];
const workloadPids: number[] = [];
const savedDir = process.env.PAPERBOARD_DIR;

const alive = (pid: number) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw error;
    }
};
// only ever signal a pid that is still this test's workload, never a reused one
const isWorkload = (pid: number) => {
    // ps exits non-zero when the pid is gone
    const ps = spawnSync("ps", ["-p", String(pid), "-o", "args="], { encoding: "utf8" });
    return ps.status === 0 && ps.stdout.includes(MARK);
};

beforeAll(async () => {
    root = tempDir("pb-crane-signal-");
    process.env.PAPERBOARD_DIR = path.join(root, "home");
    bin = await compileCrane(root);
}, 60_000);

afterAll(async () => {
    for (const t of transports) t.close();
    for (const d of daemons) {
        if (d.proc.exitCode === null) d.proc.kill("SIGKILL");
        await d.proc.exited;
    }
    for (const pid of workloadPids) if (alive(pid) && isWorkload(pid)) process.kill(pid, "SIGKILL");
    if (savedDir === undefined) delete process.env.PAPERBOARD_DIR;
    else process.env.PAPERBOARD_DIR = savedDir;
    fs.rmSync(root, { recursive: true, force: true });
});

async function until(check: () => boolean | Promise<boolean>, what: string) {
    const deadline = Date.now() + 10_000;
    while (!(await check())) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await Bun.sleep(25);
    }
}

for (const headless of [true, false]) test(`SIGTERM to the ${headless ? "headless" : "interactive"} daemon leaves a supervised workload running for the next daemon`, async () => {
    const dir = process.env.PAPERBOARD_DIR!;
    const first = await startCrane(bin, dir, { headless });
    daemons.push(first);
    const firstApi = new CraneTransport({ port: first.port, token: first.token, computerId: "local" });
    transports.push(firstApi);
    await firstApi.call("process:run", { id: ID, command: process.execPath, args: WORKLOAD });
    const meta = JSON.parse(fs.readFileSync(getSupervisorMetadataPath(ID), "utf8")) as { childPid: number };
    workloadPids.push(meta.childPid);
    expect(alive(meta.childPid)).toBe(true);

    firstApi.close();
    first.proc.kill("SIGTERM");
    expect(await first.proc.exited).toBe(0);
    // a killed workload is gone within moments; give a wrong kill time to land
    await Bun.sleep(1000);
    expect(alive(meta.childPid)).toBe(true);

    const second = await startCrane(bin, dir);
    daemons.push(second);
    const secondApi = new CraneTransport({ port: second.port, token: second.token, computerId: "local" });
    transports.push(secondApi);
    await until(async () => (await secondApi.call("process:exists", { id: ID }))?.running === true, "the next daemon to adopt the workload");

    await secondApi.call("process:kill", { id: ID });
    await until(() => !alive(meta.childPid), "the workload to stop when it is told to");
}, 90_000);
