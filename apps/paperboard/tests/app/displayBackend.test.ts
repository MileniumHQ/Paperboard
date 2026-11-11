import { describe, expect, test } from "bun:test";
import type { App } from "electron";
import { isCrostini, relaunchOnX11IfNeeded } from "../../src/main/displayBackend";

function fakeApp(isPackaged = true) {
    const relaunched: string[][] = [];
    const exits: number[] = [];
    const app = {
        isPackaged,
        relaunch: (options: { args: string[] }) => relaunched.push(options.args),
        exit: (code: number) => exits.push(code),
    } as unknown as App;
    return { app, relaunched, exits };
}

const ARGV = ["/opt/Paperboard/paperboard", "--mobile"];

describe("display backend", () => {
    test("Crostini is a Linux session with Sommelier", () => {
        expect(isCrostini({ SOMMELIER_VERSION: "0.20" }, "linux")).toBe(true);
        expect(isCrostini({}, "linux")).toBe(false);
        expect(isCrostini({ SOMMELIER_VERSION: "0.20" }, "darwin")).toBe(false);
    });

    test("relaunches on X11 on Crostini", () => {
        const { app, relaunched, exits } = fakeApp();
        expect(relaunchOnX11IfNeeded(app, ARGV, { SOMMELIER_VERSION: "0.20" }, "linux")).toBe(true);
        expect(relaunched).toHaveLength(1);
        expect(relaunched[0]).toContain("--ozone-platform=x11");
        expect(exits).toEqual([0]);
    });

    test("does not relaunch a dev run, which would orphan its dev server", () => {
        const { app, relaunched } = fakeApp(false);
        expect(relaunchOnX11IfNeeded(app, ARGV, { SOMMELIER_VERSION: "0.20" }, "linux")).toBe(false);
        expect(relaunched).toEqual([]);
    });

    test("leaves other desktops alone", () => {
        const { app, relaunched, exits } = fakeApp();
        expect(relaunchOnX11IfNeeded(app, ARGV, { WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe(false);
        expect(relaunched).toEqual([]);
        expect(exits).toEqual([]);
    });

    test("does not loop once X11 is chosen", () => {
        const { app, relaunched } = fakeApp();
        expect(relaunchOnX11IfNeeded(app, [...ARGV, "--ozone-platform=x11"], { SOMMELIER_VERSION: "0.20" }, "linux")).toBe(false);
        expect(relaunched).toEqual([]);
    });
});
