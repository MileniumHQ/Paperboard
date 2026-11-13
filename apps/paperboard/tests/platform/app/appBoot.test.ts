import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
import { BUILD_TIMEOUT_MS, buildApp, buildCrane, type BuiltApp, type BuiltCrane } from "./support/build";
import { CraneSocket, readHandshake, startCrane, WAIT_MS } from "./support/crane";
import { domCondition, launchElectron } from "./support/electron";
import { tempDir } from "./support/temp";

const SHELL = "paperboard://shell/";

let app: BuiltApp;
let crane: BuiltCrane;
beforeAll(async () => {
    [app, crane] = await Promise.all([buildApp(), buildCrane()]);
}, BUILD_TIMEOUT_MS);

// The desktop app boots to a working shell on every target.
describe("desktop app boot", () => {
    test("adopts the running daemon, loads the packaged shell with no errors, and quits leaving the daemon's workloads running", async () => {
        const dataDir = tempDir("app-boot");
        const daemon = await startCrane(crane.file, dataDir);
        const host = await CraneSocket.authed(daemon.handshake.port, daemon.handshake.token);
        await host.call("process:run", {
            id: "boot-workload",
            command: process.execPath,
            args: ["-e", "setInterval(() => {}, 1000)"],
        });

        const electron = await launchElectron({ appDir: app.dir, dataDir, args: ["--skip-update"] });
        await electron.waitEvent("shell page", (e) => e.event === "loaded" && e.url === `${SHELL}index.html`);
        // the shell reached the daemon through its own connection: the
        // local computer is listed from what the daemon answered
        await electron.evalIn(SHELL, domCondition(`document.body.innerText.includes("This Computer")`));
        expect(await electron.evalIn(SHELL, "location.origin")).toBe("paperboard://shell");

        // adopted, not replaced: the daemon's handshake is the one it wrote,
        // and the app holds the credential only after its identity proof
        expect(readHandshake(dataDir).startId).toBe(daemon.handshake.startId);
        const credentials = await electron.evalIn(SHELL, `window.electron.ipcRenderer.invoke("crane-credentials")`);
        expect(credentials).toEqual({ computerId: "local", port: daemon.handshake.port, token: daemon.handshake.token });

        expect(electron.failures()).toEqual([]);
        const exit = await electron.quit();
        expect(exit).toEqual({ code: 0, signal: null });

        // the daemon and its workload outlive the app
        expect(daemon.child.exitCode).toBeNull();
        expect(await host.call("process:exists", { id: "boot-workload" })).toEqual({ running: true });
        await host.call("process:kill", { id: "boot-workload" });
        host.close();
        await daemon.stop();
        expect(errorLines(dataDir)).toEqual([]);
    }, WAIT_MS * 3);

    test("with no daemon running, starts its own, proves it, and serves the shell from it", async () => {
        const dataDir = tempDir("app-boot-fresh");
        const electron = await launchElectron({ appDir: app.dir, dataDir, args: ["--skip-update"] });
        await electron.waitEvent("shell page", (e) => e.event === "loaded" && e.url === `${SHELL}index.html`);
        await electron.evalIn(SHELL, domCondition(`document.body.innerText.includes("This Computer")`));
        const handshake = readHandshake(dataDir);
        // the daemon runs inside the app's own main process
        expect(handshake.pid).toBe(electron.child.pid!);
        const socket = await CraneSocket.authed(handshake.port, handshake.token);
        expect((await socket.call("system:info")).service).toBe("papercrane");
        socket.close();
        expect(electron.failures()).toEqual([]);
        expect(await electron.quit()).toEqual({ code: 0, signal: null });
        expect(errorLines(dataDir)).toEqual([]);
    }, WAIT_MS * 3);

    // The app's own daemon reaches a supervisor by its socket's path, and a
    // unix socket path has a short limit (103 bytes on macOS, 107 on Linux)
    // that a deep data folder passes.
    test("runs a workload from a data folder deeper than a socket path may be long", async () => {
        const dataDir = path.join(tempDir("app-deep"), "d".repeat(60), "e".repeat(60));
        fs.mkdirSync(dataDir, { recursive: true });
        expect(Buffer.byteLength(path.join(dataDir, "sockets", `${"0".repeat(32)}.sock`))).toBeGreaterThan(108);
        const electron = await launchElectron({ appDir: app.dir, dataDir, args: ["--skip-update"] });
        await electron.waitEvent("shell page", (e) => e.event === "loaded" && e.url === `${SHELL}index.html`);
        await electron.evalIn(SHELL, domCondition(`document.body.innerText.includes("This Computer")`));
        const handshake = readHandshake(dataDir);
        expect(handshake.pid).toBe(electron.child.pid!);
        const socket = await CraneSocket.authed(handshake.port, handshake.token);
        await socket.call("process:run", { id: "deep-workload", command: process.execPath, args: ["-e", "console.log('from the deep'); setInterval(() => {}, 1000)"] });
        await socket.waitFrame("the workload's output", (f) => f.type === "event" && f.event === "process:data" && f.payload.id === "deep-workload" && String(f.payload.data).includes("from the deep"));
        expect(await socket.call("process:exists", { id: "deep-workload" })).toEqual({ running: true });
        await socket.call("process:kill", { id: "deep-workload" });
        await socket.waitFrame("the workload's exit", (f) => f.type === "event" && f.event === "process:exit" && f.payload.id === "deep-workload");
        socket.close();
        expect(electron.failures()).toEqual([]);
        expect(await electron.quit()).toEqual({ code: 0, signal: null });
        expect(errorLines(dataDir)).toEqual([]);
    }, WAIT_MS * 3);
});

// what the app and daemon logged as errors
function errorLines(dataDir: string): string[] {
    const log = path.join(dataDir, "logs", "paperboard.log");
    return fs.readFileSync(log, "utf8").split("\n").filter((line) => line.includes("[ERROR]"));
}
