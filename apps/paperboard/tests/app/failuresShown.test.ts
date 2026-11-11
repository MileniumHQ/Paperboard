import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { BUILD_TIMEOUT_MS, buildApp, buildCrane, type BuiltApp, type BuiltCrane } from "../platform/app/support/build";
import { CraneSocket, startCrane, WAIT_MS, type RunningCrane } from "../platform/app/support/crane";
import { domCondition, launchElectron, SHELL, shellReady } from "../platform/app/support/electron";
import { tempDataDir, tempDir } from "../platform/app/support/temp";
import { createShellInvokeHandlers } from "../../src/main/communication/shellHandlers";

const PANEL = "dev.paperboard.failures";

let app: BuiltApp;
let crane: BuiltCrane;
let daemon: RunningCrane;
let host: CraneSocket;
let sdk: typeof import("../../../../packages/paperapi/src/index");
const previous = { ...process.env };

beforeAll(async () => {
    [app, crane] = await Promise.all([buildApp(), buildCrane()]);
    daemon = await startCrane(crane.file, tempDataDir("failures"));
    host = await CraneSocket.authed(daemon.handshake.port, daemon.handshake.token);
    // the SDK runs here as a panel service does: its own scoped credential
    const { token } = await host.call("auth:panel-token", { panelId: PANEL });
    Object.assign(process.env, { PAPERBOARD_PANEL_ID: PANEL, PAPERCRANE_PANEL_TOKEN: token, PAPERCRANE_PORT: String(daemon.handshake.port) });
    sdk = await import("../../../../packages/paperapi/src/index");
}, BUILD_TIMEOUT_MS);

afterAll(async () => {
    // the SDK's connection goes first, or it keeps reaching for the stopped daemon
    sdk?.closeTransport();
    for (const key of ["PAPERBOARD_PANEL_ID", "PAPERCRANE_PANEL_TOKEN", "PAPERCRANE_PORT"]) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
    }
    host?.close();
    await daemon?.stop();
});

const rejection = (p: Promise<unknown>) => p.then(() => { throw new Error("it resolved"); }, (err: Error) => err);

