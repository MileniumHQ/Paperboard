// publish manifest truth (bun test): a version-less manifest is refused,
// never fabricated into 1.0.0 — half-finished panels are 0.x (AGENTS.md).
import { describe, it, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { discoverPanels, PANELS_ROOT, resolvePublishTarget } from "./publishManifest";

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

describe("discoverPanels", () => {
    // Regression: the USB flow used to scan apps/ (`join(HERE, "..")`) and
    // silently bundled zero panels. Both flows now share PANELS_ROOT, which
    // must resolve to <repo>/panels — the directory whose sibling is scripts/.
    it("PANELS_ROOT is the repo's panels/ directory", () => {
        expect(basename(PANELS_ROOT)).toBe("panels");
        expect(existsSync(join(PANELS_ROOT, "..", "scripts", "publish.ts"))).toBe(true);
    });

    it("discovers the repo's real panels", () => {
        const ids = discoverPanels(PANELS_ROOT).map((x) => x.id);
        expect(ids).toContain("dev.paperboard.terminal");
    });

    it("skips non-dirs and manifest-less dirs, reporting broken manifests", () => {
        const root = mkdtempSync(join(tmpdir(), "panels-"));
        try {
            writeFileSync(join(root, "loose.txt"), "x");
            mkdirSync(join(root, "no-manifest"));
            mkdirSync(join(root, "broken"));
            writeFileSync(join(root, "broken", "manifest.json"), "{ not json");
            mkdirSync(join(root, "good"));
            writeFileSync(
                join(root, "good", "manifest.json"),
                JSON.stringify({ id: "dev.paperboard.good", name: "Good", version: "0.1.0" }),
            );
            const skips: string[] = [];
            const found = discoverPanels(root, (name) => skips.push(name));
            expect(found.map((x) => x.id)).toEqual(["dev.paperboard.good"]);
            expect(skips).toEqual(["broken"]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("throws on a broken manifest when no onSkip is given", () => {
        const root = mkdtempSync(join(tmpdir(), "panels-"));
        try {
            mkdirSync(join(root, "bad"));
            writeFileSync(join(root, "bad", "manifest.json"), JSON.stringify({ name: "Bad" }));
            expect(() => discoverPanels(root)).toThrow(/"version"/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("returns empty for a missing root", () => {
        expect(discoverPanels(join(tmpdir(), "definitely-not-here"))).toEqual([]);
    });
});
