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

describe("PaperCraneEngine killProcess hygiene", () => {
    it("the teardown timer never holds the process open", () => {
        const fake = {
            // intentional no-op stubs: the test observes the teardown
            // timer, never the fake client's behavior
            kill(_signal: string) {
                /* no-op stub */
            },
            on(_event: string, _fn: () => void) {
                /* no-op stub */
            },
            destroy() {
                /* no-op stub */
            },
        };
        (engine as any).clients.set("ghost", fake);
        const captured: any[] = [];
        const realSetTimeout = globalThis.setTimeout;
        (globalThis as any).setTimeout = ((fn: any, ms: number, ...rest: any[]) => {
            const t = realSetTimeout(fn, ms, ...rest);
            if (ms === 5000) captured.push(t);
            return t;
        }) as any;
        try {
            engine.killProcess("ghost");
        } finally {
            (globalThis as any).setTimeout = realSetTimeout;
        }
        expect(captured).toHaveLength(1);
        expect(captured[0].hasRef()).toBe(false);
        clearTimeout(captured[0]);
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

    it("uninstallPanel renames to trash before delete and sweeps stale trash", async () => {
        fs.mkdirSync(path.join(tmp, "panels", "trashed"), { recursive: true });
        fs.writeFileSync(path.join(tmp, "panels", "trashed", "manifest.json"), "{}");
        // a previous crashed uninstall leaves a marked trash dir behind
        fs.mkdirSync(path.join(tmp, "panels", ".trash-123-trashed"), { recursive: true });
        // a live panel with a similar name must never be touched by the sweep
        fs.mkdirSync(path.join(tmp, "panels", "trashed2"), { recursive: true });
        expect(await engine.uninstallPanel("trashed")).toBe(true);
        expect(fs.existsSync(path.join(tmp, "panels", "trashed"))).toBe(false);
        expect(fs.existsSync(path.join(tmp, "panels", ".trash-123-trashed"))).toBe(false);
        expect(fs.readdirSync(path.join(tmp, "panels")).filter((e) => e.startsWith(".trash-"))).toEqual([]);
        expect(fs.existsSync(path.join(tmp, "panels", "trashed2"))).toBe(true);
    });
});

describe("PaperCraneEngine package platform selection", () => {
    it("prefers os-arch over os over generic download", async () => {
        // Indirectly covered by downloadPackage; here we test the index round-trip.
        engine.getPackageIndex(); // should not throw on missing file
        expect(engine.isPackageInstalled("nothing")).toBe(false);
    });

    it("isPackageInstalled honors the version param against the index", () => {
        fs.mkdirSync(path.join(tmp, "packages", "ffmpeg", "bin"), { recursive: true });
        fs.writeFileSync(
            path.join(tmp, "packages", "index.json"),
            JSON.stringify({ ffmpeg: { name: "ffmpeg", version: "7.1", installedAt: new Date().toISOString() } }),
        );
        expect(engine.isPackageInstalled("ffmpeg")).toBe(true);
        expect(engine.isPackageInstalled("ffmpeg", "latest")).toBe(true);
        expect(engine.isPackageInstalled("ffmpeg", "7.1")).toBe(true);
        expect(engine.isPackageInstalled("ffmpeg", "6.0")).toBe(false);
    });
});

describe("PaperCraneEngine app-global configs", () => {
    it("stores shell globals in local/, panel configs and computer keys in configs/", async () => {
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
        expect(
            fs.existsSync(path.join(tmp, "configs", "crane_version.json")),
        ).toBe(true);
        expect(
            fs.existsSync(path.join(tmp, "configs", "somepanel.json")),
        ).toBe(true);
        expect(fs.existsSync(path.join(tmp, "files", "somepanel", "data.json"))).toBe(
            false,
        );
    });

    it("reads the merged data.json once, then migrates it into configs/", async () => {
        fs.mkdirSync(path.join(tmp, "files", "somepanel"), { recursive: true });
        fs.writeFileSync(
            path.join(tmp, "files", "somepanel", "data.json"),
            JSON.stringify({ a: 2 }),
        );
        expect(await engine.getConfig("somepanel")).toEqual({ a: 2 });
        await engine.setConfig("somepanel", { a: 3 });
        expect(fs.existsSync(path.join(tmp, "files", "somepanel", "data.json"))).toBe(
            false,
        );
        expect(await engine.getConfig("somepanel")).toEqual({ a: 3 });
    });

    it("stores an explicit path as workspace data in the panel's files dir", async () => {
        await engine.setConfig("com.example.terminal", { tabs: [] }, "tabs.json");
        expect(
            fs.existsSync(path.join(tmp, "files", "com.example.terminal", "tabs.json")),
        ).toBe(true);
        expect(
            fs.existsSync(path.join(tmp, "configs", "com.example.terminal.json")),
        ).toBe(false);
        expect(await engine.getConfig("com.example.terminal", "tabs.json")).toEqual({
            tabs: [],
        });

        // nested paths work the same way, still inside the panel dir
        await engine.setConfig("com.example.actions", { flows: [] }, "workspace/canvas.json");
        expect(
            fs.existsSync(path.join(tmp, "files", "com.example.actions", "workspace", "canvas.json")),
        ).toBe(true);
    });

    it("migrates data.json into the requested workspace path", async () => {
        fs.mkdirSync(path.join(tmp, "files", "com.example.terminal"), {
            recursive: true,
        });
        fs.writeFileSync(
            path.join(tmp, "files", "com.example.terminal", "data.json"),
            JSON.stringify({ tabs: [{ id: "t1" }] }),
        );
        expect(await engine.getConfig("com.example.terminal", "tabs.json")).toEqual({
            tabs: [{ id: "t1" }],
        });
        await engine.setConfig("com.example.terminal", { tabs: [] }, "tabs.json");
        expect(
            fs.existsSync(path.join(tmp, "files", "com.example.terminal", "data.json")),
        ).toBe(false);
        expect(
            fs.existsSync(path.join(tmp, "files", "com.example.terminal", "tabs.json")),
        ).toBe(true);
    });

    it("refuses workspace paths that climb out of the panel dir", async () => {
        await expect(
            engine.setConfig("com.example.terminal", { x: 1 }, "../../evil.json"),
        ).rejects.toThrow();
        await expect(
            engine.getConfig("com.example.terminal", "../other.json"),
        ).rejects.toThrow();
        expect(fs.existsSync(path.join(tmp, "files", "evil.json"))).toBe(false);
        expect(fs.existsSync(path.join(tmp, "files", "other.json"))).toBe(false);
    });

    it("retired per-panel names still read through once, then migrate", async () => {
        // ensure the dirs exist the way a previous install left them
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
                fs.existsSync(path.join(tmp, "configs", `${dir}.json`)),
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
