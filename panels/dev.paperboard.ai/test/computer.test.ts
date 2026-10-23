import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { ComputerState } from "../src/contract";
import { COMPUTER_PROC_ID, Computer, type ComputerHost, type Support } from "../src/service/computer";
import { FakeProcesses, until } from "./fakeHost";

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    for (const s of servers.splice(0)) {
        s.closeAllConnections();
        s.close();
    }
});

function make(o: { support?: Support; download?: ComputerHost["download"]; dir?: string; secret?: string; controlLeaseMs?: number } = {}) {
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
        getSecret: async () => o.secret ?? null,
        setSecret: async () => {},
    };
    const states: ComputerState[] = [];
    const computer = new Computer({
        host,
        dir,
        storagePath: "computer",
        support: () => o.support ?? { ok: true, qemu: "/usr/bin/qemu-system-x86_64", qemuImg: "/usr/bin/qemu-img" },
        onState: (s) => states.push(s),
        controlLeaseMs: o.controlLeaseMs,
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

/** A guest agent that records calls; a call to `hold` waits until released. */
async function fakeGuest(token: string) {
    const calls: { tool: string; args: Record<string, unknown> }[] = [];
    const held: (() => void)[] = [];
    const server = createServer((req, res) => {
        const reply = (body: unknown) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
        if (req.headers.authorization !== `Bearer ${token}`) return res.writeHead(401).end("{}");
        if (req.url === "/health") return reply({ ok: true });
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => {
            const call = JSON.parse(data);
            calls.push(call);
            const answer = () => reply(call.tool === "view_windows" ? { windows: [] } : { text: "ok" });
            if (call.args?.hold) held.push(answer);
            else answer();
        });
    });
    servers.push(server);
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    return { port: (server.address() as AddressInfo).port, calls, held };
}

/** A computer that's on: installed, its VM found running from an earlier service generation. */
async function ready(o: { controlLeaseMs?: number } = {}) {
    const guest = await fakeGuest("t0ken");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-computer-"));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, "computer.json"), JSON.stringify({ version: 1, installed: true, budget: { memoryGb: 4, diskGb: 32 }, port: guest.port }));
    const m = make({ dir, secret: "t0ken", ...o });
    m.procs.alive.add(COMPUTER_PROC_ID);
    await m.computer.init();
    expect(m.computer.state.phase).toBe("ready");
    return { ...m, guest };
}

describe("the user's view and control", () => {
    test("while the user has control the agent's hands are refused, and given back on release", async () => {
        const { computer, guest } = await ready();
        computer.takeControl();
        expect(computer.state.userControl).toBe(true);
        const refused = await computer.callTool("click", { mark: 1 });
        expect(refused).toMatchObject({ isError: true, text: expect.stringContaining("taken control") });
        expect(guest.calls.map((c) => c.tool)).toEqual([]);

        computer.releaseControl();
        expect(computer.state.userControl).toBe(false);
        expect(await computer.callTool("click", { mark: 1 })).toEqual({ text: "ok", image: undefined });
        expect(guest.calls.map((c) => c.tool)).toEqual(["click"]);
    });

    test("input needs control; looking doesn't", async () => {
        const { computer, guest } = await ready();
        await expect(computer.view("view_input", { window: 1, events: [] })).rejects.toThrow(/Take control/);
        expect(await computer.view("view_windows", {})).toEqual({ windows: [] });
        computer.takeControl();
        await computer.view("view_input", { window: 1, events: [] });
        expect(guest.calls.map((c) => c.tool)).toEqual(["view_windows", "view_input"]);
        computer.releaseControl();
    });

    test("an unrenewed lease runs out, so a closed shell can't hold the agent off", async () => {
        const { computer } = await ready({ controlLeaseMs: 40 });
        computer.takeControl();
        await until(() => !computer.state.userControl, 1000);
        expect((await computer.callTool("click", { mark: 1 })).isError).toBeUndefined();
    });

    test("stopping the computer ends control", async () => {
        const { computer, states } = await ready();
        computer.takeControl();
        await computer.stop();
        expect(states.at(-1)).toMatchObject({ phase: "stopped", userControl: false });
        expect(() => computer.takeControl()).toThrow(/isn't on/);
    });

    test("views have their own bound: a busy view refuses more views but never blocks the agent", async () => {
        const { computer, guest } = await ready();
        const views = [1, 2, 3].map(() => computer.view("view_frame", { window: 1, hold: true }));
        await until(() => guest.held.length === 3);
        await expect(computer.view("view_windows", {})).rejects.toThrow(/busy/);
        expect((await computer.callTool("shell", { command: "true" })).isError).toBeUndefined();
        for (const answer of guest.held.splice(0)) answer();
        await Promise.all(views);
        expect(await computer.view("view_windows", {})).toEqual({ windows: [] });
    });

    test("only view tools go through the view path", async () => {
        const { computer, guest } = await ready();
        await expect(computer.view("shell" as never, { command: "true" })).rejects.toThrow(/not a view/);
        expect(guest.calls).toEqual([]);
    });
});
