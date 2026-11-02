// A workload's whole exit code reaches its observers (bun test, real
// supervisor process, Windows only). Bun on Windows reports a child's code
// cut to 8 bits, so a game that crashed with 0xC0000005 read as 5 and one
// that exited 256 read as 0, a clean stop: the Game Server panel did not
// restart it. The workloads end through ExitProcess, the one call that sets
// a whole code; there is no such code to produce elsewhere.
import { afterEach, describe, expect, it } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { SupervisedProcessClient } from "../papercrane/supervisor";

const MAIN = path.join(import.meta.dir, "..", "papercrane", "main.ts");
const EXIT_STATUS = path.join(import.meta.dir, "..", "papercrane", "exitStatus.ts");
const windowsUnderBun = process.platform === "win32" && Boolean(process.versions.bun);
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

async function supervisedExit(id: string, code: number): Promise<number> {
    const supervisor = spawn(process.execPath, [MAIN, "--supervise", id], { stdio: ["pipe", "ignore", "ignore"], env: process.env });
    children.push(supervisor);
    const script = `import { exitWithCode } from ${JSON.stringify(EXIT_STATUS)}; exitWithCode(${code});`;
    supervisor.stdin!.end(JSON.stringify({ command: process.execPath, args: ["-e", script] }));
    const client = new SupervisedProcessClient(id);
    clients.push(client);
    const exitCode = new Promise<number>((resolve) => client.on("exit", resolve));
    let connected = false;
    for (let i = 0; i < 100 && !(connected = await client.connect()); i++) await new Promise((r) => setTimeout(r, 50));
    expect(connected).toBe(true);
    return exitCode;
}

describe.skipIf(!windowsUnderBun)("exact exit codes on Windows", () => {
    it("reports a crash status as the whole code, not its low byte", async () => {
        expect(await supervisedExit("exact-exit-crash", 0xc0000005)).toBe(0xc0000005);
    }, 20_000);

    it("does not read a code that is a multiple of 256 as a clean exit", async () => {
        expect(await supervisedExit("exact-exit-256", 256)).toBe(256);
    }, 20_000);

    it("keeps an ordinary code as it is", async () => {
        expect(await supervisedExit("exact-exit-3", 3)).toBe(3);
        expect(await supervisedExit("exact-exit-0", 0)).toBe(0);
    }, 20_000);
});
