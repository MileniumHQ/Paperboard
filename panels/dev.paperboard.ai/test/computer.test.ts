import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { ComputerState } from "../src/contract";
import { COMPUTER_PROC_ID, Computer, NET_PROC_ID, type ComputerHost, type StartOptions, type Support } from "../src/service/computer";
import { GUEST_FILES, GUEST_PORT, GUEST_VERSION, META_DATA, updateCommand } from "../src/service/guest";
import { FakeProcesses, until } from "./fakeHost";

const dirs: string[] = [];
const servers: Server[] = [];
const sockets: net.Server[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    for (const s of servers.splice(0)) {
        s.closeAllConnections();
        s.close();
    }
    for (const s of sockets.splice(0)) s.close();
});

function make(o: { support?: Support; download?: ComputerHost["download"]; dir?: string; secret?: string; controlLeaseMs?: number; bootMs?: number } = {}) {
    const dir = o.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "ai-computer-"));
    if (!o.dir) dirs.push(dir);
    const procs = new FakeProcesses();
    const downloads: string[] = [];
    let secret = o.secret ?? null;
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
        getSecret: async () => secret,
        setSecret: async (_, v) => void (secret = v),
    };
    const states: ComputerState[] = [];
    const computer = new Computer({
        host,
        dir,
        storagePath: "computer",
        support: () => o.support ?? { ok: true, qemu: "/usr/bin/qemu-system-x86_64", qemuImg: "/usr/bin/qemu-img", passt: "/usr/bin/passt" },
        onState: (s) => states.push(s),
        controlLeaseMs: o.controlLeaseMs,
        bootMs: o.bootMs,
        healthPollMs: 20,
    });
    return { computer, states, dir, procs, downloads, secret: () => secret };
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
async function fakeGuest(token: string, o: { version?: string | null; shell?: string | ((command: string) => string); port?: number } = {}) {
    let version = o.version === undefined ? GUEST_VERSION : o.version;
    const calls: { tool: string; args: Record<string, unknown> }[] = [];
    const held: (() => void)[] = [];
    const server = createServer((req, res) => {
        const reply = (body: unknown) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
        if (req.headers.authorization !== `Bearer ${token}`) return res.writeHead(401).end("{}");
        if (req.url === "/health") return reply(version === null ? { ok: true } : { ok: true, version });
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => {
            const call = JSON.parse(data);
            calls.push(call);
            if (call.tool === "shell") {
                const text = typeof o.shell === "function" ? o.shell(String(call.args.command)) : (o.shell ?? "exit 0\nupdated");
                // the agent restarts on the files it was sent
                if (text.startsWith("exit 0")) setTimeout(() => (version = GUEST_VERSION), 50);
                return reply({ text });
            }
            const answer = () => reply(call.tool === "view_windows" ? { windows: [] } : { text: "ok" });
            if (call.args?.hold) held.push(answer);
            else answer();
        });
    });
    servers.push(server);
    await new Promise<void>((ok) => server.listen(o.port ?? 0, "127.0.0.1", ok));
    return { port: (server.address() as AddressInfo).port, calls, held };
}

/** A computer that's on: installed, its VM found running from an earlier service generation. */
async function found(guest: Awaited<ReturnType<typeof fakeGuest>>, o: { controlLeaseMs?: number } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-computer-"));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, "computer.json"), JSON.stringify({ version: 2, installed: true, budget: { memoryGb: 4, diskGb: 32 }, port: guest.port }));
    const m = make({ dir, secret: "t0ken", ...o });
    m.procs.alive.add(COMPUTER_PROC_ID);
    await m.computer.init();
    return m;
}

