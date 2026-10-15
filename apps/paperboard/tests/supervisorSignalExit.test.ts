// A workload ended by a signal reports 128 + the signal, never 0 (bun test,
// real supervisor process). Node gives a signaled child a null exit code and
// the supervisor used to turn that into 0, so process:kill SIGTERM looked
// like a clean finish to every observer.
import { afterEach, expect, it } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { SupervisedProcessClient } from "../papercrane/supervisor";
import { workloadExitCode } from "../papercrane/exitStatus";

const MAIN = path.join(import.meta.dir, "..", "papercrane", "main.ts");
const children: ChildProcess[] = [];
const clients: SupervisedProcessClient[] = [];

afterEach(async () => {
    for (const client of clients.splice(0)) client.destroy();
    for (const child of children.splice(0)) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        child.kill("SIGTERM");
        await new Promise((resolve) => child.once("exit", resolve));
    }
});

it("reports a SIGTERMed workload as 143, not 0", async () => {
    const id = "signal-exit";
    const supervisor = spawn(process.execPath, [MAIN, "--supervise", id], { stdio: ["pipe", "ignore", "ignore"], env: process.env });
    children.push(supervisor);
    supervisor.stdin!.end(JSON.stringify({ command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] }));
    const client = new SupervisedProcessClient(id);
    clients.push(client);
    const exitCode = new Promise<number>((resolve) => client.on("exit", resolve));
    let connected = false;
    for (let i = 0; i < 100 && !(connected = await client.connect()); i++) await new Promise((r) => setTimeout(r, 50));
    expect(connected).toBe(true);
    await client.awaitStarted();
    client.kill("SIGTERM");
    expect(await exitCode).toBe(143);
}, 20_000);

it("keeps a real exit code and maps unknown ends to failure", () => {
    expect(workloadExitCode(3, null)).toBe(3);
    expect(workloadExitCode(0, null)).toBe(0);
    expect(workloadExitCode(null, "SIGKILL")).toBe(137);
    expect(workloadExitCode(null, null)).toBe(1);
});
