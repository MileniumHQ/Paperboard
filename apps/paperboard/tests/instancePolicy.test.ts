import { describe, expect, it } from "bun:test";
import { keepAliveWithoutWindows, secondLaunchAction } from "../src/main/instancePolicy";

describe("second launch routing", () => {
    it("routes an explicit --browser launch to the browser shell", () => {
        expect(secondLaunchAction(["/paperboard", "--browser"], false)).toBe("browser");
        expect(secondLaunchAction(["/paperboard", "--browser"], true)).toBe("browser");
    });

    it("focuses the existing window for a plain launch", () => {
        expect(secondLaunchAction(["/paperboard"], true)).toBe("focus");
    });

    it("opens a window for a plain launch when the lock holder has none", () => {
        // the lock holder may be a browser-mode process; a plain launch must
        // still surface the desktop app instead of another browser tab
        expect(secondLaunchAction(["/paperboard"], false)).toBe("window");
    });

    it("does not treat other switches as a browser request", () => {
        expect(secondLaunchAction(["/paperboard", "--skip-update"], true)).toBe("focus");
        expect(secondLaunchAction(["/paperboard", "--devtools"], false)).toBe("window");
    });
});

describe("windowless lifetime", () => {
    it("keeps a browser-mode process alive to serve its session", () => {
        expect(keepAliveWithoutWindows("linux", true)).toBe(true);
    });

    it("quits a windowed process after its last window closes", () => {
        // even if a second --browser launch attached a host, the desktop app
        // owns its lifetime; a lingering host must not make it immortal
        expect(keepAliveWithoutWindows("linux", false)).toBe(false);
        expect(keepAliveWithoutWindows("win32", false)).toBe(false);
    });

    it("follows macOS convention", () => {
        expect(keepAliveWithoutWindows("darwin", false)).toBe(true);
    });
});