// Failures reach the caller instead of being swallowed.
describe("failures reach the caller", () => {
    test("App Settings shows a settings file that won't load, and a save that fails keeps the switch where it was", async () => {
        const dataDir = tempDataDir("settings-load");
        fs.writeFileSync(path.join(dataDir, "local", "app-settings.json"), "{ not json");
        const electron = await launchElectron({ appDir: app.dir, dataDir, args: ["--skip-update"] });
        await shellReady(electron);
        await electron.evalIn(SHELL, `document.querySelector('[role=radio][aria-label="Settings"]').click()`);
        const loadAlert = await electron.evalIn(SHELL, domCondition(`document.querySelector('[role=alert]')?.innerText`));
        expect(loadAlert).toContain("Settings not loaded");
        expect(loadAlert).toContain("These are the defaults, not your settings: ");
        expect(loadAlert).toMatch(/JSON/);
        expect(await electron.quit()).toEqual({ code: 0, signal: null });

        const saveDir = tempDataDir("settings-save");
        fs.writeFileSync(path.join(saveDir, "local", "app-settings.json"), JSON.stringify({ darkMode: "system", reducedMotion: false, runOnStartup: false }));
        const second = await launchElectron({ appDir: app.dir, dataDir: saveDir, args: ["--skip-update"] });
        await shellReady(second);
        await second.evalIn(SHELL, `document.querySelector('[role=radio][aria-label="Settings"]').click()`);
        // Run on startup: a failed save applies nothing, so no login item is made
        const toggle = `document.querySelector('[role=switch]:has(input[name=runOnStartup])')`;
        await second.evalIn(SHELL, domCondition(toggle));
        // the settings folder stops taking writes
        fs.chmodSync(path.join(saveDir, "local"), 0o555);
        try {
            await second.evalIn(SHELL, `${toggle}.click()`);
            const saveAlert = await second.evalIn(SHELL, domCondition(`[...document.querySelectorAll('[role=alert]')].map((a) => a.innerText).find((t) => t.includes("Settings not saved"))`));
            expect(saveAlert).toContain("Your change was not kept: ");
            expect(saveAlert).toMatch(/EACCES|permission denied/i);
            expect(await second.evalIn(SHELL, `${toggle}.getAttribute("aria-checked")`)).toBe("false");
        } finally {
            fs.chmodSync(path.join(saveDir, "local"), 0o755);
        }
        expect(JSON.parse(fs.readFileSync(path.join(saveDir, "local", "app-settings.json"), "utf8")).runOnStartup).toBe(false);
        expect(await second.quit()).toEqual({ code: 0, signal: null });
    }, WAIT_MS * 3);

    test("a folder that won't open answers with the reason the system gave", async () => {
        const handlers = createShellInvokeHandlers({
            appVersion: () => "0.0.0",
            launchOptions: () => ({}) as never,
            graphics: () => ({ gpu: true }),
            // Electron's shell.openPath resolves to the system's message
            openPath: async (dir) => `Failed to open path: ${dir}`,
        });
        const answer = await handlers["open-panel-folder"]({ computerId: "local", panelId: PANEL });
        expect(answer).toEqual({ opened: false, error: `Failed to open path: ${path.join(process.env.PAPERBOARD_DIR!, "files", PANEL)}` });
    });

    test("SDK terminal and process calls the daemon refuses reject with its reason", async () => {
        const missing = path.join(tempDir("gone"), "missing");
        const create = await rejection(sdk.terminal.create("failures-term", { cwd: missing }));
        expect(create.message).toContain(`spawn cwd does not exist: ${missing}`);

        // another panel's terminal and process are not this panel's to end
        const { token: otherToken } = await host.call("auth:panel-token", { panelId: "dev.paperboard.other" });
        const other = await CraneSocket.authed(daemon.handshake.port, otherToken);
        await other.call("term:create", { id: "other-term" });
        await other.call("process:run", { id: "other-proc", command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] });
        const destroy = await rejection(sdk.terminal.destroy("other-term"));
        expect(destroy.message).toContain(`"other-term" belongs to another panel`);
        const kill = await rejection(sdk.process.kill("other-proc"));
        expect(kill.message).toContain(`"other-proc" belongs to another panel`);
        expect(await other.call("process:exists", { id: "other-proc" })).toEqual({ running: true });
        await other.call("process:kill", { id: "other-proc" });
        await other.call("term:destroy", { id: "other-term" });
        other.close();

        const write = await rejection(sdk.process.write("never-started", "input\n"));
        expect(write.message).toContain(`Process "never-started" is not running`);
    }, WAIT_MS);

    test("a workload with no working directory, or whose supervisor dies before it is ready, rejects with the exit code and stderr", async () => {
        const missingCwd = path.join(tempDir("gone"), "missing");
        const noCwd = await host.send("process:run", { id: "no-cwd", command: process.execPath, args: ["-e", "0"], cwd: missingCwd });
        expect(noCwd.error).toContain(`spawn cwd does not exist: ${missingCwd}`);

        // the supervisor cannot open its endpoint and dies before it is ready
        const sockets = path.join(daemon.dataDir, "sockets");
        fs.chmodSync(sockets, 0o500);
        try {
            const died = await host.send("process:run", { id: "no-supervisor", command: process.execPath, args: ["-e", "0"] });
            expect(died.error).toContain("Supervisor no-supervisor did not become ready: ");
            expect(died.error).toMatch(/code \d+/);
            expect(died.error).toMatch(/EACCES|permission denied/i);
        } finally {
            fs.chmodSync(sockets, 0o700);
        }
    }, WAIT_MS);

    test("a workload whose program does not exist rejects its start with the reason", async () => {
        // the program it names does not exist
        const missingProgram = path.join(tempDir("gone"), "no-such-shell");
        const noProgram = await host.send("process:run", { id: "no-program", command: missingProgram, args: [] });
        expect(noProgram.result).toBeNull();
        expect(noProgram.error).toContain(missingProgram);
        expect(noProgram.error).toMatch(/ENOENT/);

    }, WAIT_MS);
});
