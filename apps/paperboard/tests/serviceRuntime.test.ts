// Regression: a compiled PaperCrane binary runs panel services on its own.
//
// panelServices chose an external `node`/`bun` from PATH and refused to start
// a panel service without one. A remote machine running only the compiled
// daemon (which embeds Bun's runtime) therefore never started any panel
// service, so the shell's readiness challenge failed with
// `Action "__getState" ... is not registered or unavailable` on every panel.
//
// The daemon now re-invokes its own executable in --panel-service mode to run
// the installed service module in a real, stoppable child process. This test
// crosses the real boundary: it compiles the daemon entrypoint, runs that
// binary as a remote daemon, and hydrates the panel through the authenticated
// pinned-TLS tunnel from a real local daemon.
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CraneTransport } from "../../../packages/paperapi/src/ws";
import { startPaperCraneServer } from "../papercrane/index";
import { resolveServiceRuntime } from "../papercrane/panelServices";

const PANEL = "dev.test.compiledpanel";
const ENTRY = path.resolve(import.meta.dir, "../papercrane/main.ts");
let tmp = "";
let bin = "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// the daemon stays alive, so its stdout never EOFs: read until the port line
async function readListeningPort(stream: ReadableStream<Uint8Array>): Promise<number> {
    const reader = stream.getReader();
    let buf = "";
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value);
        const match = /Listening on https?:\/\/[^:]+:(\d+)/.exec(buf);
        if (match) return Number(match[1]);
    }
    throw new Error(`compiled daemon did not report a listening port: ${buf}`);
}

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-compiled-svc-"));
    bin = path.join(tmp, process.platform === "win32" ? "papercrane-test.exe" : "papercrane-test");
    const build = Bun.spawn([process.execPath, "build", "--compile", ENTRY, "--outfile", bin], {
        cwd: path.resolve(import.meta.dir, ".."),
        stdout: "pipe",
        stderr: "pipe",
    });
    const [code, err] = await Promise.all([build.exited, new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`bun build --compile failed (${code}): ${err}`);
}, 60_000);

afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("service runtime decision", () => {
    const versions = { ...process.versions } as NodeJS.ProcessVersions;

    test("a compiled daemon runs services through its own entrypoint", () => {
        const compiled = { ...versions, bun: versions.bun ?? "1.0.0", electron: undefined } as unknown as NodeJS.ProcessVersions;
        expect(resolveServiceRuntime("/opt/papercrane", compiled, "linux", "")).toEqual({
            command: "/opt/papercrane",
            prefix: ["--panel-service"],
        });
    });

    test("node, bun and electron keep running the module directly", () => {
        expect(resolveServiceRuntime("/usr/bin/node", { ...versions, bun: undefined, electron: undefined } as unknown as NodeJS.ProcessVersions, "linux", "")).toEqual({ command: "/usr/bin/node", prefix: [] });
        expect(resolveServiceRuntime("/usr/bin/bun", versions, "linux", "")).toEqual({ command: "/usr/bin/bun", prefix: [] });
        expect(resolveServiceRuntime("/usr/bin/electron", { ...versions, electron: "44.0.0" } as unknown as NodeJS.ProcessVersions, "linux", "")).toEqual({ command: "/usr/bin/electron", prefix: [] });
    });

    test("a foreign launcher with no embedded runtime falls back to PATH, then refuses", () => {
        const foreign = { ...versions, bun: undefined, electron: undefined } as unknown as NodeJS.ProcessVersions;
        expect(resolveServiceRuntime("/opt/weird", foreign, "linux", "/nonexistent")).toBeNull();
    });
});

test("compiled daemon runs a panel service with no external Node/Bun, and hydration reaches it", async () => {
    const remoteDir = fs.mkdtempSync(path.join(tmp, "remote-"));
    const localDir = fs.mkdtempSync(path.join(tmp, "local-"));
    const panelDir = path.join(remoteDir, "panels", PANEL);
    fs.mkdirSync(panelDir, { recursive: true });
    fs.writeFileSync(path.join(panelDir, "manifest.json"), JSON.stringify({ id: PANEL, name: "Compiled Fixture", version: "1.0.0", service: "./service.js" }));
    fs.writeFileSync(path.join(panelDir, "service.js"), `
const panelId = process.env.PAPERBOARD_PANEL_ID;
const ws = new WebSocket("ws://127.0.0.1:" + process.env.PAPERCRANE_PORT);
ws.onopen = () => ws.send(JSON.stringify({ id: 1, action: "auth:verify", params: { token: process.env.PAPERCRANE_PANEL_TOKEN } }));
ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id === 1 && !m.error) ws.send(JSON.stringify({ id: 2, action: "actions:register", params: { panelId, action: "__getState" } }));
    if (m.id === 2 && !m.error && process.send) process.send({ type: "paperboard:service-ready", panelId });
    if (m.type === "action_call") ws.send(JSON.stringify({ type: "action_reply", callId: m.callId, result: { compiled: true } }));
};
`);

    // port 0: read the TLS port the daemon reports, so parallel tests never collide
    const child = Bun.spawn([bin, "--host", "0.0.0.0", "--port", "0", "--headless"], {
        env: { ...process.env, PAPERBOARD_DIR: remoteDir },
        stdout: "pipe",
        stderr: "pipe",
    });
    let local: Awaited<ReturnType<typeof startPaperCraneServer>> | undefined;
    let transport: CraneTransport | undefined;
    try {
        const remotePort = await readListeningPort(child.stdout);
        const craneFile = path.join(remoteDir, "local", "crane.json");
        const deadline = Date.now() + 8000;
        while (!fs.existsSync(craneFile)) {
            if (Date.now() > deadline || child.exitCode !== null) throw new Error("compiled daemon never wrote its handshake");
            await sleep(20);
        }
        const crane = JSON.parse(fs.readFileSync(craneFile, "utf8")) as { token: string };
        const cert = JSON.parse(fs.readFileSync(path.join(remoteDir, "local", "tls_identity.json"), "utf8")).cert as string;

        const remotesFile = path.join(localDir, "remotes.json");
        fs.writeFileSync(remotesFile, JSON.stringify({ computers: [{ id: "remote", name: "remote", host: "127.0.0.1", port: remotePort, token: crane.token, cert }] }));
        local = await startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false, staticToken: "local-host-token", remotesFile });
        const token = local.auth.issuePanelToken(PANEL);
        transport = new CraneTransport({ port: local.localPort, token, computerId: "remote", panelId: PANEL });
        await transport.ensureConnected();

        // the child service may still be registering; poll the real call
        let result: any;
        const callDeadline = Date.now() + 10_000;
        while (true) {
            try {
                result = await transport.call<any>("actions:call", { panelId: PANEL, action: "__getState", args: [] });
                break;
            } catch (err) {
                if (Date.now() > callDeadline) throw err;
                await sleep(100);
            }
        }
        expect(result).toEqual({ result: { compiled: true } });
    } finally {
        transport?.close();
        local?.stop();
        child.kill();
        await child.exited;
        fs.rmSync(remoteDir, { recursive: true, force: true });
        fs.rmSync(localDir, { recursive: true, force: true });
    }
}, 60_000);
