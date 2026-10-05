import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scaffoldPanel } from "../src/scaffold";
import paperapiPackage from "../../paperapi/package.json";
import paperuiPackage from "../../paperui/package.json";

let parentDir: string;

beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), "create-panel-test-"));
});

afterEach(() => {
    rmSync(parentDir, { recursive: true, force: true });
});

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("scaffoldPanel", () => {
    it("writes a standalone panel wired to the published libraries", () => {
        const { targetDir } = scaffoldPanel({
            mode: "standalone",
            id: "dev.paperboard.my-panel",
            displayName: "My Panel",
            parentDir,
        });
        expect(targetDir).toBe(join(parentDir, "dev.paperboard.my-panel"));

        const pkg = readJson(join(targetDir, "package.json"));
        expect(pkg.name).toBe("dev.paperboard.my-panel");
        expect(pkg.dependencies["@mileniumhq/paperapi"]).toBe(`^${paperapiPackage.version}`);
        expect(pkg.dependencies["@mileniumhq/paperui"]).toBe(`^${paperuiPackage.version}`);
        expect(pkg.license).toBe("UNLICENSED");

        const manifest = readJson(join(targetDir, "manifest.json"));
        expect(manifest).toEqual({
            name: "My Panel",
            id: "dev.paperboard.my-panel",
            version: "0.1.0",
            description: "My Panel panel",
            base: "./dist/index.html",
            service: "./dist/service.js",
        });

        expect(existsSync(join(targetDir, ".gitignore"))).toBe(true);
        expect(existsSync(join(targetDir, "gitignore"))).toBe(false);
        expect(existsSync(join(targetDir, "LICENSE"))).toBe(false);
        expect(readFileSync(join(targetDir, "src/service.ts"), "utf8")).toContain(
            'const PANEL_ID = "dev.paperboard.my-panel";',
        );
    });

    it("writes a workspace panel wired to workspace:* as first-party", () => {
        const { targetDir } = scaffoldPanel({ mode: "workspace", id: "dev.paperboard.my-panel", parentDir });
        const pkg = readJson(join(targetDir, "package.json"));
        expect(pkg.dependencies["@mileniumhq/paperapi"]).toBe("workspace:*");
        expect(pkg.dependencies["@mileniumhq/paperui"]).toBe("workspace:*");
        expect(pkg.license).toBe("PolyForm-Noncommercial-1.0.0");
        expect(readJson(join(targetDir, "manifest.json")).publisher).toBe("Paperboard");
        expect(readJson(join(targetDir, "manifest.json")).name).toBe("My Panel");
        expect(existsSync(join(targetDir, "LICENSE"))).toBe(true);
        expect(existsSync(join(targetDir, "gitignore"))).toBe(false);
        expect(existsSync(join(targetDir, ".gitignore"))).toBe(false);
    });

    it("refuses ids the panel identity contract rejects, writing nothing", () => {
        for (const id of ["settings", "Dev.Paperboard.X", "../escape", "a".repeat(129), ""]) {
            expect(() => scaffoldPanel({ mode: "standalone", id, parentDir })).toThrow(/Invalid panel id/);
        }
        expect(existsSync(join(parentDir, "settings"))).toBe(false);
    });

    it("refuses to write over an existing directory", () => {
        mkdirSync(join(parentDir, "dev.paperboard.taken"));
        expect(() => scaffoldPanel({ mode: "standalone", id: "dev.paperboard.taken", parentDir })).toThrow(
            /already exists/,
        );
    });
});
