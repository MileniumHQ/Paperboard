import { describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RELEASE_PUBLIC_KEY, releaseMessage, verifyRelease } from "../../packages/release/src";
import {
    ALL_TARGETS,
    assetFileName,
    buildCraneIndex,
    buildLatestYml,
    buildSha256Sums,
    bunPinMismatch,
    dlFileUrl,
    expectedReleaseAssets,
    feedOf,
    isUpdatePayload,
    isValidFileSegment,
    isValidVersionSegment,
    KV_PACKAGES_BINDING,
    mergeVersionRecord,
    APP_KEYS,
    missingAppKeys,
    paperboardArtifacts,
    paperboardPackages,
    PAPERDL_R2_BUCKET,
    r2YmlKey,
    FULL_GATE_EVENTS,
    releaseGateProblem,
    tagFor,
    type GateRun,
} from "./publishLib";
import { signRelease } from "./releaseSigning";

const ROOT = join(import.meta.dir, "..", "..");

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
                "paperboard-windows-x64.msi",
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
            "paperboard-0.3.0-windows-x64.msi": "paperboard-windows-x64.msi",
        });
    });

    test("re-indexing a release expects only the packages it shipped", () => {
        const pre = new Set(ALL_TARGETS.flatMap((t) => [assetFileName("pb", t), assetFileName("crane", t)]));
        const expected = expectedReleaseAssets(pre, "0.2.2").map((a) => a.file);
        expect(expected.sort()).toEqual([...pre].sort());

        // a release that ships some packages is expected to ship them all
        const partial = new Set([...pre, "paperboard-linux-x64.deb"]);
        const withPackages = expectedReleaseAssets(partial, "0.3.0").map((a) => a.file);
        expect(withPackages.sort()).toEqual(shippedFiles("0.3.0").filter((f) => !f.endsWith(".msi")).sort());

        // a release with the deb and rpm but no MSI (v0.4.0) still re-indexes
        const linuxOnly = new Set([...pre, ...shippedFiles("0.4.0").filter((f) => f.endsWith(".deb") || f.endsWith(".rpm"))]);
        expect(expectedReleaseAssets(linuxOnly, "0.4.0").map((a) => a.file).sort()).toEqual([...linuxOnly].sort());

        // one that ships the MSI is expected to ship all of them
        const withMsi = new Set([...linuxOnly, "paperboard-windows-x64.msi"]);
        expect(expectedReleaseAssets(withMsi, "0.5.0").map((a) => a.file).sort()).toEqual([...withMsi].sort());
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

    test("deb, rpm and msi are never update payloads", () => {
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

    test("the repo pins bun@1.4.4 and every CI job, the release builds included, installs that same Bun", () => {
        const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
        expect(pkg.packageManager).toBe("bun@1.4.4");
        expect(bunPinMismatch(pkg.packageManager, "1.4.4")).toBeNull();
        for (const file of ["gate.yml", "release.yml"]) {
            const workflow = Bun.YAML.parse(readFileSync(join(ROOT, ".github", "workflows", file), "utf8")) as {
                jobs: Record<string, { steps?: { uses?: string; with?: Record<string, unknown> }[] }>;
            };
            const setups = Object.values(workflow.jobs).flatMap((job) => (job.steps ?? []).filter((s) => s.uses?.startsWith("oven-sh/setup-bun")));
            expect(setups.length).toBeGreaterThan(0);
            for (const step of setups) expect(`bun@${step.with?.["bun-version"]}`).toBe(pkg.packageManager);
        }
    });
});

// install.sh and install.ps1 read this list to check what they download
describe("the install scripts' checksum list", () => {
    test("is sha256sum's format, one line per download, sorted, and refuses anything it can't list safely", () => {
        const a = "a".repeat(64);
        const b = "b".repeat(64);
        expect(buildSha256Sums([
            { file: "paperboard-windows-x64-setup.exe", sha256: b },
            { file: "paperboard-linux-x64.AppImage", sha256: a },
        ])).toBe(`${a}  paperboard-linux-x64.AppImage\n${b}  paperboard-windows-x64-setup.exe\n`);
        expect(() => buildSha256Sums([])).toThrow();
        expect(() => buildSha256Sums([{ file: "../x", sha256: a }])).toThrow();
        expect(() => buildSha256Sums([{ file: "x.deb", sha256: a.toUpperCase() }])).toThrow();
        expect(() => buildSha256Sums([{ file: "x.deb", sha256: a }, { file: "x.deb", sha256: a }])).toThrow();
    });
});

describe("publishing writes where the download worker reads", () => {
    test("the KV binding and R2 bucket are the ones services/origami/wrangler.jsonc binds", () => {
        const wrangler = require(join(ROOT, "services/origami/wrangler.jsonc")) as {
            kv_namespaces: { binding: string }[];
            r2_buckets: { binding: string; bucket_name: string }[];
        };
        expect(wrangler.kv_namespaces.map((kv) => kv.binding)).toContain(KV_PACKAGES_BINDING);
        expect(wrangler.r2_buckets.find((r2) => r2.binding === "PAPERDL_BUCKET")?.bucket_name).toBe(PAPERDL_R2_BUCKET);
    });
});

describe("a release build carries every app key, or refuses to start", () => {
    test("every key the app declares is required, and no other", () => {
        const declared = [...readFileSync(join(ROOT, "apps", "paperboard", "src", "main", "env.d.ts"), "utf8").matchAll(/readonly (MAIN_VITE_\w+)/g)].map((m) => m[1]);
        const required: string[] = [...APP_KEYS];
        expect(required.sort()).toEqual(declared.sort());
    });

    test("all keys pass; a missing or blank one is named with where it goes", () => {
        expect(missingAppKeys({ MAIN_VITE_GOOGLE_CLIENT_ID: "id", MAIN_VITE_GOOGLE_CLIENT_SECRET: "secret" })).toBeNull();
        expect(missingAppKeys({ MAIN_VITE_GOOGLE_CLIENT_ID: "id", MAIN_VITE_GOOGLE_CLIENT_SECRET: " " })).toBe(
            "A release build needs MAIN_VITE_GOOGLE_CLIENT_SECRET: put it in apps/paperboard/.env.local, or in the repository's Actions secrets for the release workflow.",
        );
        expect(missingAppKeys({})).toContain("needs MAIN_VITE_GOOGLE_CLIENT_ID and MAIN_VITE_GOOGLE_CLIENT_SECRET: put them in");
    });
});

describe("a release builds only a commit the whole gate passed", () => {
    const sha = "a".repeat(40);
    const run = (over: Partial<GateRun>): GateRun => ({
        event: "push", status: "completed", conclusion: "success", head_sha: sha, html_url: "https://github.com/run/1", ...over,
    });

    test("a passed push, merge queue or manual run at that exact commit is enough", () => {
        for (const event of ["push", "merge_group", "workflow_dispatch"]) {
            expect(releaseGateProblem(sha, [run({ event })])).toBeNull();
        }
        // one green full run among failed ones counts: a re-run that passed
        expect(releaseGateProblem(sha, [run({ conclusion: "failure" }), run({ event: "workflow_dispatch" })])).toBeNull();
    });

    test("a pull request's scoped run never counts, nor a run of another commit", () => {
        expect(releaseGateProblem(sha, [run({ event: "pull_request" })])).toContain("never had a full Gate run");
        expect(releaseGateProblem(sha, [run({ head_sha: "b".repeat(40) })])).toContain("never had a full Gate run");
        expect(releaseGateProblem(sha, [])).toContain("gh workflow run gate.yml --repo MileniumHQ/Paperboard --ref main");
    });

    test("a running, failed or cancelled full run refuses, saying which and where", () => {
        expect(releaseGateProblem(sha, [run({ status: "in_progress", conclusion: null })])).toBe(
            "The full Gate on aaaaaaaaaa is still running (https://github.com/run/1). Release once it passes.",
        );
        const failed = releaseGateProblem(sha, [run({ conclusion: "failure" }), run({ conclusion: "cancelled", event: "workflow_dispatch" })]);
        expect(failed).toContain("did not pass (failure, cancelled: https://github.com/run/1)");
    });

    test("the commit is named by its full SHA, never a branch or a short one", () => {
        for (const ref of ["main", "aaaaaaa", "A".repeat(40)]) {
            expect(releaseGateProblem(ref, [run({ head_sha: ref })])).toContain("by its full SHA");
        }
    });

    test("the release workflow checks it before any target builds", () => {
        const workflow = Bun.YAML.parse(readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8")) as {
            jobs: Record<string, { needs?: string | string[]; permissions?: Record<string, string>; steps?: { run?: string }[] }>;
        };
        const verify = workflow.jobs.verify!;
        expect(verify.permissions).toEqual({ contents: "read", actions: "read" });
        const runs = (verify.steps ?? []).map((s) => s.run ?? "").join("\n");
        expect(runs).toContain("bun scripts/publish/releaseGate.ts");
        expect(runs).toContain("git merge-base --is-ancestor \"$COMMIT\" origin/main");
        expect(workflow.jobs.build!.needs).toBe("verify");
    });

    test("the events it counts are ones gate.yml runs on, and runs in full", () => {
        const workflow = Bun.YAML.parse(readFileSync(join(ROOT, ".github", "workflows", "gate.yml"), "utf8")) as {
            on: Record<string, unknown>;
            jobs: { scope: { steps: { run?: string }[] } };
        };
        for (const event of FULL_GATE_EVENTS) expect(Object.keys(workflow.on)).toContain(event);
        // only a pull request's description scopes the run
        expect(workflow.jobs.scope.steps.map((s) => s.run ?? "").join("\n")).toContain('if [ "$EVENT" = pull_request ]; then');
    });

    test("a commit that isn't a full SHA is refused before GitHub is asked", () => {
        // a gh that says so if it's called, and nothing else on PATH
        const bin = mkdtempSync(join(tmpdir(), "release-gate-"));
        try {
            writeFileSync(join(bin, "gh"), "#!/bin/sh\necho 'gh was called' >&2\nexit 99\n", { mode: 0o755 });
            const proc = Bun.spawnSync([process.execPath, join(import.meta.dir, "releaseGate.ts"), "main"], {
                env: { PATH: bin },
                stdout: "pipe",
                stderr: "pipe",
            });
            expect([proc.exitCode, proc.stderr.toString()]).toEqual([1, 'Refusing to release: A release names its commit by its full SHA, got "main".\n']);
        } finally {
            rmSync(bin, { recursive: true, force: true });
        }
    });
});
