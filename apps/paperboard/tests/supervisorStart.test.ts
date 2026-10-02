// A workload that cannot start is the creator's error (bun test, real
// supervisor process). On Windows every terminal failed to load conpty: the
// supervisor logged it and exited, but term:create had already answered
// success, so the terminal panel stayed blank and the gameserver's trash pty
// reported only a missing output marker. The supervisor now reports the
// start outcome in its status frame and the client rejects with the reason.
import { describe, it, expect, afterEach } from "bun:test";
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
        const code = await new Promise<number | null>((resolve) => {
            if (child.exitCode !== null) resolve(child.exitCode);
            else child.once("exit", (c) => resolve(c));
        });
        expect(code).toBe(1);
    }, 15_000);

    it("rejects with the missing working directory", async () => {
        const { client } = await superviseAndConnect("start-fail-cwd", {
            isPty: true,
            command: "/bin/sh",
            cwd: "/nonexistent/paperboard-test-cwd",
        });
        await expect(client.awaitStarted()).rejects.toThrow(
            "Working directory does not exist: /nonexistent/paperboard-test-cwd",
        );
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
});
