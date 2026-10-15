// A workload's output is decoded per stream, not per chunk. Each pipe read
// used to be decoded on its own, so a multibyte character split across two
// reads arrived as two U+FFFD; a JSON-RPC child (an ACP agent) printing any
// non-ASCII text had its messages corrupted at random.
import { afterEach, expect, it } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { EmbeddedSupervisor } from "../papercrane/embeddedSupervisor";
import { SupervisedProcessClient } from "../papercrane/supervisor";

const MAIN = path.join(import.meta.dir, "..", "papercrane", "main.ts");
// "€" is E2 82 AC: the first two bytes go out, then the last one in a later write
const SPLIT_EURO =
    'process.stdout.write(Buffer.from([0xe2, 0x82])); process.stderr.write(Buffer.from([0xe2, 0x82]));' +
    'setTimeout(() => { process.stdout.write(Buffer.from([0xac, 0x0a])); process.stderr.write(Buffer.from([0xac, 0x0a])); process.exit(0); }, 300);';

const children: ChildProcess[] = [];
const clients: SupervisedProcessClient[] = [];
const embedded: EmbeddedSupervisor[] = [];

afterEach(() => {
    for (const client of clients.splice(0)) client.destroy();
    for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGKILL");
    for (const workload of embedded.splice(0)) workload.kill("SIGKILL");
});

it("keeps a character split across two reads whole (supervisor process)", async () => {
    const id = "utf8-split";
    const supervisor = spawn(process.execPath, [MAIN, "--supervise", id], {
        stdio: ["pipe", "ignore", "ignore"],
        env: process.env,
    });
    children.push(supervisor);
    supervisor.stdin!.end(JSON.stringify({ command: process.execPath, args: ["-e", SPLIT_EURO] }));

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
    expect(await exitCode).toBe(0);
    expect(stdout.join("")).toBe("€\n");
    expect(stderr.join("")).toBe("€\n");
}, 15_000);

it("keeps a character split across two reads whole (embedded supervisor)", async () => {
    const workload = new EmbeddedSupervisor("utf8-split-embedded", {
        id: "utf8-split-embedded",
        type: "child_process",
        command: process.execPath,
        args: ["-e", SPLIT_EURO],
    });
    embedded.push(workload);
    const stdout: string[] = [];
    const stderr: string[] = [];
    workload.on("stdout", (d: string) => stdout.push(d));
    workload.on("stderr", (d: string) => stderr.push(d));
    const exited = new Promise<void>((resolve) => workload.on("exit", () => resolve()));
    expect(await workload.connect()).toBe(true);
    await exited;
    expect(stdout.join("")).toBe("€\n");
    expect(stderr.join("")).toBe("€\n");
}, 15_000);
