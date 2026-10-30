// A terminal's output reaches every socket that subscribed to it, once
// (bun test, real daemon socket, real supervisor and shell). The daemon used
// to keep one attached listener per terminal: a second viewer took the
// stream from the first, and a socket that created a shell and then attached
// to it (the Terminal panel's service does both) got every chunk twice, so
// its saved scrollback repeated each line. A shell started again under the
// same id also never reached sockets that had subscribed to the old one.
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

const ID = "streams-test-shell";

function viewer(port: number) {
    const transport = new CraneTransport({ port, token: "test-host", computerId: "local" });
    let output = "";
    let exits = 0;
    transport.subscribeSource("term:data", (payload: any) => {
        if (payload?.id === ID) output += payload.data;
    });
    transport.subscribeSource("term:exit", (payload: any) => {
        if (payload?.id === ID) exits++;
    });
    return { transport, output: () => output, exits: () => exits };
}

async function until(check: () => boolean, what: string) {
    const deadline = Date.now() + 10_000;
    while (!check()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await Bun.sleep(20);
    }
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

test("every subscriber gets each chunk once, across a shell starting again", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-streams-"));
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
    const late = viewer(port);
    try {
        // the late viewer subscribes before the shell exists
        expect(await late.transport.call("term:attach", { id: ID })).toEqual({ success: false });
        await service.transport.call("term:create", { id: ID, cols: 80, rows: 24 });
        // the creator attaches too, then a window does
        await service.transport.call("term:attach", { id: ID });
        await window.transport.call("term:attach", { id: ID });

        await window.transport.call("term:write", { id: ID, data: "echo one-$((40+2))\r" });
        for (const v of [service, window, late]) await until(() => v.output().includes("one-42"), "the first echo");
        // the command echoes once and prints once: "one-$((40+2))" and "one-42"
        for (const v of [service, window, late]) expect(count(v.output(), "one-42")).toBe(1);

        await window.transport.call("term:write", { id: ID, data: "exit\r" });
        for (const v of [service, window, late]) await until(() => v.exits() === 1, "the shell to exit");

        // the same id starts again: everyone still subscribed hears it
        await service.transport.call("term:create", { id: ID, cols: 80, rows: 24 });
        await service.transport.call("term:write", { id: ID, data: "echo two-$((40+2))\r" });
        for (const v of [service, window, late]) await until(() => v.output().includes("two-42"), "the second echo");
        for (const v of [service, window, late]) expect(count(v.output(), "two-42")).toBe(1);

        // a closed socket stops receiving; the others keep the stream
        late.transport.close();
        await service.transport.call("term:write", { id: ID, data: "echo three-$((40+2))\r" });
        for (const v of [service, window]) await until(() => v.output().includes("three-42"), "the third echo");
        expect(late.output()).not.toContain("three-42");
    } finally {
        await engine.destroyTerminal(ID);
        process.execPath = bunExecutable;
        for (const v of [service, window, late]) v.transport.close();
        for (const socket of wss.clients) socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        auth.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 30_000);

test("writing to a terminal that is not running fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-write-"));
    try {
        expect(() => new PaperCraneEngine(root).writeTerminal("no-such-shell", "ls\r")).toThrow(/not running/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
