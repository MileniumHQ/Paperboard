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
describe("packPanel widgets", () => {
    const widgets = [{ id: "status", name: "Status", sizes: ["2x1"] }];

    it("refuses widgets whose declaration the daemon would refuse", () => {
        const dir = writeManifest({ version: "0.1.0", widgets: [{ id: "status", name: "Status", sizes: ["9x9"] }] });
        expect(() => packPanel({ targetDir: dir, autoBuild: false })).toThrow(/size/);
    });

    it("refuses widgets without the dist/widget.html they load from", () => {
        const dir = writeManifest({ version: "0.1.0", widgets });
        expect(() => packPanel({ targetDir: dir, autoBuild: false })).toThrow(/widget\.html/);
    });

    it("packs widgets with their page", () => {
        const dir = writeManifest({ version: "0.1.0", widgets });
        fs.writeFileSync(path.join(dir, "dist", "widget.html"), "<html></html>");
        expect(packPanel({ targetDir: dir, autoBuild: false }).version).toBe("0.1.0");
    });
});
