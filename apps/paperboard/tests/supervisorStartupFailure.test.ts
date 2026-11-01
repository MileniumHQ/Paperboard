// A supervisor that dies before it is ready says why (bun test, a real
// supervisor child). The start error was only "did not become ready", with
// the supervisor's stderr and exit status thrown away, so a daemon that could
// not start workloads gave nothing to act on. Under `bun test` the daemon's
// own executable is bare bun, which rejects `--supervise <id>` as a missing
// script: a real supervisor process that fails at startup with a real reason.
import { test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSupervisedClient } from "../papercrane/engineSupervisor";
import { getLogsDir } from "../papercrane/paths";

test("a supervisor that exits before it is ready reports its exit code and what it wrote to stderr", async () => {
    const id = "dev.test.startup.failure";
    const clients = new Map<string, any>();
    const error = await spawnSupervisedClient(id, { command: process.execPath, args: ["-e", "0"] }, clients).then(
        () => { throw new Error("the supervisor was expected to fail"); },
        (err: Error) => err,
    );
    expect(error.message).toStartWith(`Supervisor ${id} did not become ready: it exited with code 1`);
    expect(error.message).toContain(`File not found "${id}"`);
    expect(clients.size).toBe(0);
    // nothing of the start is left on disk
    const left = fs.existsSync(getLogsDir()) ? fs.readdirSync(getLogsDir()).filter((f) => f.startsWith("supervisor-start-")) : [];
    expect(left.map((f) => path.join(getLogsDir(), f))).toEqual([]);
}, 30_000);
