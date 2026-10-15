// Stopping a supervised workload ends its whole tree on Windows. A
// `cmd /c ping` wrapper's grandchild holds the output pipes, so killing only
// the wrapper left the workload running and process removal was refused
// ("did not stop"). The argv/fallback tests run everywhere; the real-process
// test runs where the bug exists (Windows).
import { afterEach, describe, expect, it } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { killWorkload, taskkillCommand } from "../papercrane/processTree";
import { SupervisedProcessClient } from "../papercrane/supervisor";

const MAIN = path.join(import.meta.dir, "..", "papercrane", "main.ts");
const children: ChildProcess[] = [];
const clients: SupervisedProcessClient[] = [];

afterEach(async () => {
    for (const client of clients.splice(0)) client.destroy();
    for (const child of children.splice(0)) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        child.kill("SIGKILL");
        await new Promise((resolve) => child.once("exit", resolve));
    }
});

const fakeChild = (pid: number | undefined) => {
    const signals: string[] = [];
    return { child: { pid, kill: (s: string) => { signals.push(s); return true; } } as never, signals };
};

describe("killWorkload", () => {
    it("ends the whole tree on Windows with an argv-array taskkill", () => {
        const { child, signals } = fakeChild(4242);
        const calls: { file: string; args: string[] }[] = [];
        killWorkload(child, "SIGTERM", "win32", (file, args) => calls.push({ file, args }), "C:\\Windows");
        expect(calls).toEqual([{ file: taskkillCommand(4242, "C:\\Windows").file, args: ["/PID", "4242", "/T", "/F"] }]);
        expect(calls[0]!.file).toBe("C:\\Windows\\System32\\taskkill.exe");
        expect(signals).toEqual([]);
    });

    it("falls back to killing the child alone when taskkill fails", () => {
        const { child, signals } = fakeChild(4242);
        killWorkload(child, "SIGTERM", "win32", () => { throw new Error("taskkill exploded"); });
        expect(signals).toEqual(["SIGTERM"]);
    });

    it("keeps the plain signal on POSIX", () => {
        const { child, signals } = fakeChild(4242);
        killWorkload(child, "SIGKILL", "linux", () => { throw new Error("must not run"); });
        expect(signals).toEqual(["SIGKILL"]);
    });
});

it.skipIf(process.platform !== "win32")("a killed `cmd /c ping` workload exits instead of leaking its grandchild", async () => {
    const id = "tree-kill";
    const supervisor = spawn(process.execPath, [MAIN, "--supervise", id], { stdio: ["pipe", "ignore", "ignore"], env: process.env });
    children.push(supervisor);
    supervisor.stdin!.end(JSON.stringify({ command: "cmd.exe", args: ["/c", "ping", "-n", "60", "127.0.0.1"] }));
    const client = new SupervisedProcessClient(id);
    clients.push(client);
    const exited = new Promise<number>((resolve) => client.on("exit", resolve));
    let connected = false;
    for (let i = 0; i < 100 && !(connected = await client.connect()); i++) await new Promise((r) => setTimeout(r, 50));
    expect(connected).toBe(true);
    await client.awaitStarted();
    client.kill("SIGTERM");
    const outcome = await Promise.race([exited, new Promise<"leaked">((r) => setTimeout(() => r("leaked"), 8000))]);
    expect(outcome).not.toBe("leaked");
}, 20_000);
