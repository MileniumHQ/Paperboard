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

// The packer refuses what must not ship.
describe("the packer refuses what must not ship", () => {
    test("a manifest without a version is refused", () => {
        panel({ version: undefined });
        expect(pack).toThrow("Panel manifest must specify a 'version'");
    });

    test("widget declarations the daemon would refuse are refused", () => {
        panel({ widgets: [{ id: "Bad Id", name: "W", sizes: ["1x1"] }] }, ["dist/index.html", "dist/widget.html"]);
        expect(pack).toThrow("widget 0 needs an id of lowercase letters, digits and dashes");
        panel({ widgets: [{ id: "w", name: "W", sizes: ["9x9"] }] }, ["dist/index.html", "dist/widget.html"]);
        expect(pack).toThrow('size "9x9" must look like "2x1"');
    });

    test("widgets without dist/widget.html and a non-boolean unlisted are refused", () => {
        panel({ widgets: [{ id: "status", name: "Status", sizes: ["2x1"] }] });
        expect(pack).toThrow("manifest declares widgets but dist/widget.html does not exist");
        panel({ unlisted: "yes" });
        expect(pack).toThrow("Panel manifest 'unlisted' must be true or false");
    });

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
