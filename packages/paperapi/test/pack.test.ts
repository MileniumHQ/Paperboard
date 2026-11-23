import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as tar from "tar";
import { packPanel } from "../src/pack";

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "paperapi-pack-"));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content = ""): void {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
}

function panel(manifest: Record<string, unknown>, files: string[] = ["dist/index.html"]): void {
    write("manifest.json", JSON.stringify({ id: "dev.test.packed", name: "Packed", version: "0.2.0", ...manifest }));
    for (const f of files) write(f, "<!doctype html>");
}

const pack = () => packPanel({ targetDir: dir, autoBuild: false, log: () => {} });

describe("packPanel", () => {
    test("a valid panel packs to <id>-<version>.tar.gz holding manifest.json, dist/ and the manifest.base directory", async () => {
        panel({ base: "./web/index.html", widgets: [{ id: "status", name: "Status", sizes: ["2x1"] }], unlisted: true }, [
            "web/index.html",
            "dist/widget.html",
            "dist/images/1.webp",
            "src/secret-source.ts",
            "store/about.md",
        ]);
        const result = pack();
        expect(result.archiveName).toBe("dev.test.packed-0.2.0.tar.gz");
        expect(result.archivePath).toBe(join(dir, "out", "dev.test.packed-0.2.0.tar.gz"));
        const entries: string[] = [];
        await tar.t({ file: result.archivePath, onReadEntry: (entry) => entries.push(entry.path) });
        expect(entries.sort()).toEqual(["dist/", "dist/images/", "dist/images/1.webp", "dist/widget.html", "manifest.json", "web/", "web/index.html"]);
        expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    });
});
