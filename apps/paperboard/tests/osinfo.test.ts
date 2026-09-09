import { describe, it, expect } from "bun:test";
import { windowsReleaseName } from "../papercrane/index";

describe("windowsReleaseName", () => {
    it("falls back to major version when the registry is unreadable", () => {
        expect(windowsReleaseName(19045)).toBe("10");
        expect(windowsReleaseName(26100)).toBe("11");
        expect(windowsReleaseName(99999)).toBe("11");
        expect(windowsReleaseName(12345)).toBe("10");
    });
});
