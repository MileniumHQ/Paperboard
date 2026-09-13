// pack-refusal regression (bun test): a manifest without a version is the
// package that must not ship, and the packer must say so loudly
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as tar from "tar";
import { packPanel } from "../src/pack";

let tmp: string;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "packer-"));
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

function writeManifest(extra: Record<string, unknown>) {
    const dir = path.join(tmp, "panel");
    fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(dir, "dist", "index.html"), "<html></html>");
    fs.writeFileSync(
        path.join(dir, "manifest.json"),
        JSON.stringify({ id: "dev.test.pack", name: "Pack Test", ...extra }),
    );
    return dir;
}

describe("packPanel version fence", () => {
    it("refuses to pack a manifest without a version, naming the panel", () => {
        const dir = writeManifest({ version: undefined });
        expect(() => packPanel({ targetDir: dir, autoBuild: false })).toThrow(
            /Pack Test/,
        );
    });

    it("packs a manifest that declares a version", () => {
        const dir = writeManifest({ version: "3.0.0-alpha" });
        const result = packPanel({ targetDir: dir, autoBuild: false });
        expect(result.version).toBe("3.0.0-alpha");
        expect(result.archiveName).toBe("dev.test.pack-3.0.0-alpha.tar.gz");
    });
});

describe("packPanel manifest.base packing", () => {
    it("packs the directory holding manifest.base, not just dist/", () => {
        const dir = writeManifest({ version: "1.0.0", base: "./ui/index.html" });
        fs.mkdirSync(path.join(dir, "ui"), { recursive: true });
        fs.writeFileSync(path.join(dir, "ui", "index.html"), "<html></html>");
        const result = packPanel({ targetDir: dir, autoBuild: false });

        // extract and verify the base directory's entry made the archive
        const extractDir = path.join(tmp, "extract");
        fs.mkdirSync(extractDir);
        tar.extract({ file: result.archivePath, cwd: extractDir, sync: true });
        expect(fs.existsSync(path.join(extractDir, "ui", "index.html"))).toBe(
            true,
        );
        expect(fs.existsSync(path.join(extractDir, "dist", "index.html"))).toBe(
            true,
        );
        expect(fs.existsSync(path.join(extractDir, "manifest.json"))).toBe(true);
    });
});