import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { serviceClient } from "../src/contract";
import { closeTransport, getTransport } from "../src/ipc";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { SERVICE, serviceContract } from "./helpers/contract";
import { startDaemon, type Daemon, type PanelProcess } from "./helpers/daemon";

const PARENT_SCRIPT = join(import.meta.dir, "helpers", "serviceParent.ts");

setDefaultTimeout(60_000);

// a panel's page and its service talk over internal blocks, through the
// real daemon: this test process is the page (the host, as the shell is)
let daemon: Daemon;
let panel: PanelProcess;

beforeAll(async () => {
    daemon = await startDaemon();
    panel = await daemon.startPanel(SERVICE, "service");
});

afterAll(async () => {
    await panel.stop();
    closeTransport();
    await daemon.stop();
});

test("the page reads the service's state, calls it, and hears each change and event", async () => {
    const client = serviceClient(serviceContract);
    try {
        expect(await client.state.refresh()).toEqual({ items: [] });
        const heard: unknown[] = [];
        let woke = () => {};
        const until = async (check: () => boolean) => {
            while (!check()) await new Promise<void>((resolve) => (woke = resolve));
        };
        const offState = client.state.subscribe(() => woke());
        const off = client.events.itemAdded((payload) => {
            heard.push(payload);
            woke();
        });
        await getTransport().subscriptionsSettled();
        expect(await client.calls.addItem({ name: "apple" })).toBe(1);
        expect(await client.calls.addItem({ name: "pear" })).toBe(2);
        await until(() => client.state.current().items.length === 2 && heard.length === 2);
        expect(client.state.current().items).toEqual(["apple", "pear"]);
        expect(heard).toEqual([{ name: "apple", count: 1 }, { name: "pear", count: 2 }]);
        off();
        offState();
    } finally {
        client.state.dispose();
    }
});

test("a call that gives nothing back answers undefined, and one that throws fails with its message", async () => {
    const client = serviceClient(serviceContract);
    try {
        expect(await client.calls.forget()).toBeUndefined();
        await expect(client.calls.fail()).rejects.toThrow("the service said no");
    } finally {
        client.state.dispose();
    }
});

test("a service whose start fails ends with the reason, so the daemon hears it at once", async () => {
    const child = daemon.spawnService("dev.test.broken", "brokenInit");
    let stderr = "";
    child.stderr!.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
    });
    const code = await new Promise<number | null>((resolve) => child.once("exit", (exitCode) => resolve(exitCode)));
    expect(code).toBe(1);
    expect(stderr).toContain("the config file is unreadable");
});

test("a service whose daemon dies ends too, so a restarted daemon never runs a second copy", async () => {
    const parent = spawn(process.execPath, [PARENT_SCRIPT], { env: daemon.serviceEnv("dev.test.orphan", "service"), stdio: ["ignore", "pipe", "inherit"] });
    const exited = new Promise<void>((resolve) => parent.once("exit", () => resolve()));
    const pid = await new Promise<number>((resolve, reject) => {
        let out = "";
        parent.stdout!.on("data", (chunk: Buffer) => {
            out += chunk.toString();
            const match = /SERVICE (\d+)/.exec(out);
            if (match) resolve(Number(match[1]));
        });
        void exited.then(() => reject(new Error(`the stand-in daemon exited before its service was ready:\n${out}`)));
    });
    const alive = () => {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false; // quiet: no such process is the answer
        }
    };
    parent.kill("SIGKILL");
    await exited;
    const deadline = Date.now() + 10_000;
    try {
        while (alive()) {
            if (Date.now() > deadline) throw new Error(`service ${pid} kept running after its daemon was killed`);
            await new Promise((resolve) => setTimeout(resolve, 25)); // quiet: a deadline-bound poll for the process to end
        }
    } finally {
        if (alive()) process.kill(pid, "SIGKILL");
    }
});
