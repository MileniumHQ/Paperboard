import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildLatestSteamcmdRecord, buildSteamcmdRecord, STEAMCMD_BUILDS } from "../scripts/update-steamcmd";
import { buildLatestLibcurlGnutlsRecord, buildLibcurlGnutlsRecord, LIBCURL_GNUTLS_BUILD, libcurlGnutlsUrl } from "../scripts/update-libcurl-gnutls";
import { buildLatestSourcemodRecords, SOURCEMOD_BUILDS } from "../scripts/update-sourcemod";
import { buildWindowsRuntimeRecords, WINDOWS_RUNTIMES } from "../scripts/update-windows-runtimes";
import type { GithubRelease } from "../scripts/lib/github";
import { buildLatestOllamaRecord } from "../scripts/update-ollama";
import { buildLatestOpencodeRecord } from "../scripts/update-opencode";
import { buildLatestAntigravityRecord, MANIFEST_BASE as ANTIGRAVITY_MANIFEST_BASE, TARGETS as ANTIGRAVITY_TARGETS } from "../scripts/update-antigravity";
import { buildLatestCodexRecord, TARGETS } from "../scripts/update-codex";
import { buildLatestDotnetRecord, RIDS } from "../scripts/update-dotnet";
import { buildLatestProtonRecord } from "../scripts/update-proton";
import { buildLatestHeliumRecord, REPOS as HELIUM_REPOS, type HeliumRepo } from "../scripts/update-helium";
import { type AdoptiumAsset, buildJavaRecords } from "../scripts/update-java";
import { PLATFORM_KEYS } from "../scripts/lib/records";
import { requested, resetUpstream, serve, upstreamFetch } from "./helpers/upstream";

const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sha512 = (bytes: string | Uint8Array) => createHash("sha512").update(bytes).digest("hex");
const TAMPERED = new TextEncoder().encode("bytes that are not the reviewed release");

beforeEach(resetUpstream);

/** A GitHub release whose assets are these files, each with GitHub's sha256 digest. */
function release(tag: string, files: Record<string, string | null>, extra: Partial<GithubRelease> = {}): GithubRelease {
    return {
        tag_name: tag,
        draft: false,
        prerelease: false,
        assets: Object.entries(files).map(([name, content]) => ({
            name,
            size: content?.length ?? 0,
            digest: content === null ? null : `sha256:${sha256(content)}`,
            browser_download_url: `https://github.com/owner/repo/releases/download/${tag}/${name}`,
        })),
        ...extra,
    };
}

function sums(files: Record<string, string>): string {
    return Object.entries(files)
        .map(([name, content]) => `${sha256(content)}  ${name}`)
        .join("\n");
}

const assetUrl = (rel: GithubRelease, name: string) => rel.assets.find((a) => a.name === name)!.browser_download_url;

