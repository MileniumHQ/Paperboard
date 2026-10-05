// shell IPC wiring (bun test): every shell-only channel registered in
// shelldata refuses panel-origin frames with the typed PANEL_IPC_REFUSED —
// the guard unit test proves the predicate, this proves the wiring. Electron
// is stubbed; handlers throw before touching any real side effect.
import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { electronStub } from "./electronStub";

mock.module("electron", () => electronStub());

const PANEL_URL = "panel://local.dev.evil.panel/index.html";
const panelEvent = () => ({ senderFrame: { url: PANEL_URL } });

let handlers: Record<string, (...args: any[]) => unknown> = {};
let listeners: Record<string, (...args: any[]) => unknown> = {};

function fakeIpcMain() {
    handlers = {};
    listeners = {};
    return {
        handle: (channel: string, fn: (...args: any[]) => unknown) => {
            handlers[channel] = fn;
        },
        on: (channel: string, fn: (...args: any[]) => unknown) => {
            listeners[channel] = fn;
        },
    };
}

let tmp = "";
let savedDir: string | undefined;

beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-shellipc-"));
    savedDir = process.env.PAPERBOARD_DIR;
    process.env.PAPERBOARD_DIR = tmp;
});

afterAll(() => {
    if (savedDir === undefined) delete process.env.PAPERBOARD_DIR;
    else process.env.PAPERBOARD_DIR = savedDir;
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("shell IPC panel-origin refusal", () => {
    it("every invoke channel throws PANEL_IPC_REFUSED for panel frames", async () => {
        const { default: registerShellIpc } = await import(
            "../src/main/communication/shelldata"
        );
        const { PANEL_IPC_REFUSED } = await import(
            "../src/main/communication/shellGuard"
        );
        registerShellIpc(fakeIpcMain() as any);

        const channels = Object.keys(handlers);
        expect(channels.length).toBeGreaterThan(0);
        for (const channel of channels) {
            let thrown: unknown = null;
            try {
                await handlers[channel](panelEvent());
            } catch (err) {
                thrown = err;
            }
            expect(
                String((thrown as Error)?.message ?? thrown),
                `channel ${channel}`,
            ).toContain(PANEL_IPC_REFUSED);
        }
    });

    it("event channels log-and-ignore panel frames without side effects", async () => {
        const { default: registerShellIpc } = await import(
            "../src/main/communication/shelldata"
        );
        registerShellIpc(fakeIpcMain() as any);

        for (const channel of Object.keys(listeners)) {
            // must not throw and must not reach app.relaunch/shell (mocked
            // electron would no-op, but the early return must come first)
            await listeners[channel](panelEvent());
        }
        expect(Object.keys(listeners).length).toBeGreaterThan(0);
    });
});
