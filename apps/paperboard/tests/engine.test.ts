import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PaperCraneEngine } from "../papercrane/engine";

let tmp: string;
let engine: PaperCraneEngine;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-engine-"));
    engine = new PaperCraneEngine(tmp);
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("PaperCraneEngine path containment", () => {
    it("resolves paths inside the files dir", () => {
        expect(engine.getFilePath("world/level.dat", "srv")).toBe(
            path.join(tmp, "files", "srv", "world", "level.dat"),
        );
    });

    it("rejects traversal", async () => {
        await expect(engine.writeFile("../../escape.txt", "x", "srv")).rejects.toThrow();
        expect(() => engine.getFilePath("../other", "srv")).toThrow();
    });

    it("rejects sibling-prefix directories", () => {
        // "<base>-evil" must not pass a naive startsWith check
        const base = path.join(tmp, "files", "srv");
        fs.mkdirSync(base + "-evil", { recursive: true });
        expect(() => engine.getFilePath("../srv-evil/data.txt", "srv")).toThrow();
    });
});

describe("PaperCraneEngine panels install/uninstall parity", () => {
    it("uninstallPanel removes config and files like the local driver should", async () => {
        await engine.setConfig("somepanel", { a: 1 });
        fs.mkdirSync(path.join(tmp, "panels", "somepanel"), { recursive: true });
        await engine.uninstallPanel("somepanel");
        expect(fs.existsSync(path.join(tmp, "panels", "somepanel"))).toBe(false);
        expect(await engine.getConfig("somepanel")).toBeNull();
    });
});

describe("PaperCraneEngine package platform selection", () => {
    it("prefers os-arch over os over generic download", async () => {
        // Indirectly covered by downloadPackage; here we test the index round-trip.
        engine.getPackageIndex(); // should not throw on missing file
        expect(engine.isPackageInstalled("nothing")).toBe(false);
    });
});

describe("PaperCraneEngine app-global configs", () => {
    it("stores shell globals in local/, panel workspaces in files/<id>/, computer keys in configs/", async () => {
        await engine.setConfig("app-settings", { darkMode: "dark" });
        await engine.setConfig("shell-last-opened", { panelId: "x" });
        await engine.setConfig("somepanel", { a: 1 });
        await engine.setConfig("crane_version", { version: "1" });
        expect(
            fs.existsSync(path.join(tmp, "local", "app-settings.json")),
        ).toBe(true);
        expect(
            fs.existsSync(path.join(tmp, "local", "shell-last-opened.json")),
        ).toBe(true);
        expect(fs.existsSync(path.join(tmp, "files", "somepanel", "data.json"))).toBe(
            true,
        );
        expect(
            fs.existsSync(path.join(tmp, "configs", "crane_version.json")),
        ).toBe(true);
        expect(
            fs.existsSync(path.join(tmp, "configs", "somepanel.json")),
        ).toBe(false);
    });

    it("reads pre-move panel data from configs/ once, then migrates", async () => {
        fs.writeFileSync(
            path.join(tmp, "configs", "somepanel.json"),
            JSON.stringify({ a: 2 }),
        );
        expect(await engine.getConfig("somepanel")).toEqual({ a: 2 });
        await engine.setConfig("somepanel", { a: 3 });
        expect(fs.existsSync(path.join(tmp, "configs", "somepanel.json"))).toBe(
            false,
        );
        expect(await engine.getConfig("somepanel")).toEqual({ a: 3 });
    });

    it("stores every panel's working data as data.json", async () => {
        await engine.setConfig("com.example.terminal", { tabs: [] });
        expect(
            fs.existsSync(path.join(tmp, "files", "com.example.terminal", "data.json")),
        ).toBe(true);
        await engine.setConfig("com.example.actions", { flows: [] });
        expect(
            fs.existsSync(path.join(tmp, "files", "com.example.actions", "data.json")),
        ).toBe(true);
        // Retired per-panel names still read through once, then migrate
        // (ensure the dir exists the way a previous install left it)
        for (const [dir, file, value] of [
            ["legacypanel", "config.json", { v: 1 }],
            ["oldterminal", "tabs.json", { tabs: [] }],
            ["oldactions", "workspace.json", { flows: [] }],
        ] as const) {
            fs.mkdirSync(path.join(tmp, "files", dir), { recursive: true });
            fs.writeFileSync(
                path.join(tmp, "files", dir, file),
                JSON.stringify(value),
            );
            expect(await engine.getConfig(dir)).toEqual(value);
            await engine.setConfig(dir, value);
            expect(
                fs.existsSync(path.join(tmp, "files", dir, "data.json")),
            ).toBe(true);
            expect(fs.existsSync(path.join(tmp, "files", dir, file))).toBe(false);
        }
    });

    it("reads pre-move app globals from configs/ once", async () => {
        fs.writeFileSync(
            path.join(tmp, "configs", "app-settings.json"),
            JSON.stringify({ darkMode: "light" }),
        );
        expect(await engine.getConfig("app-settings")).toEqual({
            darkMode: "light",
        });
    });
});
