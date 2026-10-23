import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ComputerState } from "../src/contract";
import { Computer, type ComputerHost, type Support } from "../src/service/computer";
import { FakeProcesses } from "./fakeHost";

const dirs: string[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function make(o: { support?: Support; download?: ComputerHost["download"]; dir?: string } = {}) {
    const dir = o.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "ai-computer-"));
    if (!o.dir) dirs.push(dir);
    const procs = new FakeProcesses();
    const downloads: string[] = [];
    const host: ComputerHost = {
        ...procs,
        start: procs.start,
        kill: procs.kill,
        exists: procs.exists,
        onExit: procs.onExit,
        onStderr: procs.onStderr,
        exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
        download:
            o.download ??
            (async (d) => {
                downloads.push(d.url);
                throw new Error("checksum mismatch");
            }),
        getSecret: async () => null,
        setSecret: async () => {},
    };
    const states: ComputerState[] = [];
    const computer = new Computer({
        host,
        dir,
        storagePath: "computer",
        support: () => o.support ?? { ok: true, qemu: "/usr/bin/qemu-system-x86_64", qemuImg: "/usr/bin/qemu-img" },
        onState: (s) => states.push(s),
    });
    return { computer, states, dir, procs, downloads };
}

describe("the agent's computer", () => {
    test("never set up: none, and starting it asks for setup first", async () => {
        const { computer, states, procs } = make();
        await computer.init();
        expect(states.at(-1)).toMatchObject({ phase: "none", installed: false });
        await expect(computer.start()).rejects.toThrow(/Set up the computer first/);
        expect(procs.started).toEqual([]);
    });

    test("a machine that can't run it says why, and setup refuses", async () => {
        const { computer, states, downloads } = make({ support: { ok: false, reason: "No /dev/kvm." } });
        await computer.init();
        expect(states.at(-1)).toMatchObject({ phase: "unsupported", error: "No /dev/kvm." });
        await expect(computer.install({ memoryGb: 4, diskGb: 32 })).rejects.toThrow("No /dev/kvm.");
        expect(downloads).toEqual([]);
    });

    test("a failed setup shows the step it stopped at and stays not-installed, so the way out is setting up again", async () => {
        const { computer, states, dir } = make();
        await computer.init();
        await expect(computer.install({ memoryGb: 4, diskGb: 32 })).rejects.toThrow("checksum mismatch");
        const last = states.at(-1)!;
        expect(last).toMatchObject({ phase: "failed", installed: false, error: "checksum mismatch", budget: { memoryGb: 4, diskGb: 32 } });
        expect(last.steps.find((s) => s.id === "image")?.status).toBe("failed");
        expect(last.steps.filter((s) => s.status === "waiting").map((s) => s.id)).toEqual(["browser", "disk", "boot", "install"]);
        // unverified bytes leave no "verified" marker to be reused
        expect(fs.existsSync(path.join(dir, "base.qcow2.sha256"))).toBe(false);
    });

    test("an unreadable record is refused, not treated as never set up", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-computer-"));
        dirs.push(dir);
        fs.writeFileSync(path.join(dir, "computer.json"), "{ not json");
        const { computer } = make({ dir });
        await expect(computer.init()).rejects.toThrow();
        expect(fs.readFileSync(path.join(dir, "computer.json"), "utf8")).toBe("{ not json");
    });
});
