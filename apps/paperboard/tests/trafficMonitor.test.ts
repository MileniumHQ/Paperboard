// `paperapi monitor` against a real compiled daemon (bun test, real
// processes): the CLI subscribes with the handshake in its own
// PAPERBOARD_DIR, a panel-scoped socket and the host make calls, a real
// panel service restarts, a real supervised process runs, and the monitor's
// stdout shows each of them, with no secret value, token or payload in it.
import { test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { CraneTransport } from "../../../packages/paperapi/src/ws";
import type { MonitorRecord } from "../../../packages/paperapi/src/monitorProtocol";
import { compileCrane, startCrane, tempDir, type CraneDaemon } from "./craneDaemon";
import { startPaperCraneServer } from "../papercrane/index";
import { readCraneHandshake } from "../papercrane/handshake";
import { TrafficMonitor, summarizeParams } from "../papercrane/monitor";

const CLI = path.resolve(import.meta.dir, "../../../packages/paperapi/bin/cli.ts");
const ID = "dev.test.monitor";
const OTHER = "dev.test.monitor-other";
const SECRET = "hunter2-monitor-secret-value";

let root = "";
let dir = "";
let source = "";
let bin = "";
let daemon: CraneDaemon;
const transports: CraneTransport[] = [];
const monitors: Monitor[] = [];

interface Monitor {
    proc: ReturnType<typeof Bun.spawn>;
    stdout: () => string;
    stderr: () => string;
    records: () => MonitorRecord[];
}

function cliEnv() {
    const env: Record<string, string | undefined> = { ...process.env, PAPERBOARD_DIR: dir, NO_COLOR: "1" };
    delete env.FORCE_COLOR;
    return env;
}

let monitorCount = 0;

// the monitor writes straight to files: the test's own spawnSync calls block
// its event loop, and a pipe read through that loop can stall
function startMonitor(args: string[]): Monitor {
    const n = ++monitorCount;
    const outFile = path.join(root, `monitor-${n}.out`);
    const errFile = path.join(root, `monitor-${n}.err`);
    const proc = Bun.spawn([process.execPath, CLI, "monitor", "--json", ...args], { env: cliEnv(), stdout: Bun.file(outFile), stderr: Bun.file(errFile) });
    const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
    const monitor: Monitor = {
        proc,
        stdout: () => read(outFile),
        stderr: () => read(errFile),
        // a line still being written is not a record yet
        records: () => read(outFile).split("\n").slice(0, -1).filter(Boolean).map((line) => JSON.parse(line) as MonitorRecord),
    };
    monitors.push(monitor);
    return monitor;
}

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 15_000) {
    const deadline = Date.now() + ms;
    while (!(await check())) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await Bun.sleep(25);
    }
}

async function watching(monitor: Monitor) {
    await until(() => monitor.stderr().includes("Watching"), `the monitor to subscribe (stderr: ${monitor.stderr()})`);
}

function transport(token: string): CraneTransport {
    const t = new CraneTransport({ port: daemon.port, token, computerId: "local" });
    transports.push(t);
    return t;
}

async function panelTransport(panelId: string): Promise<CraneTransport> {
    const { token } = await transport(daemon.token).call("auth:panel-token", { panelId });
    return transport(token);
}