async function ready(o: { controlLeaseMs?: number } = {}) {
    const guest = await fakeGuest("t0ken");
    const m = await found(guest, o);
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

describe("the computer's budget", () => {
    test("memory changes for the next start and is kept; storage can't change without setting up again", async () => {
        const { computer, dir } = await ready();
        await computer.setBudget({ memoryGb: 8, diskGb: 32 });
        expect(computer.state.budget).toEqual({ memoryGb: 8, diskGb: 32 });
        expect(JSON.parse(fs.readFileSync(path.join(dir, "computer.json"), "utf8")).budget).toEqual({ memoryGb: 8, diskGb: 32 });
        await expect(computer.setBudget({ memoryGb: 8, diskGb: 64 })).rejects.toThrow(/Storage/);
    });

    test("a computer that was never set up has no budget to change", async () => {
        const { computer } = make();
        await computer.init();
        await expect(computer.setBudget({ memoryGb: 8, diskGb: 32 })).rejects.toThrow(/Set up/);
    });
});

describe("updating the guest agent", () => {
    const sent = (command: string) =>
        [...command.matchAll(/printf %s '([A-Za-z0-9+/=]+)' \| base64 -d > \/opt\/paperboard\/([a-z.]+)\.new/g)].map(([, b64, name]) => [name, Buffer.from(b64!, "base64").toString("utf8")]);

    test("an agent from an older version is replaced with this one's files before the computer is ready", async () => {
        const guest = await fakeGuest("t0ken", { version: null });
        const { computer, states } = await found(guest);
        expect(computer.state).toMatchObject({ phase: "ready", error: null });
        const shell = guest.calls.filter((c) => c.tool === "shell");
        expect(shell).toHaveLength(1);
        expect(Object.fromEntries(sent(String(shell[0]!.args.command)))).toEqual({ ...GUEST_FILES });
        // never ready on the old agent
        expect(states.findIndex((s) => s.phase === "ready")).toBe(states.length - 1);
    });

    test("an agent that can't be updated fails the computer with the reason, and the VM is stopped", async () => {
        const guest = await fakeGuest("t0ken", { version: "old", shell: "exit 1\nNo space left on device" });
        const { computer, procs } = await found(guest);
        expect(computer.state).toMatchObject({ phase: "failed", error: expect.stringContaining("No space left on device") });
        expect(procs.alive.has(COMPUTER_PROC_ID)).toBe(false);
    });

    test("a current agent is left alone", async () => {
        const guest = await fakeGuest("t0ken");
        await found(guest);
        expect(guest.calls).toEqual([]);
    });

    test("the update fits in one argument to the guest's shell", () => {
        expect(Buffer.byteLength(updateCommand())).toBeLessThan(128 * 1024); // Linux's MAX_ARG_STRLEN
    });

    test("the guest works out the same version from its files as the service does", () => {
        const dir = path.join(import.meta.dir, "../computer/guest");
        // agent.py's own _version, run on its own files (the rest of agent.py needs an X display)
        const script = `import ast, hashlib, os, sys
src = open(sys.argv[1]).read()
fn = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "_version")
ns = {"os": os, "hashlib": hashlib, "__file__": sys.argv[1]}
exec(compile(ast.Module([fn], []), "agent.py", "exec"), ns)
print(ns["_version"]())`;
        const r = Bun.spawnSync(["python3", "-I", "-c", script, path.join(dir, "agent.py")]);
        expect(r.stderr.toString()).toBe("");
        expect(r.stdout.toString().trim()).toBe(GUEST_VERSION);
    });
});

/**
 * Plays QEMU and passt from their argv: a setup boot (QEMU's own network) gets a guest that gives the agent
 * sudo after `sudoAfter` refusals and powers off when asked; a passt boot gets a guest on passt's forward,
 * and passt a real listening socket.
 */
function playVm({ procs, secret }: { procs: FakeProcesses; secret: () => string | null }, o: { sudoAfter?: number; sudoNever?: boolean } = {}) {
    const boots: { net: string; args: string[]; seed: Record<string, string> | null; shell: string[] }[] = [];
    let refusals = o.sudoAfter ?? 0;
    procs.onStart = async (s: StartOptions) => {
        if (s.id === NET_PROC_ID) {
            const server = net.createServer();
            sockets.push(server);
            await new Promise<void>((ok) => server.listen(s.args[s.args.indexOf("--socket") + 1]!, ok));
            return;
        }
        const netdev = s.args[s.args.indexOf("-netdev") + 1]!;
        const disk = s.args.find((a) => a.includes("file.driver=vvfat"))?.match(/file\.dir=([^,]+)/)?.[1];
        const boot = {
            net: netdev.split(",")[0]!,
            args: s.args,
            seed: disk ? Object.fromEntries(fs.readdirSync(disk).map((f) => [f, fs.readFileSync(path.join(disk, f), "utf8")])) : null,
            shell: [] as string[],
        };
        boots.push(boot);
        if (boot.net === "user") {
            const port = Number(netdev.match(/hostfwd=tcp:127\.0\.0\.1:(\d+)-/)![1]);
            await fakeGuest(secret()!, {
                port,
                shell: (command) => {
                    boot.shell.push(command);
                    if (command === "sudo -n true") return o.sudoNever || refusals-- > 0 ? "exit 1\nsudo: a password is required" : "exit 0\n";
                    if (command === "sudo -n systemctl poweroff") setTimeout(() => procs.exit(COMPUTER_PROC_ID, 0), 20);
                    return "exit 0\n";
                },
            });
        } else {
            const passt = procs.started.findLast((p) => p.id === NET_PROC_ID)!;
            const port = Number(passt.args[passt.args.indexOf("-t") + 1]!.match(/^127\.0\.0\.1\/(\d+):/)![1]);
            await fakeGuest(secret()!, { port });
        }
    };
    return boots;
}

describe("the computer's network and sudo", () => {
    const record = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "computer.json"), "utf8"));
    const v1 = () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-computer-"));
        dirs.push(dir);
        fs.writeFileSync(path.join(dir, "computer.json"), JSON.stringify({ version: 1, installed: true, budget: { memoryGb: 4, diskGb: 32 }, port: 1 }));
        return dir;
    };

    test("setup ends its seed boot by powering off once the agent has sudo, and is ready only behind passt", async () => {
        const m = make({
            secret: "t0ken",
            download: async () => {},
        });
        const boots = playVm(m);
        await m.computer.init();
        await m.computer.install({ memoryGb: 4, diskGb: 32 });
        expect(m.computer.state).toMatchObject({ phase: "ready", installed: true, error: null });
        expect(boots.map((b) => b.net)).toEqual(["user", "stream"]);
        expect(boots[0]!.args.some((a) => a.startsWith("type=1,serial=ds=nocloud;s=http://10.0.2.2:"))).toBe(true);
        expect(boots[0]!.shell).toEqual(["sudo -n true", "sudo -n systemctl poweroff"]);
        expect(boots[1]!.args.some((a) => a.startsWith("type=1,serial="))).toBe(false); // the seed isn't offered past setup
        expect(record(m.dir)).toMatchObject({ version: 2, installed: true });
        // never ready on the network that reaches this machine's loopback
        expect(m.states.findIndex((s) => s.phase === "ready")).toBe(m.states.length - 1);
    });

    test("passt forwards only the agent's port from loopback and gives the guest no address for the host", async () => {
        const m = make({ dir: v1(), secret: "t0ken" });
        playVm(m);
        await m.computer.init();
        const passt = m.procs.started.find((p) => p.id === NET_PROC_ID)!;
        const port = record(m.dir).port;
        expect(passt.args).toEqual(expect.arrayContaining(["--no-map-gw", "--one-off", "-u", "none", "-t", `127.0.0.1/${port}:${GUEST_PORT}`]));
        const qemu = m.procs.started.findLast((p) => p.id === COMPUTER_PROC_ID)!;
        expect(qemu.args).toContain(`stream,id=n0,server=off,addr.type=unix,addr.path=${path.join(m.dir, "net.sock")}`);
    });

    test("a computer from before sudo is migrated once: a seed disk gives the agent sudo, it powers off, then boots behind passt", async () => {
        const dir = v1();
        const m = make({ dir, secret: "t0ken" });
        m.procs.alive.add(COMPUTER_PROC_ID); // still running from before: not reattached, it restarts into the migration
        const boots = playVm(m, { sudoAfter: 2 }); // cloud-init is still giving it sudo when the agent first answers
        await m.computer.init();
        expect(m.procs.killed[0]).toEqual({ id: COMPUTER_PROC_ID, signal: "SIGTERM" });
        expect(m.computer.state).toMatchObject({ phase: "ready", error: null });
        expect(boots.map((b) => b.net)).toEqual(["user", "stream"]);
        const seed = boots[0]!.seed!;
        expect(seed["meta-data"]).not.toBe(META_DATA); // a new instance id, so cloud-init runs again
        expect(seed["user-data"]).toContain("agent ALL=(ALL) NOPASSWD:ALL");
        expect(seed["user-data"]).toContain("[systemctl, disable, --now, nftables]");
        expect(boots[0]!.shell).toEqual(["sudo -n true", "sudo -n true", "sudo -n true", "sudo -n systemctl poweroff"]);
        expect(record(dir).version).toBe(2);
        expect(fs.existsSync(path.join(dir, "seed-sudo"))).toBe(false);
    });

    test("a migration that doesn't give sudo fails, stops the VM, and stays to be run again", async () => {
        const dir = v1();
        const m = make({ dir, secret: "t0ken", bootMs: 200 });
        playVm(m, { sudoNever: true });
        await expect(m.computer.init()).rejects.toThrow(/didn't get sudo: exit 1\nsudo: a password is required/);
        expect(m.computer.state.phase).toBe("failed");
        expect(m.procs.alive.size).toBe(0);
        expect(record(dir).version).toBe(1);
    });

    test("passt going away stops the computer and says so; stopping stops the VM and then its network", async () => {
        const m = make({ dir: v1(), secret: "t0ken" });
        playVm(m);
        await m.computer.init();
        m.procs.exit(NET_PROC_ID, 1);
        await until(() => m.computer.state.phase === "failed");
        expect(m.computer.state.error).toMatch(/stopped unexpectedly.*its network \(passt\) stopped \(exit 1\)/);
        expect(m.procs.alive.size).toBe(0);

        await m.computer.start();
        expect(m.computer.state.phase).toBe("ready");
        m.procs.killed.length = 0;
        await m.computer.stop();
        expect(m.procs.killed.map((k) => k.id)).toEqual([COMPUTER_PROC_ID, NET_PROC_ID]);
        expect(m.procs.alive.size).toBe(0);
    });
});
