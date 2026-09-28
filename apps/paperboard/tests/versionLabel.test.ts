import { describe, it, expect } from "bun:test";
import { versionLabel } from "../src/renderer/src/lib/versionLabel";

describe("versionLabel", () => {
    it("numbers 0.x releases as betas by their minor", () => {
        expect(versionLabel("0.1.0")).toBe("Beta 1");
        expect(versionLabel("0.4.0")).toBe("Beta 4");
        expect(versionLabel("0.4.4")).toBe("Beta 4.4");
    });

    it("shows 1.0 and later as the version, dropping a zero patch", () => {
        expect(versionLabel("1.0.0")).toBe("1.0");
        expect(versionLabel("1.2.0")).toBe("1.2");
        expect(versionLabel("1.2.2")).toBe("1.2.2");
    });

    it("ignores prerelease tags", () => {
        expect(versionLabel("0.2.0-alpha")).toBe("Beta 2");
    });

    it("leaves an unparseable version as it is", () => {
        expect(versionLabel("dev")).toBe("dev");
    });
});
