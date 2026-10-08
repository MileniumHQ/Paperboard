// A workload that finishes before the spawning daemon attaches (bun test,
// real supervisor process). The supervisor used to tear its endpoint down
// the moment the child exited, so a command that ran in milliseconds was
// reported as "Supervisor … did not become ready" and its output and exit
// code were lost; on the standalone daemon this broke fast commands such
// as a directory listing at random.
import { afterEach, expect, it } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { SupervisedProcessClient } from "../papercrane/supervisor";

const MAIN = path.join(import.meta.dir, "..", "papercrane", "main.ts");
const children: ChildProcess[] = [];
const clients: SupervisedProcessClient[] = [];

afterEach(() => {
    for (const client of clients.splice(0)) client.destroy();
    for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGKILL");
});

function exited(child: ChildProcess): Promise<number | null> {
    return new Promise((resolve) => {
        if (child.exitCode !== null) resolve(child.exitCode);
        else child.once("exit", (code) => resolve(code));
    });
}

it("delivers the output and exit code of a workload that exited before the first attach", async () => {
    const id = "fast-exit";
    const supervisor = spawn(process.execPath, [MAIN, "--supervise", id], {
        stdio: ["pipe", "ignore", "ignore"],
        env: process.env,
    });
    children.push(supervisor);
    supervisor.stdin!.end(
        JSON.stringify({
            command: process.execPath,
            args: ["-e", 'process.stdout.write("out-line"); process.stderr.write("err-line"); process.exit(3)'],
        }),
    );

    // connect only once the workload has certainly finished
    await new Promise((r) => setTimeout(r, 1500));

    const client = new SupervisedProcessClient(id);
    clients.push(client);
    const stdout: string[] = [];
    const stderr: string[] = [];
    client.on("stdout", (d: string) => stdout.push(d));
    client.on("stderr", (d: string) => stderr.push(d));
    const exitCode = new Promise<number>((resolve) => client.on("exit", resolve));

    let connected = false;
    for (let i = 0; i < 40 && !(connected = await client.connect()); i++) {
        await new Promise((r) => setTimeout(r, 50));
    }
    expect(connected).toBe(true);
    await expect(client.awaitStarted()).resolves.toBeUndefined();
    expect(await exitCode).toBe(3);
    // per stream, not only as an untagged history blob
    expect(stdout.join("")).toBe("out-line");
    expect(stderr.join("")).toBe("err-line");
    // and the supervisor is gone once it has been read
    expect(await exited(supervisor)).toBe(3);
}, 15_000);
