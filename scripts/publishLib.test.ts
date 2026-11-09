import { describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASE_PUBLIC_KEY, releaseMessage, verifyRelease } from "../apps/paperboard/papercrane/releaseSignature";
import {
    ALL_TARGETS,
    assetFileName,
    buildCraneIndex,
    buildLatestYml,
    bunPinMismatch,
    dlFileUrl,
    expectedReleaseAssets,
    feedOf,
    isUpdatePayload,
    isValidFileSegment,
    isValidVersionSegment,
    legacyDownloadRedirect,
    mergeVersionRecord,
    paperboardArtifacts,
    paperboardPackages,
    r2YmlKey,
    tagFor,
    type Target,
} from "./publishLib";
import { signRelease } from "./releaseSigning";

const ROOT = join(import.meta.dir, "..");

// every file a release ships, by canonical name
function shippedFiles(version: string): string[] {
    return ALL_TARGETS.flatMap((t) => [
        assetFileName("pb", t),
        ...paperboardPackages(t, version).map((p) => p.releaseFile),
        assetFileName("crane", t),
    ]);
}

// One tag and canonical asset names per release.
describe("one tag and canonical asset names per release", () => {
    test("app and crane share the v<version> tag and ship under versionless names", () => {
        expect(tagFor("0.3.0")).toBe("v0.3.0");
        expect(tagFor("1.0.0-beta.2")).toBe("v1.0.0-beta.2");
        expect(shippedFiles("0.3.0").sort()).toEqual(
            [
                "paperboard-linux-x64.AppImage",
                "paperboard-linux-x64.deb",
                "paperboard-linux-x64.rpm",
                "paperboard-linux-arm64.AppImage",
                "paperboard-linux-arm64.deb",
                "paperboard-linux-arm64.rpm",
                "paperboard-macos-x64.zip",
                "paperboard-macos-arm64.zip",
                "paperboard-windows-x64-setup.exe",
                "crane-linux-x64.tar.gz",
                "crane-linux-arm64.tar.gz",
                "crane-macos-x64.tar.gz",
                "crane-macos-arm64.tar.gz",
                "crane-windows-x64.zip",
            ].sort(),
        );
    });

    test("electron-builder's versioned output names map to the canonical release names", () => {
        const builds = ALL_TARGETS.flatMap((t) => [paperboardArtifacts(t, "0.3.0"), ...paperboardPackages(t, "0.3.0")]);
        expect(Object.fromEntries(builds.map((b) => [b.buildFile, b.releaseFile]))).toEqual({
            "paperboard-0.3.0-linux-x86_64.AppImage": "paperboard-linux-x64.AppImage",
            "paperboard-0.3.0-linux-amd64.deb": "paperboard-linux-x64.deb",
            "paperboard-0.3.0-linux-x86_64.rpm": "paperboard-linux-x64.rpm",
            "paperboard-0.3.0-linux-arm64.AppImage": "paperboard-linux-arm64.AppImage",
            "paperboard-0.3.0-linux-arm64.deb": "paperboard-linux-arm64.deb",
            "paperboard-0.3.0-linux-aarch64.rpm": "paperboard-linux-arm64.rpm",
            "paperboard-0.3.0-x64.zip": "paperboard-macos-x64.zip",
            "paperboard-0.3.0-arm64.zip": "paperboard-macos-arm64.zip",
            "paperboard-0.3.0-windows-x64-setup.exe": "paperboard-windows-x64-setup.exe",
        });
    });

    test("re-indexing a release made before deb and rpm expects only what it shipped", () => {
        const pre = new Set(ALL_TARGETS.flatMap((t) => [assetFileName("pb", t), assetFileName("crane", t)]));
        const expected = expectedReleaseAssets(pre, "0.2.2").map((a) => a.file);
        expect(expected.sort()).toEqual([...pre].sort());

        // a release that ships some packages is expected to ship them all
        const partial = new Set([...pre, "paperboard-linux-x64.deb"]);
        const withPackages = expectedReleaseAssets(partial, "0.3.0").map((a) => a.file);
        expect(withPackages.sort()).toEqual(shippedFiles("0.3.0").sort());
    });
});

