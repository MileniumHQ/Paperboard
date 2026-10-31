// A process's output reaches every socket that attached to it once per
// stream (bun test, real daemon socket, real supervisor and process). An
// attach used to wire the workload's combined "data" stream next to its
// stdout and stderr, so a panel service that started a process and then
// attached to it (the Game Server panel does both, and attaches again when
// it restarts) got every line twice: its console and chat showed each line
// twice, and a stdout reader (the Agents panel's MCP servers) read each
// message twice.
import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { PaperCraneAuth } from "../papercrane/auth";
import { PaperCraneEngine } from "../papercrane/engine";
import { setupWebSocketServer } from "../papercrane/ws";
import { CraneTransport } from "../../../packages/paperapi/src/ws";

const ID = "streams-test-process";

function viewer(port: number) {
    const transport = new CraneTransport({ port, token: "test-host", computerId: "local" });
    const streams = { stdout: "", stderr: "" };
    transport.subscribeSource("process:data", (payload: any) => {
        if (payload?.id === ID) streams[payload.stream as "stdout" | "stderr"] += payload.data;
    });
    return { transport, streams };
}

async function until(check: () => boolean, what: string) {
    const deadline = Date.now() + 10_000;
    while (!check()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await Bun.sleep(20);
    }
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

test("a process's stdout and stderr reach every attached socket once", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "process-streams-"));
    const bunExecutable = process.execPath;
    const launcherSource = path.join(root, "supervisor.ts");
    const launcher = path.join(root, process.platform === "win32" ? "supervisor.exe" : "supervisor");
    fs.writeFileSync(
        launcherSource,
        `import { runSupervisor } from ${JSON.stringify(path.resolve(import.meta.dir, "../papercrane/supervisor.ts"))}; await runSupervisor(process.argv.at(-1)!);`,
    );
    const build = Bun.spawnSync([bunExecutable, "build", launcherSource, "--compile", "--outfile", launcher]);
    if (build.exitCode !== 0) throw new Error(build.stderr.toString());
    process.execPath = launcher;
    const engine = new PaperCraneEngine(root);
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    auth.injectToken("test-host", "host");
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    setupWebSocketServer(wss, engine, auth);
    await once(wss, "listening");
    const port = (wss.address() as { port: number }).port;
    const service = viewer(port);
    const window = viewer(port);
    try {
        // a console: says each line it reads on stdout, and on stderr too
        const script = 'while read line; do echo "out-$line"; echo "err-$line" >&2; done';
        await service.transport.call("process:run", { id: ID, command: "sh", args: ["-c", script] });
        // the creator attaches too (processApi.onData), then a window does
        await service.transport.call("process:attach", { id: ID });
        await window.transport.call("process:attach", { id: ID });

        await service.transport.call("process:write", { id: ID, data: "42\n" });
        for (const v of [service, window]) {
            await until(() => v.streams.stdout.includes("out-42") && v.streams.stderr.includes("err-42"), "the reply");
        }
        // anything doubled would have landed by now
        await Bun.sleep(300);
        for (const v of [service, window]) {
            expect(count(v.streams.stdout, "out-42")).toBe(1);
            expect(count(v.streams.stderr, "err-42")).toBe(1);
            expect(v.streams.stdout).not.toContain("err-42");
        }
    } finally {
        await engine.killProcess(ID);
        process.execPath = bunExecutable;
        for (const v of [service, window]) v.transport.close();
        for (const socket of wss.clients) socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        auth.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 30_000);
