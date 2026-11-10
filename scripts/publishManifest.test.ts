import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storeUploadParts } from "./publishLib";
import { discoverPanels, PANELS_ROOT, resolvePublishTarget } from "./publishManifest";

let work: string;

beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "publish-manifest-"));
});

afterEach(() => {
    rmSync(work, { recursive: true, force: true });
});

function panel(dirName: string, manifest: string | object): string {
    const dir = join(work, dirName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
    return dir;
}

// Panel publishing finds every panel and refuses incomplete ones.
describe("panel publishing finds every panel and refuses incomplete ones", () => {
    test("PANELS_ROOT is <repo>/panels and finds the real first-party panels", () => {
        expect(PANELS_ROOT).toBe(join(import.meta.dir, "..", "panels"));
        const skipped: string[] = [];
        const found = discoverPanels(PANELS_ROOT, (dir, err) => skipped.push(`${dir}: ${String(err)}`));
        expect(skipped).toEqual([]);
        const ids = found.map((p) => p.id);
        expect(ids).toContain("dev.paperboard.terminal");
        expect(ids).toContain("dev.paperboard.gameserver");
        expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
        const terminal = found.find((p) => p.id === "dev.paperboard.terminal")!;
        expect(terminal.dir).toBe(join(PANELS_ROOT, "dev.paperboard.terminal"));
        expect(terminal.version).toBe(JSON.parse(readFileSync(join(terminal.dir, "manifest.json"), "utf8")).version);
    });

    test("a broken manifest is reported to the caller, and throws when nobody listens", () => {
        panel("good.panel", { id: "good.panel", name: "Good", version: "0.1.0" });
        panel("broken.panel", "{ not json");
        const skipped: string[] = [];
        const found = discoverPanels(work, (dir) => skipped.push(dir));
        expect(found.map((p) => p.id)).toEqual(["good.panel"]);
        expect(skipped).toEqual(["broken.panel"]);
        expect(() => discoverPanels(work)).toThrow();
    });

    test("a manifest without a string version is refused, never published as 1.0.0", () => {
        const dir = panel("half.panel", {});
        expect(() => resolvePublishTarget({ id: "half.panel", name: "Half" }, dir)).toThrow(
            'Refusing to publish "Half" (half.panel): manifest.json has no "version" field.',
        );
        expect(() => resolvePublishTarget({ id: "half.panel", version: 1 }, dir)).toThrow('has no "version" field');
        expect(() => resolvePublishTarget({ id: "half.panel", version: "" }, dir)).toThrow('has no "version" field');
        expect(() => resolvePublishTarget([], dir)).toThrow("manifest.json is not an object");
        expect(() => resolvePublishTarget({ id: "../escape", version: "0.1.0" }, dir)).toThrow("Invalid panel id");
        expect(resolvePublishTarget({ id: "half.panel", version: "0.1.0" }, dir)).toEqual({ id: "half.panel", name: "half.panel", version: "0.1.0" });
    });

    test("a store file that is missing or outside store/ refuses the publish", () => {
        const dir = panel("listed.panel", {});
        const read = (rel: string) => readFileSync(join(dir, rel));
        expect(() => storeUploadParts({ about: "./store/about.md" }, read)).toThrow("ENOENT");
        expect(() => storeUploadParts({ about: "./README.md" }, read)).toThrow("store.about must be a relative path inside store/");
        expect(() => storeUploadParts({ about: "./store/../secret.md" }, read)).toThrow("inside store/");
        expect(() => storeUploadParts({ screenshots: [{ light: "/etc/shot.png" }] }, read)).toThrow("inside store/");

        mkdirSync(join(dir, "store"));
        writeFileSync(join(dir, "store", "about.md"), "# Listed\n");
        writeFileSync(join(dir, "store", "1-light.png"), new Uint8Array([1, 2, 3]));
        const parts = storeUploadParts({ about: "./store/about.md", screenshots: [{ light: "./store/1-light.png" }] }, read);
        expect(parts.about).toBe("# Listed\n");
        expect(parts.files.map((f) => [f.field, f.fileName, f.type, f.bytes.byteLength])).toEqual([["screenshot-0-light", "1-light.png", "image/png", 3]]);
    });

    test("every first-party panel's store listing validates and its files exist", () => {
        const panels = discoverPanels(PANELS_ROOT);
        expect(panels.length).toBeGreaterThan(0);
        for (const info of panels) {
            const manifest = JSON.parse(readFileSync(join(info.dir, "manifest.json"), "utf8"));
            const parts = storeUploadParts(manifest.store, (rel) => readFileSync(join(info.dir, rel)));
            expect(parts.about !== undefined).toBe(manifest.store?.about !== undefined);
        }
    });
});
