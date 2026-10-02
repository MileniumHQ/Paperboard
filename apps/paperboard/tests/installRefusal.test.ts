// install-trust boundary (bun test): the daemon installs only what its own
// registry lists, from the registry, and only an archive whose manifest
// agrees with the request and the record. Real loopback registry, real
// download, real extraction.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PaperCraneEngine } from "../papercrane/engine";
import { startFixtureRegistry, manifestFile, type FixtureRegistry } from "./registryFixture";

let tmp = "";
let registry: FixtureRegistry;
let engine: PaperCraneEngine;
const ID = "dev.test.install";
const PAGE = { "dist/index.html": "<html>panel</html>" };

beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-refusal-"));
    registry = await startFixtureRegistry(tmp);
    engine = new PaperCraneEngine(path.join(tmp, "home"), undefined, registry.url);
});

afterEach(async () => {
    await registry.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
});

const installed = () => fs.existsSync(engine.resolvePath("panels", ID));

describe("installPanel resolves the release from its own registry", () => {
    it("installs the listed release when the archive agrees with it", async () => {
        await registry.publish(ID, "0.2.0", { "manifest.json": manifestFile(ID, "0.2.0"), ...PAGE });
        const panel = await engine.installPanel(ID, { version: "0.2.0" });
        expect(panel.id).toBe(ID);
        expect(panel.version).toBe("0.2.0");
        expect(installed()).toBe(true);
    });

    it("refuses when the registry has no record for the panel", async () => {
        await expect(engine.installPanel(ID)).rejects.toThrow(/registry record unavailable/);
        expect(installed()).toBe(false);
    });

    it("refuses a record without a checksum", async () => {
        await registry.publish(ID, "0.2.0", { "manifest.json": manifestFile(ID, "0.2.0"), ...PAGE }, { sha256: undefined });
        await expect(engine.installPanel(ID)).rejects.toThrow(/sha256/);
        expect(installed()).toBe(false);
    });

    it("refuses when the caller expected a different release than the registry lists", async () => {
        await registry.publish(ID, "0.3.0", { "manifest.json": manifestFile(ID, "0.3.0"), ...PAGE });
        await expect(engine.installPanel(ID, { version: "0.2.0" })).rejects.toThrow(/requested version 0.2.0/);
        await expect(engine.installPanel(ID, { sha256: "a".repeat(64) })).rejects.toThrow(/different bytes/);
        expect(installed()).toBe(false);
    });

    it("refuses bytes that do not match the record's checksum", async () => {
        const release = await registry.publish(ID, "0.2.0", { "manifest.json": manifestFile(ID, "0.2.0"), ...PAGE });
        release.archive = new Uint8Array([...release.archive, 0]);
        await expect(engine.installPanel(ID)).rejects.toThrow(/SHA256 mismatch/);
        expect(installed()).toBe(false);
    });

    it("refuses an archive without a manifest", async () => {
        await registry.publish(ID, "0.2.0", PAGE);
        await expect(engine.installPanel(ID)).rejects.toThrow(/no manifest\.json/);
        expect(installed()).toBe(false);
    });

    it("refuses an archive whose manifest omits or names another id", async () => {
        await registry.publish(ID, "0.2.0", { "manifest.json": JSON.stringify({ name: "x", version: "0.2.0" }), ...PAGE });
        await expect(engine.installPanel(ID)).rejects.toThrow(/manifest names undefined/);
        await registry.publish(ID, "0.2.0", { "manifest.json": manifestFile("dev.test.other", "0.2.0"), ...PAGE });
        await expect(engine.installPanel(ID)).rejects.toThrow(/manifest names "dev.test.other"/);
        expect(installed()).toBe(false);
    });

    it("refuses an archive whose manifest version differs from the record", async () => {
        await registry.publish(ID, "0.2.0", { "manifest.json": manifestFile(ID, "0.1.0"), ...PAGE });
        await expect(engine.installPanel(ID)).rejects.toThrow(/archive is version "0.1.0"/);
        expect(installed()).toBe(false);
    });

    it("still rejects invalid panel ids before any network", async () => {
        await expect(engine.installPanel("../evil")).rejects.toThrow(/Invalid panel id/);
    });
});
