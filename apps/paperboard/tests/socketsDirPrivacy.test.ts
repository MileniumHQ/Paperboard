// supervisor endpoints and metadata are owner-only (bun test, real
// supervisor process): sockets/ is 0700 even when an older build left it
// world-readable, and the metadata file (args, env) is 0600.
import { it, expect, afterEach } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { SupervisedProcessClient, getSupervisorMetadataPath } from "../papercrane/supervisor";
import { getSocketsDir } from "../papercrane/paths";

const MAIN = path.join(import.meta.dir, "..", "papercrane", "main.ts");
const children: ChildProcess[] = [];
const clients: SupervisedProcessClient[] = [];

afterEach(() => {
    for (const client of clients.splice(0)) {
        client.kill("SIGKILL");
        client.destroy();
    }
    for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGKILL");
});

it.skipIf(process.platform === "win32")("keeps sockets/ and supervisor metadata private to the owner", async () => {
    const dir = getSocketsDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o755); // as an older build left it
    const id = "privacy-check";
    const child = spawn(process.execPath, [MAIN, "--supervise", id], { stdio: ["pipe", "ignore", "ignore"], env: process.env });
    children.push(child);
    child.stdin!.end(JSON.stringify({ isPty: false, command: "/bin/sh", args: ["-c", "sleep 30"], env: { RCON_PASSWORD: "hunter2" } }));
    const client = new SupervisedProcessClient(id);
    clients.push(client);
    for (let i = 0; i < 100 && !(await client.connect()); i++) await new Promise((r) => setTimeout(r, 50));
    expect(client.isConnected()).toBe(true);
    const meta = getSupervisorMetadataPath(id);
    for (let i = 0; i < 100 && !fs.existsSync(meta); i++) await new Promise((r) => setTimeout(r, 20));
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(meta).mode & 0o777).toBe(0o600);
}, 15_000);
