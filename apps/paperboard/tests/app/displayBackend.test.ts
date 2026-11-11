import { describe, expect, test } from "bun:test";
import type { App } from "electron";
import { isCrostini, relaunchOnX11IfNeeded } from "../../src/main/displayBackend";

interface Relaunch {
    args: string[];
    execPath?: string;
}

function fakeApp(isPackaged = true) {
    const relaunched: Relaunch[] = [];
    const exits: number[] = [];
    const app = {
        isPackaged,
        relaunch: (options: Relaunch) => relaunched.push(options),
        exit: (code: number) => exits.push(code),
    } as unknown as App;
    return { app, relaunched, exits };
}

const ARGV = ["/opt/Paperboard/paperboard", "--mobile"];
const SOMMELIER = { SOMMELIER_VERSION: "0.20" };
const noFiles = () => false;
const crostiniMarker = (file: string) => file === "/dev/.cros_milestone";

describe("display backend", () => {
    test("Crostini is a Linux session with Sommelier or the ChromeOS marker", () => {
        expect(isCrostini(SOMMELIER, "linux", noFiles)).toBe(true);
        expect(isCrostini({}, "linux", crostiniMarker)).toBe(true);
        expect(isCrostini({}, "linux", noFiles)).toBe(false);
        expect(isCrostini(SOMMELIER, "darwin", crostiniMarker)).toBe(false);
    });

    test("relaunches on X11 on Crostini, keeping the launch's own arguments", () => {
        const { app, relaunched, exits } = fakeApp();
        expect(relaunchOnX11IfNeeded(app, ARGV, SOMMELIER, "linux", noFiles)).toBe(true);
        expect(relaunched).toEqual([{ args: ["--mobile", "--ozone-platform=x11"] }]);
        expect(exits).toEqual([0]);
    });

    test("relaunches when only the marker file says Crostini", () => {
        const { app, relaunched } = fakeApp();
        expect(relaunchOnX11IfNeeded(app, ARGV, {}, "linux", crostiniMarker)).toBe(true);
        expect(relaunched).toHaveLength(1);
    });

    test("an AppImage relaunches the image, not the binary inside its mount", () => {
        const { app, relaunched } = fakeApp();
        const env = { ...SOMMELIER, APPIMAGE: "/home/me/Paperboard.AppImage" };
        expect(relaunchOnX11IfNeeded(app, ["/tmp/.mount_PaperbXYZ/paperboard"], env, "linux", noFiles)).toBe(true);
        expect(relaunched).toEqual([{ execPath: "/home/me/Paperboard.AppImage", args: ["--ozone-platform=x11"] }]);
    });

    test("does not relaunch a dev run, which would orphan its dev server", () => {
        const { app, relaunched, exits } = fakeApp(false);
        expect(relaunchOnX11IfNeeded(app, ARGV, SOMMELIER, "linux", noFiles)).toBe(false);
        expect(relaunched).toEqual([]);
        expect(exits).toEqual([]);
    });

    test("leaves other desktops alone", () => {
        const { app, relaunched, exits } = fakeApp();
        expect(relaunchOnX11IfNeeded(app, ARGV, { WAYLAND_DISPLAY: "wayland-0" }, "linux", noFiles)).toBe(false);
        expect(relaunched).toEqual([]);
        expect(exits).toEqual([]);
    });

    test("does not loop once a backend is chosen", () => {
        for (const choice of ["--ozone-platform=x11", "--ozone-platform=wayland", "--ozone-platform-hint=auto"]) {
            const { app, relaunched } = fakeApp();
            expect(relaunchOnX11IfNeeded(app, [...ARGV, choice], SOMMELIER, "linux", crostiniMarker)).toBe(false);
            expect(relaunched).toEqual([]);
        }
    });
});
