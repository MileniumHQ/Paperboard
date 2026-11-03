// Run on startup. Electron's login items do nothing on Linux, so the toggle
// never worked there; and an unsigned Mac refuses them, which only Electron's
// own log said: the toggle stayed on and Paperboard never started at login.
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { autostartEntryPath, setRunOnStartup, type LoginItemHost } from "../src/main/loginItem";

const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function linuxHost(env: NodeJS.ProcessEnv): LoginItemHost {
    return {
        platform: "linux",
        env,
        execPath: "/opt/Paperboard/paperboard",
        get: () => { throw new Error("Electron's login items are not used on Linux"); },
        set: () => { throw new Error("Electron's login items are not used on Linux"); },
    };
}

describe("run on startup on Linux", () => {
    it("is an autostart entry that starts the AppImage itself, and goes away when turned off", () => {
        const config = fs.mkdtempSync(path.join(os.tmpdir(), "pb-autostart-"));
        dirs.push(config);
        const env = { XDG_CONFIG_HOME: config, APPIMAGE: "/home/u/Apps/Paper $board.AppImage" };
        setRunOnStartup(true, linuxHost(env));
        const entry = autostartEntryPath(env);
        expect(entry).toBe(path.join(config, "autostart", "dev.paperboard.paperboard.desktop"));
        const text = fs.readFileSync(entry, "utf8");
        expect(text).toContain("[Desktop Entry]\nType=Application\nName=Paperboard\n");
        expect(text).toContain('Exec="/home/u/Apps/Paper \\$board.AppImage"\n');

        setRunOnStartup(false, linuxHost(env));
        expect(fs.existsSync(entry)).toBe(false);
        // already off is fine
        setRunOnStartup(false, linuxHost(env));
    });

    it("starts the installed binary when it isn't an AppImage", () => {
        const config = fs.mkdtempSync(path.join(os.tmpdir(), "pb-autostart-"));
        dirs.push(config);
        setRunOnStartup(true, linuxHost({ XDG_CONFIG_HOME: config }));
        expect(fs.readFileSync(autostartEntryPath({ XDG_CONFIG_HOME: config }), "utf8")).toContain('Exec="/opt/Paperboard/paperboard"\n');
    });
});

function systemHost(platform: NodeJS.Platform, accepts: boolean, status?: string) {
    let openAtLogin = false;
    const calls: boolean[] = [];
    const host: LoginItemHost = {
        platform,
        env: {},
        execPath: "/Applications/Paperboard.app/Contents/MacOS/Paperboard",
        get: () => ({ openAtLogin, status }),
        set: (value) => { calls.push(value); if (accepts) openAtLogin = value; },
    };
    return { host, calls };
}

describe("run on startup on macOS and Windows", () => {
    it("is a login item", () => {
        const { host, calls } = systemHost("darwin", true);
        setRunOnStartup(true, host);
        expect(calls).toEqual([true]);
    });

    it("is not asked for again when it is already so", () => {
        const { host, calls } = systemHost("darwin", false);
        setRunOnStartup(false, host);
        expect(calls).toEqual([]);
    });

    it("says so when macOS refuses it, and when it waits for approval", () => {
        expect(() => setRunOnStartup(true, systemHost("darwin", false).host)).toThrow(/macOS wouldn't add Paperboard to your login items/);
        expect(() => setRunOnStartup(true, systemHost("darwin", false, "requires-approval").host)).toThrow(/Allow Paperboard in System Settings/);
        expect(() => setRunOnStartup(true, systemHost("win32", false).host)).toThrow(/Windows wouldn't start Paperboard/);
    });
});