// Updaters publish only bytes that match a trusted digest.
describe("updaters publish only bytes that match a trusted digest", () => {
    describe("pinned upstreams refuse a digest that differs from the reviewed pin", () => {
        test("SteamCMD", async () => {
            for (const build of Object.values(STEAMCMD_BUILDS)) serve(`https://steamcdn-a.akamaihd.net/client/installer/${build!.file}`, TAMPERED);
            await expect(buildLatestSteamcmdRecord(upstreamFetch)).rejects.toThrow(/sha256 differs from reviewed pin/);
            // only the pinned digests build a record
            const pinned = Object.fromEntries(Object.entries(STEAMCMD_BUILDS).map(([k, b]) => [k, { sha256: b!.sha256, size: 1 }]));
            expect(Object.keys(buildSteamcmdRecord(pinned).platforms).sort()).toEqual(Object.keys(STEAMCMD_BUILDS).sort());
        });

        test("libcurl-gnutls", async () => {
            serve(libcurlGnutlsUrl(LIBCURL_GNUTLS_BUILD.file), TAMPERED);
            await expect(buildLatestLibcurlGnutlsRecord(upstreamFetch)).rejects.toThrow(/sha256 differs from reviewed pin/);
            expect(buildLibcurlGnutlsRecord({ sha256: LIBCURL_GNUTLS_BUILD.sha256, size: 1 }).platforms["linux-x64"]?.sha256).toBe(LIBCURL_GNUTLS_BUILD.sha256);
        });

        test("Metamod:Source and SourceMod", async () => {
            for (const build of SOURCEMOD_BUILDS) for (const file of Object.values(build.files)) serve(file!.url, TAMPERED);
            await expect(buildLatestSourcemodRecords(upstreamFetch)).rejects.toThrow(/sha256 differs from reviewed pin/);
        });

        test("XNA and Visual C++ runtimes", async () => {
            for (const runtime of WINDOWS_RUNTIMES) serve(runtime.url, TAMPERED);
            await expect(buildWindowsRuntimeRecords(upstreamFetch)).rejects.toThrow(/sha256 differs from reviewed pin/);
        });
    });

    describe("GitHub digests are cross-checked against the release checksum file", () => {
        const OLLAMA_FILES = {
            "ollama-linux-amd64.tar.zst": "linux amd64",
            "ollama-linux-arm64.tar.zst": "linux arm64",
            "ollama-darwin.tgz": "darwin universal",
            "ollama-windows-amd64.zip": "windows amd64",
            "ollama-windows-arm64.zip": "windows arm64",
        };
        const OLLAMA_LATEST = "https://api.github.com/repos/ollama/ollama/releases/latest";

        function serveOllama(rel: GithubRelease, sumsText: string) {
            serve(OLLAMA_LATEST, rel);
            if (rel.assets.some((a) => a.name === "sha256sum.txt")) serve(assetUrl(rel, "sha256sum.txt"), sumsText);
        }

        test("ollama builds a record when GitHub and sha256sum.txt agree", async () => {
            const text = sums(OLLAMA_FILES);
            serveOllama(release("v0.9.2", { ...OLLAMA_FILES, "sha256sum.txt": text }), text);
            const record = await buildLatestOllamaRecord(upstreamFetch);
            expect(record.version).toBe("0.9.2");
            expect(Object.keys(record.platforms).sort()).toEqual([...PLATFORM_KEYS].sort());
            expect(record.platforms["linux-x64"]?.sha256).toBe(sha256("linux amd64"));
        });

        test("ollama refuses a disagreeing or missing checksum entry, a missing digest, and prereleases or drafts", async () => {
            const cases: [GithubRelease, string, RegExp][] = [
                [release("v0.9.2", { ...OLLAMA_FILES, "sha256sum.txt": "x" }), sums({ ...OLLAMA_FILES, "ollama-darwin.tgz": "other bytes" }), /disagrees with sha256sum.txt/],
                [release("v0.9.2", { ...OLLAMA_FILES, "sha256sum.txt": "x" }), sums(OLLAMA_FILES).split("\n").filter((l) => !l.includes("darwin")).join("\n"), /not in sha256sum.txt/],
                [release("v0.9.2", { ...OLLAMA_FILES, "ollama-darwin.tgz": null, "sha256sum.txt": "x" }), sums(OLLAMA_FILES), /has no sha256 digest/],
                [release("v0.9.2", { ...OLLAMA_FILES }), "", /sha256sum.txt missing/],
                [release("v1.0.0-rc1", { ...OLLAMA_FILES, "sha256sum.txt": "x" }, { prerelease: true }), sums(OLLAMA_FILES), /not a stable release/],
                [release("v0.9.3", { ...OLLAMA_FILES, "sha256sum.txt": "x" }, { draft: true }), sums(OLLAMA_FILES), /not a stable release/],
            ];
            for (const [rel, text, reason] of cases) {
                resetUpstream();
                serveOllama(rel, text);
                await expect(buildLatestOllamaRecord(upstreamFetch)).rejects.toThrow(reason);
            }
        });

        const OPENCODE_FILES = {
            "opencode-linux-x64-baseline.tar.gz": "linux x64",
            "opencode-linux-arm64.tar.gz": "linux arm64",
            "opencode-darwin-x64-baseline.zip": "mac x64",
            "opencode-darwin-arm64.zip": "mac arm64",
            "opencode-windows-x64-baseline.zip": "win x64",
            "opencode-windows-arm64.zip": "win arm64",
        };
        const OPENCODE_RELEASES = "https://api.github.com/repos/anomalyco/opencode/releases?per_page=30";

        test("opencode takes the newest stable 2.x release and checks it against SHA256SUMS", async () => {
            const text = sums(OPENCODE_FILES);
            const stable = release("v2.4.1", { ...OPENCODE_FILES, SHA256SUMS: text });
            serve(OPENCODE_RELEASES, [
                release("v2.5.0", { ...OPENCODE_FILES, SHA256SUMS: text }, { prerelease: true }),
                release("v2.6.0", { ...OPENCODE_FILES, SHA256SUMS: text }, { draft: true }),
                release("v1.19.5", { ...OPENCODE_FILES, SHA256SUMS: text }),
                stable,
                release("v2.3.9", { ...OPENCODE_FILES, SHA256SUMS: text }),
            ]);
            serve(assetUrl(stable, "SHA256SUMS"), text);
            const record = await buildLatestOpencodeRecord(upstreamFetch);
            expect(record.version).toBe("2.4.1");
            expect(record.platforms["windows-arm64"]?.sha256).toBe(sha256("win arm64"));
        });

        test("opencode refuses a disagreeing or missing SHA256SUMS entry", async () => {
            for (const [text, reason] of [
                [sums({ ...OPENCODE_FILES, "opencode-linux-arm64.tar.gz": "swapped" }), /disagrees with SHA256SUMS/],
                [sums(OPENCODE_FILES).split("\n").slice(1).join("\n"), /is not in SHA256SUMS/],
            ] as const) {
                resetUpstream();
                const rel = release("v2.4.1", { ...OPENCODE_FILES, SHA256SUMS: text });
                serve(OPENCODE_RELEASES, [rel]);
                serve(assetUrl(rel, "SHA256SUMS"), text);
                await expect(buildLatestOpencodeRecord(upstreamFetch)).rejects.toThrow(reason);
            }
            resetUpstream();
            serve(OPENCODE_RELEASES, [release("v2.5.0", OPENCODE_FILES, { prerelease: true })]);
            await expect(buildLatestOpencodeRecord(upstreamFetch)).rejects.toThrow(/no stable v2.x release/);
        });
    });

    describe("codex", () => {
        let work: string;
        let archive: Uint8Array;
        const CODEX_LATEST = "https://api.github.com/repos/openai/codex/releases/latest";
        const SUMS_FILE = "codex-package_SHA256SUMS";

        beforeAll(async () => {
            // a real codex-package archive holding every member any target takes
            work = await mkdtemp(path.join(tmpdir(), "origami-codex-test-"));
            const root = path.join(work, "pkg");
            for (const dir of ["bin", "codex-path", "codex-resources/voice"]) await mkdir(path.join(root, dir), { recursive: true });
            for (const file of [
                "bin/codex",
                "codex-package.json",
                "codex-path/rg",
                "codex-resources/bwrap",
                "codex-resources/codex-command-runner.exe",
                "codex-resources/codex-windows-sandbox-setup.exe",
                "codex-resources/voice/lib.so",
            ]) {
                await writeFile(path.join(root, file), file);
            }
            const tarball = path.join(work, "codex.tar.gz");
            const tar = Bun.spawnSync(["tar", "-czf", tarball, "-C", root, "."], { stderr: "pipe" });
            if (tar.exitCode !== 0) throw new Error(`tar failed: ${tar.stderr.toString()}`);
            archive = new Uint8Array(await readFile(tarball));
        });

        afterAll(async () => {
            await rm(work, { recursive: true, force: true });
        });

        function files(): Record<string, string> {
            return Object.fromEntries(Object.values(TARGETS).map((t) => [`codex-package-${t.triple}.tar.gz`, ""]));
        }

        function codexRelease(digests: Record<string, string>, extra: Partial<GithubRelease> = {}): GithubRelease {
            const rel = release("rust-v0.170.0", { ...files(), [SUMS_FILE]: "" }, extra);
            for (const asset of rel.assets) if (digests[asset.name]) asset.digest = `sha256:${digests[asset.name]}`;
            return rel;
        }

        function serveCodex(rel: GithubRelease, sumsText: string, bytes: Uint8Array) {
            serve(CODEX_LATEST, rel);
            serve(assetUrl(rel, SUMS_FILE), sumsText);
            for (const asset of rel.assets) if (asset.name !== SUMS_FILE) serve(asset.browser_download_url, bytes);
        }

        const digestsFor = (digest: string) => Object.fromEntries(Object.keys(files()).map((f) => [f, digest]));
        const sumsFor = (digests: Record<string, string>) => Object.entries(digests).map(([f, d]) => `${d}  ${f}`).join("\n");

        test("a release whose digests agree and whose downloaded bytes match builds a record", async () => {
            const digests = digestsFor(sha256(archive));
            serveCodex(codexRelease(digests), sumsFor(digests), archive);
            const record = await buildLatestCodexRecord(upstreamFetch);
            expect(record.version).toBe("0.170.0");
            expect(Object.keys(record.platforms).sort()).toEqual([...PLATFORM_KEYS].sort());
            expect(record.platforms["linux-x64"]?.recipe?.take["codex-resources/bwrap"]).toBe("codex-resources/bwrap");
        });

        test("a digest that disagrees with the checksum file, or bytes that differ from it, build no record", async () => {
            const digests = digestsFor(sha256(archive));
            serveCodex(codexRelease(digests), sumsFor({ ...digests, [Object.keys(digests)[0]!]: "0".repeat(64) }), archive);
            await expect(buildLatestCodexRecord(upstreamFetch)).rejects.toThrow(/digest disagrees with codex-package_SHA256SUMS/);
            // nothing was downloaded before the facts disagreed
            expect(requested.filter((u) => u.endsWith(".tar.gz"))).toEqual([]);

            resetUpstream();
            serveCodex(codexRelease(digests), sumsFor(digests), TAMPERED);
            await expect(buildLatestCodexRecord(upstreamFetch)).rejects.toThrow(/downloaded bytes hash to/);

            resetUpstream();
            serveCodex(codexRelease(digests, { prerelease: true }), sumsFor(digests), archive);
            await expect(buildLatestCodexRecord(upstreamFetch)).rejects.toThrow(/not a stable release/);
        });
    });

    describe(".NET must match Microsoft's SHA-512 from Microsoft's host", () => {
        const META = "https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json";

        function meta(version: string, host = "builds.dotnet.microsoft.com", hashOf: (rid: string) => string = (rid) => sha512(`runtime ${rid}`)) {
            return {
                "channel-version": "8.0",
                "latest-runtime": version,
                releases: [
                    {
                        "release-version": version,
                        runtime: {
                            version,
                            files: Object.values(RIDS).map((rid) => {
                                const ext = rid!.startsWith("win-") ? "zip" : "tar.gz";
                                return {
                                    name: `dotnet-runtime-${rid}.${ext}`,
                                    rid,
                                    url: `https://${host}/dotnet/Runtime/${version}/dotnet-runtime-${version}-${rid}.${ext}`,
                                    hash: hashOf(rid!),
                                };
                            }),
                        },
                    },
                ],
            };
        }

        function serveRuntimes(data: ReturnType<typeof meta>, bytesOf: (rid: string) => string = (rid) => `runtime ${rid}`) {
            serve(META, data);
            for (const file of data.releases[0]!.runtime.files) serve(file.url, bytesOf(file.rid!));
        }

        test("bytes matching Microsoft's SHA-512 build a record carrying their SHA-256", async () => {
            serveRuntimes(meta("8.0.22"));
            const record = await buildLatestDotnetRecord("8.0", upstreamFetch);
            expect(record).toMatchObject({ name: "dotnet-8", version: "8.0.22" });
            expect(record.platforms["linux-x64"]?.sha256).toBe(sha256("runtime linux-x64"));
        });

        test("bytes that differ from the SHA-512, or a download off Microsoft's host, build no record", async () => {
            serveRuntimes(meta("8.0.22"), (rid) => (rid === "osx-arm64" ? "tampered" : `runtime ${rid}`));
            await expect(buildLatestDotnetRecord("8.0", upstreamFetch)).rejects.toThrow(/SHA-512 differs/);

            resetUpstream();
            serveRuntimes(meta("8.0.22", "dotnet.evil.test"));
            await expect(buildLatestDotnetRecord("8.0", upstreamFetch)).rejects.toThrow(/unexpected .* download/);
            expect(requested.filter((u) => u.includes("evil.test"))).toEqual([]);

            resetUpstream();
            serveRuntimes(meta("8.0.22", undefined, () => "not-a-sha512"));
            await expect(buildLatestDotnetRecord("8.0", upstreamFetch)).rejects.toThrow(/has no SHA-512/);
        });
    });

    describe("Proton needs its .sha512sum, and prereleases and drafts are refused", () => {
        const PROTON_LATEST = "https://api.github.com/repos/GloriousEggroll/proton-ge-custom/releases/latest";
        const tag = "GE-Proton10-25";
        const archives = { [`${tag}-x86_64.tar.gz`]: "x86_64 build", [`${tag}-aarch64.tar.gz`]: "aarch64 build" };
        const sumFiles = Object.fromEntries(
            Object.entries(archives).map(([name, content]) => [name.replace(".tar.gz", ".sha512sum"), `${sha512(content)}  ${name}\n`]),
        );

        function serveProton(rel: GithubRelease) {
            serve(PROTON_LATEST, rel);
            for (const [name, text] of Object.entries(sumFiles)) if (rel.assets.some((a) => a.name === name)) serve(assetUrl(rel, name), text);
        }

        test("a stable release with both checksum files builds a record", async () => {
            serveProton(release(tag, { ...archives, ...sumFiles }));
            const record = await buildLatestProtonRecord(upstreamFetch);
            expect(record.version).toBe(tag);
            expect(record.platforms["linux-arm64"]?.sha256).toBe(sha256("aarch64 build"));
        });

        test("a missing checksum file, a prerelease or a draft builds no record", async () => {
            const { [`${tag}-aarch64.sha512sum`]: _dropped, ...oneSum } = sumFiles;
            serveProton(release(tag, { ...archives, ...oneSum }));
            await expect(buildLatestProtonRecord(upstreamFetch)).rejects.toThrow(/sha512sum missing/);
            for (const extra of [{ prerelease: true }, { draft: true }]) {
                resetUpstream();
                serveProton(release(tag, { ...archives, ...sumFiles }, extra));
                await expect(buildLatestProtonRecord(upstreamFetch)).rejects.toThrow(/not a stable release/);
                // refused from the release metadata alone: no checksum file was fetched
                expect(requested).toEqual([PROTON_LATEST]);
            }
        });
    });

    describe("Helium writes one version for every platform, or nothing", () => {
        const latest = (repo: HeliumRepo) => `https://api.github.com/repos/imputnet/${repo}/releases/latest`;
        const files = (repo: HeliumRepo, v: string): Record<string, string> =>
            repo === "helium-linux" ? { [`helium-${v}-x86_64_linux.tar.xz`]: "linux x64", [`helium-${v}-arm64_linux.tar.xz`]: "linux arm64" }
            : repo === "helium-macos" ? { [`helium_${v}_x86_64-macos.dmg`]: "macos x64", [`helium_${v}_arm64-macos.dmg`]: "macos arm64" }
            : { [`helium_${v}_x64-windows.zip`]: "windows x64", [`helium_${v}_arm64-windows.zip`]: "windows arm64" };
        function serveHelium(versions: Record<HeliumRepo, string>) {
            for (const repo of HELIUM_REPOS) serve(latest(repo), release(versions[repo], files(repo, versions[repo])));
        }

        test("all three repos on the same stable version build a record for every platform", async () => {
            serveHelium({ "helium-linux": "0.5.1.1", "helium-macos": "0.5.1.1", "helium-windows": "0.5.1.1" });
            const record = await buildLatestHeliumRecord(upstreamFetch);
            expect(record.version).toBe("0.5.1.1");
            expect(Object.keys(record.platforms).sort()).toEqual([...PLATFORM_KEYS].sort());
            expect(record.platforms["windows-arm64"]?.sha256).toBe(sha256("windows arm64"));
        });

        test("a repo on another version fails the whole record", async () => {
            serveHelium({ "helium-linux": "0.5.1.1", "helium-macos": "0.5.2.1", "helium-windows": "0.5.1.1" });
            await expect(buildLatestHeliumRecord(upstreamFetch)).rejects.toThrow(/different versions/);
        });
    });

    test("Java fails a feature release with a platform Adoptium gave no checksum, instead of dropping that platform", async () => {
        const asset = (os: string, checksum: string): AdoptiumAsset => ({
            release_name: "jdk-21.0.5+11",
            binary: { os, architecture: "x64", image_type: "jdk", jvm_impl: "hotspot", heap_size: "normal", package: { link: `https://github.com/adoptium/${os}.tar.gz`, checksum } },
        });
        const url = "https://api.adoptium.net/v3/assets/latest/21/hotspot?image_type=jdk";
        serve(url, [asset("linux", "a".repeat(64)), asset("windows", "not a checksum")]);
        expect(await buildJavaRecords([21], upstreamFetch)).toEqual([{ key: "java-21", error: "Adoptium gave windows-x64 no valid sha256" }]);
        serve(url, [asset("linux", "a".repeat(64)), asset("windows", "B".repeat(64))]);
        const [built] = await buildJavaRecords([21], upstreamFetch);
        expect(Object.keys(built!.record!.platforms).sort()).toEqual(["linux-x64", "windows-x64"]);
        expect(built!.record!.platforms["windows-x64"]!.sha256).toBe("b".repeat(64));
    });

    describe("antigravity", () => {
        let work: string;
        let unixTarball: Uint8Array;
        let missingMemberTarball: Uint8Array;
        const winExe = new TextEncoder().encode("MZ-fake-agy-exe");

        beforeAll(async () => {
            work = await mkdtemp(path.join(tmpdir(), "origami-agy-test-"));
            const goodDir = path.join(work, "good");
            const badDir = path.join(work, "bad");
            await mkdir(goodDir, { recursive: true });
            await mkdir(badDir, { recursive: true });
            await writeFile(path.join(goodDir, "antigravity"), "#!/bin/sh\n");
            await writeFile(path.join(badDir, "wrong-name"), "#!/bin/sh\n");
            const goodTar = path.join(work, "good.tar.gz");
            const badTar = path.join(work, "bad.tar.gz");
            for (const [out, dir, member] of [
                [goodTar, goodDir, "antigravity"],
                [badTar, badDir, "wrong-name"],
            ] as const) {
                const res = Bun.spawnSync(["tar", "-czf", out, "-C", dir, member], { stderr: "pipe" });
                if (res.exitCode !== 0) throw new Error(`tar failed: ${res.stderr.toString()}`);
            }
            unixTarball = new Uint8Array(await readFile(goodTar));
            missingMemberTarball = new Uint8Array(await readFile(badTar));
        });

        afterAll(async () => {
            await rm(work, { recursive: true, force: true });
        });

        function serveAntigravity(opts: {
            versionOf?: (key: (typeof PLATFORM_KEYS)[number]) => string;
            urlOf?: (key: (typeof PLATFORM_KEYS)[number]) => string;
            bytesOf?: (key: (typeof PLATFORM_KEYS)[number]) => Uint8Array;
            sha512Of?: (key: (typeof PLATFORM_KEYS)[number], bytes: Uint8Array) => string;
        } = {}) {
            for (const key of PLATFORM_KEYS) {
                const isWin = key.startsWith("windows-");
                const version = opts.versionOf ? opts.versionOf(key) : "1.5.14";
                const bytes = opts.bytesOf ? opts.bytesOf(key) : isWin ? winExe : unixTarball;
                const url = opts.urlOf
                    ? opts.urlOf(key)
                    : `https://storage.googleapis.com/antigravity-public/antigravity-cli/${version}/cli_${key}.${isWin ? "exe" : "tar.gz"}`;
                const digest = opts.sha512Of ? opts.sha512Of(key, bytes) : sha512(bytes);
                serve(`${ANTIGRAVITY_MANIFEST_BASE}/${ANTIGRAVITY_TARGETS[key].manifest}`, { version, url, sha512: digest });
                serve(url, bytes);
            }
        }

        test("all 6 manifests on the same version with matching SHA-512 build a record", async () => {
            serveAntigravity();
            const record = await buildLatestAntigravityRecord(upstreamFetch);
            expect(record.name).toBe("antigravity");
            expect(record.version).toBe("1.5.14");
            expect(Object.keys(record.platforms).sort()).toEqual([...PLATFORM_KEYS].sort());
            expect(record.platforms["linux-x64"]?.sha256).toBe(sha256(unixTarball));
            expect(record.platforms["linux-x64"]?.recipe).toEqual({ unpack: "tar", take: { "bin/agy": "antigravity" } });
            expect(record.platforms["windows-x64"]?.sha256).toBe(sha256(winExe));
            expect(record.platforms["windows-x64"]?.recipe).toEqual({ unpack: "file", take: { "bin/agy.exe": "file" } });
        });

        test("refuses SHA-512 mismatch, version skew, missing tarball member, or off-bucket URL", async () => {
            serveAntigravity({ sha512Of: (k, b) => (k === "macos-arm64" ? "0".repeat(128) : sha512(b)) });
            await expect(buildLatestAntigravityRecord(upstreamFetch)).rejects.toThrow(/SHA-512 differs/);

            resetUpstream();
            serveAntigravity({ versionOf: (k) => (k === "windows-arm64" ? "1.5.15" : "1.5.14") });
            await expect(buildLatestAntigravityRecord(upstreamFetch)).rejects.toThrow(/different versions/);

            resetUpstream();
            serveAntigravity({ bytesOf: (k) => (k === "linux-x64" ? missingMemberTarball : k.startsWith("windows-") ? winExe : unixTarball) });
            await expect(buildLatestAntigravityRecord(upstreamFetch)).rejects.toThrow(/antigravity is not in the archive/);

            resetUpstream();
            serveAntigravity({ urlOf: (k) => (k === "linux-x64" ? "https://evil.test/antigravity.tar.gz" : `https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.14/cli_${k}.bin`) });
            await expect(buildLatestAntigravityRecord(upstreamFetch)).rejects.toThrow(/unexpected download host/);
            expect(requested.filter((u) => u.includes("evil.test"))).toEqual([]);
        });
    });

});
