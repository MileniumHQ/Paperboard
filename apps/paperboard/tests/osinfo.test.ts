import { describe, it, expect } from "bun:test";
import { macosVersionFromDarwin, windowsReleaseName } from "../papercrane/index";

describe("windowsReleaseName", () => {
    it("falls back to major version when the registry is unreadable", async () => {
        // async (promisified reg query, cached promise per build — T10);
        // on non-win32 the reg branch is skipped and the fallback resolves
        expect(await windowsReleaseName(19045)).toBe("10");
        expect(await windowsReleaseName(26100)).toBe("11");
        expect(await windowsReleaseName(99999)).toBe("11");
        expect(await windowsReleaseName(12345)).toBe("10");
    });
});

describe("macosVersionFromDarwin", () => {
    it("names macOS by Apple's version, including the year-numbered releases", () => {
        expect(macosVersionFromDarwin("24.6.0")).toBe("15");
        expect(macosVersionFromDarwin("25.0.0")).toBe("26");
        expect(macosVersionFromDarwin("26.1.0")).toBe("27");
        expect(macosVersionFromDarwin("20.6.0")).toBe("11");
        expect(macosVersionFromDarwin("19.6.0")).toBe("19.6.0");
    });
});
