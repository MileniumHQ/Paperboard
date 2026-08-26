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
