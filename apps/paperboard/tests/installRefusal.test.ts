// install-trust boundary (bun test): refuse everything that can't prove itself
import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PaperCraneEngine } from "../papercrane/engine";

let tmp = "";
afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("installPanel refuses unverified installs", () => {
    it("rejects a missing checksum before any network is touched", async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-refusal-"));
        const engine = new PaperCraneEngine(tmp);
        await expect(
            engine.installPanel("dev.evil.panel", "https://registry.example/panel/dev.evil.panel/download"),
        ).rejects.toThrow(/sha256/);
        // nothing was fetched, nothing survives on disk
        expect(fs.existsSync(path.join(tmp, "panels", "dev.evil.panel"))).toBe(false);
    });

    it("rejects garbage checksums, not just missing ones", async () => {
        const engine = new PaperCraneEngine(tmp);
        await expect(
            engine.installPanel("dev.evil.panel", "https://registry.example/x", "abc123"),
        ).rejects.toThrow(/sha256/);
    });

    it("still rejects invalid panel ids at the boundary", async () => {
        const engine = new PaperCraneEngine(tmp);
        await expect(
            engine.installPanel(
                "../evil",
                "https://registry.example/x",
                "a".repeat(64),
            ),
        ).rejects.toThrow(/Invalid panel id/);
    });
});