// Each target gets the update feed electron-updater requests.
describe("each target gets the update feed electron-updater requests", () => {
    test("feeds are keyed by the channel file each target's updater asks for", () => {
        const keys = Object.fromEntries(ALL_TARGETS.map((t) => [t, r2YmlKey(feedOf(t))]));
        expect(keys).toEqual({
            "linux-x64": "pb/latest-linux.yml",
            "linux-arm64": "pb/latest-linux-arm64.yml",
            "macos-x64": "pb/latest-mac.yml",
            "macos-arm64": "pb/latest-mac.yml",
            "windows-x64": "pb/latest.yml",
        });
    });

    test("a feed lists every entry under the latest alias with sha512, size, path and releaseDate", () => {
        const { key, text } = buildLatestYml(
            "macos",
            "0.3.0",
            [
                { target: "macos-arm64", file: "paperboard-macos-arm64.zip", sha512: "AAA=", size: 10 },
                { target: "macos-x64", file: "paperboard-macos-x64.zip", sha512: "BBB=", size: 20 },
            ],
            "2026-11-09T00:00:00.000Z",
        );
        expect(key).toBe("pb/latest-mac.yml");
        expect(text).toBe(
            [
                "version: 0.3.0",
                "files:",
                "  - url: https://i.paperboard.dev/pb/latest/paperboard-macos-arm64.zip",
                "    sha512: AAA=",
                "    size: 10",
                "  - url: https://i.paperboard.dev/pb/latest/paperboard-macos-x64.zip",
                "    sha512: BBB=",
                "    size: 20",
                "path: https://i.paperboard.dev/pb/latest/paperboard-macos-arm64.zip",
                "sha512: AAA=",
                "releaseDate: '2026-11-09T00:00:00.000Z'",
            ].join("\n"),
        );
        expect(() => buildLatestYml("linux", "0.3.0", [], "2026-11-09T00:00:00.000Z")).toThrow("No update artifacts for linux");
    });

    test("deb and rpm are never update payloads", () => {
        for (const t of ALL_TARGETS) {
            expect(isUpdatePayload(assetFileName("pb", t))).toBe(true);
            for (const pkg of paperboardPackages(t, "0.3.0")) expect(isUpdatePayload(pkg.releaseFile)).toBe(false);
        }
    });
});

// The crane update index is published signed.
describe("the crane update index is published signed", () => {
    test("one entry per target with version, sha256, the versioned URL and a verifying signature", () => {
        const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
        const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
        const files = ALL_TARGETS.map((target, i) => {
            const sha256 = crypto.createHash("sha256").update(target).digest("hex");
            return { target, file: assetFileName("crane", target), sha256, signature: signRelease(privateKey, releaseMessage.crane("0.3.0", sha256)), i };
        });
        const index = buildCraneIndex("0.3.0", files);
        expect(Object.keys(index).sort()).toEqual([...ALL_TARGETS].sort());
        for (const f of files) {
            const entry = index[f.target];
            expect(entry).toEqual({
                version: "0.3.0",
                sha256: f.sha256,
                downloadUrl: `https://i.paperboard.dev/crane/0.3.0/${f.file}`,
                signature: f.signature,
            });
            expect(verifyRelease(releaseMessage.crane(entry.version, entry.sha256), entry.signature, pub)).toBe(true);
            // signed by a throwaway key, so the real release key refuses it
            expect(verifyRelease(releaseMessage.crane(entry.version, entry.sha256), entry.signature, RELEASE_PUBLIC_KEY)).toBe(false);
        }
    });
});

