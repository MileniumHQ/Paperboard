// package-install refusal (bun test): packages refuse exactly like panels —
// no checksum fact from the anchor means no install, before any network
import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PaperCraneEngine } from "../papercrane/engine";

let tmp = "";
afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("downloadPackage refuses unverified installs", () => {
    it("rejects a missing checksum before any network is touched", async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "package-refusal-"));
        const engine = new PaperCraneEngine(tmp);
        await expect(
            engine.downloadPackage("some-tool", "dl-1"),
        ).rejects.toThrow(/sha256/);
        // nothing survives on disk
        expect(fs.existsSync(path.join(tmp, "packages", "some-tool"))).toBe(false);
    });

    it("rejects garbage checksums, not just missing ones", async () => {
        const engine = new PaperCraneEngine(tmp);
        await expect(
            engine.downloadPackage("some-tool", "dl-2", undefined, "abc123"),
        ).rejects.toThrow(/sha256/);
    });

    it("still rejects invalid package ids at the boundary", async () => {
        const engine = new PaperCraneEngine(tmp);
        await expect(
            engine.downloadPackage("../evil", "dl-3", undefined, "a".repeat(64)),
        ).rejects.toThrow(/Invalid package id|Invalid panel id|invalid/i);
    });
});
