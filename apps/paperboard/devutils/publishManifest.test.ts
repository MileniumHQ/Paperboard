// publish manifest truth (bun test): a version-less manifest is refused,
// never fabricated into 1.0.0 — half-finished panels are 0.x (AGENTS.md).
import { describe, it, expect } from "bun:test";
import { resolvePublishTarget } from "./publishManifest";

describe("resolvePublishTarget", () => {
    it("resolves id, name, and version from a complete manifest", () => {
        expect(
            resolvePublishTarget(
                { id: "dev.paperboard.x", name: "X", version: "0.3.0" },
                "/panels/x",
            ),
        ).toEqual({ id: "dev.paperboard.x", name: "X", version: "0.3.0" });
    });

    it("falls back to the directory basename for missing id/name", () => {
        expect(
            resolvePublishTarget({ version: "1.2.3" }, "/panels/dev.paperboard.y"),
        ).toEqual({ id: "dev.paperboard.y", name: "dev.paperboard.y", version: "1.2.3" });
    });

    it("refuses a version-less manifest instead of fabricating 1.0.0", () => {
        expect(() =>
            resolvePublishTarget({ id: "p", name: "P" }, "/panels/p"),
        ).toThrow(/no "version" field/);
    });

    it("refuses a non-string version", () => {
        expect(() =>
            resolvePublishTarget({ id: "p", name: "P", version: 1 }, "/panels/p"),
        ).toThrow(/no "version" field/);
    });

    it("refuses a non-object manifest", () => {
        expect(() => resolvePublishTarget(null, "/panels/p")).toThrow(/not an object/);
        expect(() => resolvePublishTarget([1, 2], "/panels/p")).toThrow(/not an object/);
    });
});