// Download URL segments cannot break out, and history is kept.
describe("download URL segments cannot break out, and history is kept", () => {
    test("traversal, separators, encoding, whitespace, query, fragment and leading . or - are refused", () => {
        for (const bad of ["../x", "a/b", "a%20b", "a b", "a?b", "a#b", "", ".hidden", "-flag", "..", "a\\b"]) {
            expect(isValidVersionSegment(bad)).toBe(false);
            expect(isValidFileSegment(bad)).toBe(false);
        }
        for (const v of ["0.3.0", "1.0.0-beta.2", "2.0.0+build.5", "latest"]) expect(isValidVersionSegment(v)).toBe(true);
        for (const file of shippedFiles("0.3.0")) expect(isValidFileSegment(file)).toBe(true);
        expect(dlFileUrl("crane", "0.3.0", "crane-linux-x64.tar.gz")).toBe("https://i.paperboard.dev/crane/0.3.0/crane-linux-x64.tar.gz");
    });

    test("merging a version moves latest and keeps every earlier version's files", () => {
        const first = mergeVersionRecord(null, "0.2.2", [{ file: "crane-linux-x64.tar.gz", sha256: "a".repeat(64), size: 1 }]);
        expect(first).toEqual({ latest: "0.2.2", versions: { "0.2.2": { files: [{ file: "crane-linux-x64.tar.gz", sha256: "a".repeat(64), size: 1 }] } } });
        const second = mergeVersionRecord(first, "0.3.0", [{ file: "crane-linux-x64.tar.gz", sha256: "b".repeat(64), size: 2 }]);
        expect(second.latest).toBe("0.3.0");
        expect(second.versions["0.2.2"]).toEqual(first.versions["0.2.2"]);
        expect(second.versions["0.3.0"].files[0].sha256).toBe("b".repeat(64));
        // the merge never mutates the record it was given
        expect(Object.keys(first.versions)).toEqual(["0.2.2"]);
    });

    test("legacy per-target downloads map to the canonical latest URL, unknown targets to null", () => {
        expect(legacyDownloadRedirect("paperboard", "macos-arm64")).toBe("https://i.paperboard.dev/pb/latest/paperboard-macos-arm64.zip");
        expect(legacyDownloadRedirect("crane", "windows-x64")).toBe("https://i.paperboard.dev/crane/latest/crane-windows-x64.zip");
        for (const t of ALL_TARGETS as Target[]) expect(legacyDownloadRedirect("crane", t)).toBe(dlFileUrl("crane", "latest", assetFileName("crane", t)));
        expect(legacyDownloadRedirect("crane", "windows-arm64")).toBeNull();
        expect(legacyDownloadRedirect("paperboard", "../x")).toBeNull();
    });
});

// Releases compile only with the exact pinned Bun.
describe("releases compile only with the exact pinned Bun", () => {
    test("the pin must be exact and the running Bun must equal it", () => {
        expect(bunPinMismatch("bun@1.4.4", "1.4.4")).toBeNull();
        expect(bunPinMismatch("bun@1.4.4", "1.4.5")).toBe(
            "release binaries embed the running Bun: pinned bun@1.4.4, running bun@1.4.5. Install Bun 1.4.4 before publishing.",
        );
        for (const loose of ["bun@^1.4.4", "bun@1.4", "bun@latest", "npm@10.0.0", undefined, 144]) {
            expect(bunPinMismatch(loose, "1.4.4")).toContain("must pin an exact Bun (bun@x.y.z)");
        }
    });

    test("the repo pins bun@1.4.4 and every CI gate job installs that same Bun", () => {
        const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
        expect(pkg.packageManager).toBe("bun@1.4.4");
        expect(bunPinMismatch(pkg.packageManager, "1.4.4")).toBeNull();
        const workflow = Bun.YAML.parse(readFileSync(join(ROOT, ".github", "workflows", "gate.yml"), "utf8")) as {
            jobs: Record<string, { steps?: { uses?: string; with?: Record<string, unknown> }[] }>;
        };
        const setups = Object.values(workflow.jobs).flatMap((job) => (job.steps ?? []).filter((s) => s.uses?.startsWith("oven-sh/setup-bun")));
        expect(setups.length).toBeGreaterThan(0);
        for (const step of setups) expect(`bun@${step.with?.["bun-version"]}`).toBe(pkg.packageManager);
    });
});