function cli(args: string[]) {
    const run = Bun.spawnSync([process.execPath, CLI, ...args], { env: cliEnv(), stdout: "pipe", stderr: "pipe" });
    return { code: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

// a panel service speaking the wire by hand: it registers "greet", answers
// its calls, then reports ready
const SERVICE = `
const panelId = process.env.PAPERBOARD_PANEL_ID;
const token = process.env.PAPERCRANE_PANEL_TOKEN;
const ws = new WebSocket("ws://127.0.0.1:" + process.env.PAPERCRANE_PORT);
ws.onopen = () => ws.send(JSON.stringify({ id: 1, action: "actions:register", params: {
    panelId, action: "greet", token, v: 2,
    schema: { id: "greet", name: "Greet", inputs: { name: { type: "string", required: true } } },
} }));
ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id === 1) {
        if (message.error) { console.error(message.error); process.exit(1); }
        process.send({ type: "paperboard:service-ready", panelId });
    }
    if (message.type === "action_call") {
        const name = message.args?.[0]?.name;
        ws.send(JSON.stringify(name
            ? { type: "action_reply", callId: message.callId, result: "Hello, " + name + "!" }
            : { type: "action_reply", callId: message.callId, error: "Name is required" }));
    }
};
setInterval(() => {}, 1000);
`;

beforeAll(async () => {
    root = tempDir("pb-traffic-monitor-");
    dir = path.join(root, "home");
    // the developer's working copy, linked in with the CLI; autostart off,
    // so the service starts when the test says, while the monitor watches
    source = path.join(root, "work", ID);
    fs.mkdirSync(path.join(source, "dist"), { recursive: true });
    fs.writeFileSync(path.join(source, "manifest.json"), JSON.stringify({ id: ID, name: "Monitor", version: "0.1.0", service: "./dist/service.mjs", autostart: false }));
    fs.writeFileSync(path.join(source, "dist", "index.html"), "<!doctype html><title>Monitor</title>");
    fs.writeFileSync(path.join(source, "dist", "service.mjs"), SERVICE);
    bin = await compileCrane(root);
    const link = cli(["link", source]);
    expect(link.stderr).toContain(`Linked Monitor (${ID})`);
    expect(link.code).toBe(0);
    expect(fs.realpathSync(path.join(dir, "panels", ID))).toBe(fs.realpathSync(source));
    daemon = await startCrane(bin, dir);
}, 90_000);

afterAll(async () => {
    for (const m of monitors) if (m.proc.exitCode === null) m.proc.kill("SIGKILL");
    for (const t of transports) t.close();
    if (daemon?.proc.exitCode === null) {
        daemon.proc.kill("SIGTERM");
        await daemon.proc.exited;
    }
    fs.rmSync(root, { recursive: true, force: true });
});

test("doctor says the service is not answering, and what to run", () => {
    const run = cli(["doctor", source]);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain("✓ Manifest    Monitor 0.1.0");
    expect(run.stdout).toContain("✓ Build       dist/index.html, dist/service.mjs");
    expect(run.stdout).toContain("✓ Link");
    expect(run.stdout).toContain(`✓ Paperboard  running at 127.0.0.1:${daemon.port}`);
    expect(run.stdout).toContain("✗ Service     not answering: it has registered nothing with Paperboard");
    expect(run.stdout).toContain("→ paperapi restart starts it");
    expect(run.stdout).toContain("1 problem.");
});

test("the monitor prints each call, event, service and process change as it happens, values redacted", async () => {
    const monitor = startMonitor([]);
    await watching(monitor);

    const panel = await panelTransport(ID);
    await panel.call("secrets:set", { panelId: ID, name: "apiKey", value: SECRET });
    await expect(panel.call("no:such-action", {})).rejects.toThrow(/Unknown action/);
    await panel.call("actions:emit", { panelId: ID, event: "pinged", payload: { secret: SECRET } });
    await panel.call("process:run", { id: "monitor-probe", command: "/bin/sh", args: ["-c", "exit 3"] });

    // the CLI's own restart is a host call, and it starts the real service
    const restart = cli(["restart", source]);
    expect(restart.stderr).toContain(`Restarted ${ID}'s service`);
    expect(restart.code).toBe(0);

    // the CLI calls the service's action as the host, and prints the result as JSON
    const greeted = cli(["call", ID, "greet", '{"name":"Ada"}']);
    expect({ code: greeted.code, stdout: greeted.stdout }).toEqual({ code: 0, stdout: '"Hello, Ada!"\n' });
    const refused = cli(["call", ID, "greet", "{}"]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(`✗ ${ID} greet failed: Name is required`);
    const listed = cli(["call", ID]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("greet  Greet  (name: string)");

    const has = (match: (r: MonitorRecord) => boolean) => monitor.records().some(match);
    await until(() =>
        has((r) => r.type === "rpc" && r.method === "secrets:set") &&
        has((r) => r.type === "rpc" && r.method === "no:such-action") &&
        has((r) => r.type === "event") &&
        has((r) => r.type === "workload" && r.state === "exited") &&
        has((r) => r.type === "service" && r.state === "ready") &&
        has((r) => r.type === "rpc" && r.method === "panel:restartService") &&
        monitor.records().filter((r) => r.type === "rpc" && r.method === "actions:call").length === 2,
    `every record (got ${monitor.stdout()}; stderr: ${monitor.stderr()}; exit: ${monitor.proc.exitCode})`);
    const records = monitor.records();

    const set = records.find((r) => r.type === "rpc" && r.method === "secrets:set");
    expect(set).toMatchObject({ panel: ID, target: ID, ok: true, args: { panelId: ID, name: "apiKey", value: { type: "string", size: SECRET.length } } });
    expect(typeof (set as { ms: number }).ms).toBe("number");

    expect(records.find((r) => r.type === "rpc" && r.method === "no:such-action")).toMatchObject({ panel: ID, ok: false, code: "NOT_FOUND", error: "Unknown action: no:such-action" });
    expect(records.find((r) => r.type === "event")).toMatchObject({ panel: ID, event: `actions:${ID}:pinged`, recipients: 0 });
    expect(records.filter((r) => r.type === "workload")).toEqual([
        expect.objectContaining({ panel: ID, id: "monitor-probe", state: "started" }),
        expect.objectContaining({ panel: ID, id: "monitor-probe", state: "exited", code: 3 }),
    ]);
    expect(records.filter((r) => r.type === "service").map((r) => (r as { state: string }).state)).toEqual(["starting", "ready"]);
    expect(records.find((r) => r.type === "rpc" && r.method === "panel:restartService")).toMatchObject({ panel: null, target: ID, ok: true });
    expect(records.find((r) => r.type === "rpc" && r.method === "actions:register")).toMatchObject({ panel: ID, ok: true, args: { action: "greet" } });
    const calls = records.filter((r) => r.type === "rpc" && r.method === "actions:call");
    expect(calls).toEqual([
        expect.objectContaining({ panel: null, target: ID, ok: true, args: expect.objectContaining({ action: "greet", args: { type: "array", size: 1 } }) }),
        expect.objectContaining({ panel: null, target: ID, ok: false, error: "Name is required" }),
    ]);
    // an action's inputs are content: shown by shape only
    expect(monitor.stdout()).not.toContain("Ada");

    // what a monitor must never show
    for (const secret of [SECRET, daemon.token]) expect(monitor.stdout()).not.toContain(secret);
    expect(monitor.stdout()).not.toContain('"token"');

    monitor.proc.kill("SIGINT");
    expect(await monitor.proc.exited).toBe(0);
}, 60_000);

test("a workload that exits at once is still shown starting before it exits", async () => {
    const monitor = startMonitor([]);
    await watching(monitor);
    const panel = await panelTransport(ID);
    // a process that exits at once can report its exit before its start
    // resolves; several at a time make that ordering race show
    const ids = Array.from({ length: 12 }, (_, i) => `order-probe-${i}`);
    await Promise.all(ids.map((id) => panel.call("process:run", { id, command: "/bin/sh", args: ["-c", "exit 3"] })));
    const workloads = () => monitor.records().filter((r) => r.type === "workload") as { id: string; state: string }[];
    await until(() => workloads().filter((r) => r.state === "exited").length === ids.length, `every probe to exit (got ${monitor.stdout()})`);
    for (const id of ids) {
        expect(workloads().filter((r) => r.id === id).map((r) => r.state)).toEqual(["started", "exited"]);
    }
    monitor.proc.kill("SIGINT");
    expect(await monitor.proc.exited).toBe(0);
}, 60_000);

test("doctor is satisfied once the service answers", () => {
    const run = cli(["doctor", source]);
    expect(run.stdout).toContain("✓ Service     answering, with 1 action registered");
    expect(run.stdout).toContain("Ready: Paperboard can run this panel.");
    expect(run.code).toBe(0);
});

test("--panel keeps only what involves that panel", async () => {
    const monitor = startMonitor(["--panel", ID]);
    await watching(monitor);
    const other = await panelTransport(OTHER);
    await other.call("secrets:list", { panelId: OTHER });
    const mine = await panelTransport(ID);
    await mine.call("secrets:list", { panelId: ID });
    // a host call naming the panel involves it too
    await transport(daemon.token).call("actions:list", { panelId: ID });
    await until(() => monitor.records().some((r) => r.type === "rpc" && r.method === "actions:list"), "the host call naming the panel");
    const records = monitor.records();
    expect(records.every((r) => r.panel === ID || (r.type === "rpc" && r.target === ID))).toBe(true);
    expect(records.some((r) => r.type === "rpc" && r.method === "secrets:list" && r.panel === ID)).toBe(true);
    expect(records.some((r) => r.panel === OTHER)).toBe(false);
    monitor.proc.kill("SIGINT");
    expect(await monitor.proc.exited).toBe(0);
}, 30_000);

test("only this computer's host token may subscribe", async () => {
    const panel = await panelTransport(ID);
    await expect(panel.call("monitor:subscribe", {})).rejects.toThrow(/host credential/);
    const { token: relay } = await transport(daemon.token).call("auth:panel-token", { panelId: ID, relayTo: "elsewhere" });
    await expect(transport(relay).call("monitor:subscribe", {})).rejects.toThrow(/refused/);
    expect((await transport(daemon.token).call("monitor:subscribe", {})).protocol).toBe(1);
}, 30_000);

test("a paired computer's full-authority token may not subscribe", async () => {
    // in process, so the test can hold a second host-authority token, as a
    // paired computer does; this daemon's handshake is the preload's
    const server = await startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });
    const paired = "pct_" + "e".repeat(48);
    server.auth.injectToken(paired, "paired laptop");
    const pairedApi = new CraneTransport({ port: server.localPort, token: paired, computerId: "local" });
    const host = readCraneHandshake()!;
    const hostApi = new CraneTransport({ port: server.localPort, token: host.token, computerId: "local" });
    try {
        // full authority otherwise: a host-only call answers
        expect(await pairedApi.call("service:count", {})).toMatchObject({ running: 0 });
        await expect(pairedApi.call("monitor:subscribe", {})).rejects.toThrow(/host credential/);
        expect((await hostApi.call("monitor:subscribe", {})).protocol).toBe(1);
    } finally {
        pairedApi.close();
        hostApi.close();
        server.stop();
    }
}, 30_000);

test("a monitor waits through a daemon restart and watches the new one", async () => {
    const monitor = startMonitor([]);
    await watching(monitor);
    // the old daemon's clients go with it, so none of them retries in the background
    for (const t of transports.splice(0)) t.close();
    daemon.proc.kill("SIGTERM");
    expect(await daemon.proc.exited).toBe(0);
    await until(() => monitor.stderr().includes("Waiting for it to come back"), "the monitor to notice");
    daemon = await startCrane(bin, dir);
    await until(() => monitor.stderr().includes("Watching again"), `the monitor to reconnect (stderr: ${monitor.stderr()})`);
    await transport(daemon.token).call("system:ip", {});
    await until(() => monitor.records().some((r) => r.type === "rpc" && r.method === "system:ip"), "a call on the new daemon");
    monitor.proc.kill("SIGINT");
    expect(await monitor.proc.exited).toBe(0);
}, 60_000);

test("the monitor, call and doctor say plainly when Paperboard is not running", () => {
    const empty = tempDir("pb-traffic-monitor-empty-");
    try {
        const run = Bun.spawnSync([process.execPath, CLI, "monitor"], { env: { ...cliEnv(), PAPERBOARD_DIR: empty }, stdout: "pipe", stderr: "pipe" });
        expect(run.exitCode).toBe(1);
        expect(run.stderr.toString()).toContain(`Paperboard isn't running: there is no ${path.join(empty, "local", "crane.json")}`);
    } finally { fs.rmSync(empty, { recursive: true, force: true }); }
});

test("the tap builds nothing and holds no lifecycle feed until someone subscribes, and lets go after the last", () => {
    let attached = 0;
    let detached = 0;
    const sent: string[] = [];
    const monitor = new TrafficMonitor(() => {
        attached++;
        return () => { detached++; };
    }, (_socket, payload) => {
        sent.push(payload);
        return true;
    });
    const call = { panel: ID, method: "secrets:get", params: { panelId: ID, name: "apiKey" }, at: Date.now(), started: performance.now() };
    monitor.rpc(call);
    monitor.event(ID, "actions:x:y", "{}", 0);
    expect({ active: monitor.active, attached, sent }).toEqual({ active: false, attached: 0, sent: [] });

    const a = { close: () => undefined } as never;
    const b = { close: () => undefined } as never;
    monitor.subscribe(a, null);
    monitor.subscribe(b, OTHER);
    expect(attached).toBe(1);
    monitor.rpc(call);
    // b watches another panel, so only a hears this call
    expect(sent).toHaveLength(1);
    monitor.unsubscribe(a);
    expect(detached).toBe(0);
    monitor.unsubscribe(b);
    expect({ active: monitor.active, detached }).toEqual({ active: false, detached: 1 });
});

test("a watcher that cannot keep up is closed with the reason, never fed a feed with holes", () => {
    const closes: Array<[number, string]> = [];
    const monitor = new TrafficMonitor(() => () => undefined, () => false);
    const slow = { close: (code: number, reason: string) => closes.push([code, reason]) } as never;
    monitor.subscribe(slow, null);
    monitor.event(null, "actions:registry-updated", "{}", 0);
    expect(closes).toEqual([[4429, "Slow monitor consumer"]]);
    expect(monitor.active).toBe(false);
});

test("arguments show the names the protocol defines and only the shape of everything else", () => {
    expect(summarizeParams({
        panelId: ID, name: "apiKey", value: SECRET, token: "pc_secret", v: 2,
        args: [{ secret: SECRET }], payload: { secret: SECRET, more: 1 }, env: { API_KEY: SECRET },
        id: "x".repeat(300), cols: 80, url: "https://example.com/?key=" + SECRET,
    })).toEqual({
        panelId: ID, name: "apiKey", value: { type: "string", size: SECRET.length },
        args: { type: "array", size: 1 }, payload: { type: "object", keys: ["secret", "more"] }, env: { type: "object", keys: ["API_KEY"] },
        id: { type: "string", size: 300 }, cols: 80, url: { type: "string", size: 25 + SECRET.length },
    });
});
