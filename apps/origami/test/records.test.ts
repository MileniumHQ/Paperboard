import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { putRecord, signRecord, type CommandRunner } from "../scripts/lib/kv";
import type { PackageRecord } from "../scripts/lib/records";
import { releaseMessage, verifyRelease } from "../../paperboard/papercrane/releaseSignature";
import { parsePackageRecipe, recipeDigest } from "../../paperboard/papercrane/packageRecipe";

const keys = generateKeyPairSync("ed25519");
const PUBLIC = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const SHA = "ab".repeat(32);

function recorder(): { run: CommandRunner; spawned: string[][] } {
    const spawned: string[][] = [];
    return {
        spawned,
        run: async (command, args) => {
            spawned.push([command, ...args]);
            return { stdout: "", stderr: "" };
        },
    };
}

function record(platforms: PackageRecord["platforms"]): PackageRecord {
    return { name: "helium", version: "0.5.1", platforms };
}

const recipe = { unpack: "tar" as const, take: { "bin/helium": "helium-0.5.1/helium" } };

// Package records are valid and signed, recipe included.
describe("package records are valid and signed, recipe included", () => {
    test("an invalid record is refused before the KV writer runs", async () => {
        const invalid: [PackageRecord, RegExp][] = [
            [record({ "linux-x64": { url: "https://example.test/a.tgz", sha256: SHA, recipe: { unpack: "tar", take: { "bin/x": "../../etc/passwd" } } } }), /not a plain relative path/],
            [record({ "linux-x64": { url: "https://example.test/a.tgz", sha256: SHA, recipe: { unpack: "tar", take: { "bin/x": "/etc/passwd" } } } }), /not a plain relative path/],
            [record({ "linux-x64": { url: "https://example.test/a.tgz", sha256: SHA, recipe: { unpack: "tar", take: { "../bin": "x" } } } }), /not a plain relative path/],
            [record({ "linux-x64": { url: "https://example.test/a.tgz", sha256: SHA, layout: "root", recipe } }), /one or the other/],
            [record({ "linux-x64": { url: "http://example.test/a.tgz", sha256: SHA } }), /must be https/],
            [record({ "linux-x64": { url: "file:///etc/passwd", sha256: SHA } }), /must be https/],
        ];
        for (const [bad, reason] of invalid) {
            const { run, spawned } = recorder();
            await expect(putRecord(bad, keys.privateKey, run, PUBLIC)).rejects.toThrow(reason);
            expect(spawned).toEqual([]);
        }
    });

    test("every platform is signed over name, version, platform, sha256 and the recipe digest", async () => {
        const { run, spawned } = recorder();
        const plain = { url: "https://example.test/b.zip", sha256: SHA, layout: "bin" as const };
        const input = record({ "linux-x64": { url: "https://example.test/a.tgz", sha256: SHA, recipe }, "windows-x64": plain });
        expect(await putRecord(input, keys.privateKey, run, PUBLIC)).toBe("written");
        expect(spawned).toHaveLength(1);
        const written = JSON.parse(spawned[0]![spawned[0]!.indexOf("put") + 2]!) as PackageRecord;
        expect(spawned[0]![spawned[0]!.indexOf("put") + 1]).toBe("helium");

        const linux = written.platforms["linux-x64"]!;
        const digest = recipeDigest(parsePackageRecipe(recipe));
        expect(verifyRelease(releaseMessage.package("helium", "0.5.1", "linux-x64", SHA, digest), linux.signature, PUBLIC)).toBe(true);
        // the recipe is part of what was signed: without it, or with another, nothing verifies
        expect(verifyRelease(releaseMessage.package("helium", "0.5.1", "linux-x64", SHA), linux.signature, PUBLIC)).toBe(false);
        const swapped = recipeDigest(parsePackageRecipe({ unpack: "tar", take: { "bin/helium": "evil" } }));
        expect(verifyRelease(releaseMessage.package("helium", "0.5.1", "linux-x64", SHA, swapped), linux.signature, PUBLIC)).toBe(false);
        // nor for another platform, version or package
        expect(verifyRelease(releaseMessage.package("helium", "0.5.1", "linux-arm64", SHA, digest), linux.signature, PUBLIC)).toBe(false);
        expect(verifyRelease(releaseMessage.package("helium", "0.5.2", "linux-x64", SHA, digest), linux.signature, PUBLIC)).toBe(false);
        expect(verifyRelease(releaseMessage.package("java-21", "0.5.1", "linux-x64", SHA, digest), linux.signature, PUBLIC)).toBe(false);

        const windows = written.platforms["windows-x64"]!;
        expect(verifyRelease(releaseMessage.package("helium", "0.5.1", "windows-x64", SHA), windows.signature, PUBLIC)).toBe(true);
    });

    test("a private key that does not match the expected public key is refused before wrangler is spawned", async () => {
        const { run, spawned } = recorder();
        const other = generateKeyPairSync("ed25519");
        const input = record({ "linux-x64": { url: "https://example.test/a.tgz", sha256: SHA, recipe } });
        await expect(putRecord(input, other.privateKey, run, PUBLIC)).rejects.toThrow(/does not match/);
        // and against the shipped key, the throwaway key here can never sign
        await expect(putRecord(input, keys.privateKey, run)).rejects.toThrow(/does not match/);
        expect(() => signRecord(input, other.privateKey, PUBLIC)).toThrow(/does not match/);
        expect(spawned).toEqual([]);
    });
});
