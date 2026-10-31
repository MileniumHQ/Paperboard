import { STEAMCMD_BUILDS, buildSteamcmdRecord, buildLatestSteamcmdRecord } from "../scripts/update-steamcmd";
import { RIDS, runtimeFiles, buildDotnetRecord, buildLatestDotnetRecord, type DotnetReleases } from "../scripts/update-dotnet";
import { buildProtonRecord, buildLatestProtonRecord } from "../scripts/update-proton";
import { buildOpencodeRecord, buildLatestOpencodeRecord, newestV2Release } from "../scripts/update-opencode";
import { TARGETS, buildCodexRecord, buildLatestCodexRecord, inspectArchive, type ArchiveListings } from "../scripts/update-codex";
import {
    CLAUDE_PLATFORM,
    SIGNING_FINGERPRINT,
    buildClaudeCodeRecord,
    buildLatestClaudeCodeRecord,
    gpgVerify,
    inspectTarball,
    type ClaudeCodeIo,
    type ClaudeManifest,
    type NpmPackument,
    type TarballFacts,
} from "../scripts/update-claude-code";
import { describe, it, expect } from "bun:test";
import {
    buildJavaRecord,
    buildJavaRecords,
    availableFeatures,
    type AdoptiumAsset,
} from "../scripts/update-java";
import {
    buildOllamaRecord,
    buildLatestOllamaRecord,
    parseSha256Sums,
    type GithubRelease,
} from "../scripts/update-ollama";
import { buildHeliumRecord, buildLatestHeliumRecord, REPOS, type HeliumRepo } from "../scripts/update-helium";
import { recipeDigest } from "../../paperboard/papercrane/packageRecipe";
import { assertValidRecord, PLATFORM_KEYS, type PlatformKey } from "../scripts/lib/records";
import { writeRecords } from "../scripts/lib/cli";
import { putRecord, wranglerPutArgs } from "../scripts/lib/kv";
import type { PackageRecord } from "../scripts/lib/records";
import * as crypto from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { releaseMessage, verifyRelease } from "../../paperboard/papercrane/releaseSignature";

// a throwaway release key: writes are signed with it and checked against it
const keys = crypto.generateKeyPairSync("ed25519");
const PUBLIC = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

const sha = (c: string) => c.repeat(64);

function jdk(os: string, arch: string, checksum: string | undefined, extra: Partial<NonNullable<AdoptiumAsset["binary"]>> = {}): AdoptiumAsset {
    return {
        release_name: "jdk-21.0.8+9",
        binary: {
            os,
            architecture: arch,
            image_type: "jdk",
            jvm_impl: "hotspot",
            heap_size: "normal",
            package: { link: `https://github.com/adoptium/x/${os}-${arch}.tar.gz`, checksum, size: 10 },
            ...extra,
        },
    };
}

describe("update-java", () => {
    it("maps Adoptium platforms and keeps only checksummed JDKs", () => {
        const record = buildJavaRecord(21, [
            jdk("linux", "x64", sha("a")),
            jdk("linux", "aarch64", undefined),
            jdk("mac", "aarch64", sha("b")),
            jdk("windows", "x64", sha("c"), { image_type: "jre" }),
            jdk("alpine-linux", "x64", sha("d")),
        ]);
        expect(record.name).toBe("java-21");
        expect(record.version).toBe("21.0.8+9");
        expect(Object.keys(record.platforms).sort()).toEqual(["linux-x64", "macos-arm64"]);
        expect(record.platforms["linux-x64"]?.sha256).toBe(sha("a"));
    });

    it("refuses a release with no installable platform", () => {
        expect(() => buildJavaRecord(21, [jdk("linux", "x64", "nope")])).toThrow(/no platforms/);
    });

    it("fails loudly when available_releases is missing instead of guessing a list", async () => {
        const fetchFn = (async () => Response.json({})) as unknown as typeof fetch;
        await expect(availableFeatures(fetchFn)).rejects.toThrow(/missing or malformed/);
    });

    it("reports a per-feature failure without dropping the others", async () => {
        const fetchFn = (async (url: string) =>
            String(url).includes("/latest/17/")
                ? new Response("boom", { status: 500 })
                : Response.json([jdk("linux", "x64", sha("e"))])) as unknown as typeof fetch;
        const built = await buildJavaRecords([17, 21], fetchFn);
        expect(built[0]!.error).toMatch(/500/);
        expect(built[1]!.record?.name).toBe("java-21");
    });
});

const OLLAMA_FILES = [
    "ollama-linux-amd64.tar.zst",
    "ollama-linux-arm64.tar.zst",
    "ollama-darwin.tgz",
    "ollama-windows-amd64.zip",
    "ollama-windows-arm64.zip",
    "ollama-linux-amd64-rocm.tar.zst",
];

function release(overrides: Partial<GithubRelease> = {}, digestFor = (i: number) => `sha256:${sha(String(i))}`): GithubRelease {
    return {
        tag_name: "v0.34.4",
        assets: [
            ...OLLAMA_FILES.map((name, i) => ({
                name,
                size: 100 + i,
                digest: digestFor(i),
                browser_download_url: `https://github.com/ollama/ollama/releases/download/v0.34.4/${name}`,
            })),
            { name: "sha256sum.txt", browser_download_url: "https://github.com/ollama/ollama/releases/download/v0.34.4/sha256sum.txt" },
        ],
        ...overrides,
    };
}

const sums = OLLAMA_FILES.map((name, i) => `${sha(String(i))}  ./${name}`).join("\n");

describe("update-ollama", () => {
    it("parses sha256sum.txt with ./ prefixes", () => {
        expect(parseSha256Sums(`${sha("f")}  ./ollama-darwin.tgz\n`).get("ollama-darwin.tgz")).toBe(sha("f"));
    });

    it("builds one record covering every platform with its archive layout", () => {
        const record = buildOllamaRecord(release(), sums);
        expect(record).toMatchObject({ name: "ollama", version: "0.34.4" });
        expect(record.platforms["linux-x64"]).toMatchObject({ layout: "root", sha256: sha("0") });
        expect(record.platforms["linux-arm64"]).toMatchObject({ layout: "root", sha256: sha("1") });
        // the darwin build is universal: both mac keys point at it
        expect(record.platforms["macos-x64"]?.url).toBe(record.platforms["macos-arm64"]!.url);
        expect(record.platforms["macos-arm64"]).toMatchObject({ layout: "bin", sha256: sha("2") });
        expect(record.platforms["windows-x64"]).toMatchObject({ layout: "bin", sha256: sha("3") });
        // GPU add-ons are not the base package
        expect(JSON.stringify(record)).not.toContain("rocm");
    });

    it("refuses when GitHub's digest and sha256sum.txt disagree", () => {
        const lying = sums.replace(sha("3"), sha("9"));
        expect(() => buildOllamaRecord(release(), lying)).toThrow(/disagrees/);
    });

    it("refuses an asset without a digest instead of publishing a partial record", () => {
        const r = release({}, (i) => (i === 4 ? null : `sha256:${sha(String(i))}`) as string);
        expect(() => buildOllamaRecord(r, sums)).toThrow(/windows-arm64.zip has no sha256/);
    });

    it("refuses prereleases and odd tags", () => {
        expect(() => buildOllamaRecord(release({ prerelease: true }), sums)).toThrow(/not a stable/);
        expect(() => buildOllamaRecord(release({ tag_name: "v0.40.0-rc0" }), sums)).toThrow(/unexpected release tag/);
    });

    it("fetches the latest release and its checksum file", async () => {
        const fetchFn = (async (url: string) =>
            String(url).endsWith("sha256sum.txt") ? new Response(sums) : Response.json(release())) as unknown as typeof fetch;
        expect((await buildLatestOllamaRecord(fetchFn)).version).toBe("0.34.4");
    });
});

function heliumReleases(tags: Partial<Record<HeliumRepo, string>> = {}, drop?: string): Record<HeliumRepo, GithubRelease> {
    const v = (repo: HeliumRepo) => tags[repo] ?? "0.20.1.1";
    const asset = (name: string, i: number) => ({
        name,
        size: 100 + i,
        digest: name === drop ? null : `sha256:${sha(String(i))}`,
        browser_download_url: `https://github.com/imputnet/x/releases/download/v/${name}`,
    });
    return {
        "helium-linux": {
            tag_name: v("helium-linux"),
            assets: [`helium-${v("helium-linux")}-x86_64_linux.tar.xz`, `helium-${v("helium-linux")}-arm64_linux.tar.xz`, "helium-0.20.1.1-x86_64.AppImage"].map(asset),
        },
        "helium-macos": {
            tag_name: v("helium-macos"),
            assets: [`helium_${v("helium-macos")}_x86_64-macos.dmg`, `helium_${v("helium-macos")}_arm64-macos.dmg`].map((n, i) => asset(n, i + 3)),
        },
        "helium-windows": {
            tag_name: v("helium-windows"),
            assets: [`helium_${v("helium-windows")}_x64-windows.zip`, `helium_${v("helium-windows")}_arm64-windows.zip`].map((n, i) => asset(n, i + 5)),
        },
    };
}

describe("update-helium", () => {
    it("points every platform at imputnet's own asset with the recipe that unpacks it", () => {
        const record = buildHeliumRecord(heliumReleases());
        expect(record).toMatchObject({ name: "helium", version: "0.20.1.1" });
        expect(record.platforms["linux-x64"]).toMatchObject({
            url: expect.stringContaining("helium-0.20.1.1-x86_64_linux.tar.xz"),
            sha256: sha("0"),
            recipe: { unpack: "tar.xz", take: { bin: "helium-0.20.1.1-x86_64_linux" } },
        });
        expect(record.platforms["macos-arm64"]).toMatchObject({
            url: expect.stringContaining("helium_0.20.1.1_arm64-macos.dmg"),
            recipe: { unpack: "dmg", take: { "bin/Helium.app": "Helium.app" } },
        });
        expect(record.platforms["windows-arm64"]).toMatchObject({
            recipe: { unpack: "zip", take: { bin: "helium_0.20.1.1_arm64-windows" } },
        });
        // an AppImage is not what a package installs
        expect(JSON.stringify(record)).not.toContain("AppImage");
        for (const dl of Object.values(record.platforms)) expect(dl!.layout).toBeUndefined();
    });

    it("writes nothing while the platform repos are on different versions", () => {
        expect(() => buildHeliumRecord(heliumReleases({ "helium-macos": "0.20.2.1" }))).toThrow(/different versions/);
    });

    it("refuses an asset without a digest instead of publishing a partial record", () => {
        expect(() => buildHeliumRecord(heliumReleases({}, "helium_0.20.1.1_x64-windows.zip"))).toThrow(/x64-windows.zip has no sha256/);
    });

    it("refuses prereleases", () => {
        const releases = heliumReleases();
        releases["helium-linux"].prerelease = true;
        expect(() => buildHeliumRecord(releases)).toThrow(/not a stable/);
    });

    it("fetches the latest release of each repo", async () => {
        const all = heliumReleases();
        const fetchFn = (async (url: string) => {
            const repo = REPOS.find((r) => String(url).includes(`/${r}/`))!;
            return Response.json(all[repo]);
        }) as unknown as typeof fetch;
        expect((await buildLatestHeliumRecord(fetchFn)).version).toBe("0.20.1.1");
    });
});

describe("package recipes in records", () => {
    const base: PackageRecord = {
        name: "helium",
        version: "1.0.0",
        platforms: { "linux-x64": { url: "https://x.test/a.tar.xz", sha256: sha("a"), recipe: { unpack: "tar.xz", take: { bin: "a" } } } },
    };

    it("refuses a recipe that climbs out of the package, or one beside a layout", () => {
        const climbing = { ...base, platforms: { "linux-x64": { ...base.platforms["linux-x64"]!, recipe: { unpack: "zip" as const, take: { bin: "../.." } } } } };
        expect(() => assertValidRecord(climbing)).toThrow(/linux-x64: .*plain relative path/);
        const both = { ...base, platforms: { "linux-x64": { ...base.platforms["linux-x64"]!, layout: "bin" as const } } };
        expect(() => assertValidRecord(both)).toThrow(/declare one or the other/);
    });

    it("signs the recipe with the archive, so other steps do not verify", async () => {
        let written: PackageRecord | null = null;
        await putRecord(base, keys.privateKey, async (_command, args) => {
            written = JSON.parse(args[5]!);
            return { stdout: "", stderr: "" };
        }, PUBLIC);
        const entry = written!.platforms["linux-x64"]!;
        const signed = releaseMessage.package("helium", "1.0.0", "linux-x64", entry.sha256, recipeDigest(entry.recipe!));
        expect(verifyRelease(signed, entry.signature, PUBLIC)).toBe(true);
        expect(verifyRelease(releaseMessage.package("helium", "1.0.0", "linux-x64", entry.sha256), entry.signature, PUBLIC)).toBe(false);
    });
});

describe("KV writer", () => {
    const record: PackageRecord = {
        name: "ollama",
        version: "1.0.0",
        platforms: { "linux-x64": { url: "https://x.test/a.tar.zst", sha256: sha("a"), layout: "root" } },
    };

    it("spawns wrangler with an argv array against the remote PACKAGES binding, every platform signed", async () => {
        const calls: { command: string; args: string[] }[] = [];
        await putRecord(record, keys.privateKey, async (command, args) => {
            calls.push({ command, args });
            return { stdout: "", stderr: "" };
        }, PUBLIC);
        expect(calls).toHaveLength(1);
        expect(calls[0]!.command).toBe("bunx");
        const written = JSON.parse(calls[0]!.args[5]!) as PackageRecord;
        expect(calls[0]!.args).toEqual(wranglerPutArgs("ollama", JSON.stringify(written, null, 2)));
        expect(calls[0]!.args).toContain("--remote");
        const entry = written.platforms["linux-x64"]!;
        expect(verifyRelease(releaseMessage.package("ollama", "1.0.0", "linux-x64", entry.sha256), entry.signature, PUBLIC)).toBe(true);
    });

    it("refuses to write with a key clients would not accept", async () => {
        let ran = false;
        const other = crypto.generateKeyPairSync("ed25519").privateKey;
        await expect(
            putRecord(record, other, async () => {
                ran = true;
                return { stdout: "", stderr: "" };
            }, PUBLIC),
        ).rejects.toThrow(/does not match/);
        expect(ran).toBe(false);
    });

    it("never writes an invalid record", async () => {
        let ran = false;
        const bad = { ...record, platforms: { "linux-x64": { url: "http://x.test/a", sha256: sha("a") } } };
        await expect(
            putRecord(bad, keys.privateKey, async () => {
                ran = true;
                return { stdout: "", stderr: "" };
            }, PUBLIC),
        ).rejects.toThrow(/https/);
        expect(ran).toBe(false);
    });

    it("reports write failures instead of claiming success", async () => {
        const outcome = await writeRecords([{ key: "ollama", record }, { key: "java-8", error: "no assets" }], {
            dryRun: false,
            key: keys.privateKey,
            publicKey: PUBLIC,
            run: async () => {
                throw new Error("not logged in");
            },
        });
        expect(outcome.written).toEqual([]);
        expect(outcome.errors).toEqual({ ollama: "not logged in", "java-8": "no assets" });
    });
});

// SteamCMD pins are immutable upstream facts, not values supplied by fetch.
// The pure builder tests the observed digest boundary; the fetch test proves
// bytes are hashed rather than trusting any response metadata.
describe("update-steamcmd", () => {
    const observed = () => Object.fromEntries(Object.entries(STEAMCMD_BUILDS).map(([key, build]) => [key, { sha256: build.sha256, size: 10 }]));
    it("builds the three x64 recipes with reviewed pins", () => {
        const record = buildSteamcmdRecord(observed());
        assertValidRecord(record);
        expect(record.version).toBe("2020.04.02");
        expect(Object.keys(record.platforms)).toEqual(["linux-x64", "macos-x64", "windows-x64"]);
        expect(record.platforms["linux-x64"]?.recipe).toEqual({ unpack: "tar", take: { "bin/steamcmd.sh": "steamcmd.sh", "bin/linux32": "linux32" } });
        expect(record.platforms["macos-x64"]?.recipe?.take["bin/Frameworks"]).toBe("Frameworks");
        expect(record.platforms["windows-x64"]?.recipe).toEqual({ unpack: "zip", take: { "bin/steamcmd.exe": "steamcmd.exe" } });
    });
    it("refuses changed or missing downloads", () => {
        expect(() => buildSteamcmdRecord({ ...observed(), "linux-x64": { sha256: sha("0"), size: 10 } })).toThrow(/reviewed pin/);
        expect(() => buildSteamcmdRecord({})).toThrow(/download missing/);
    });
    it("hashes fetched bytes and refuses HTTP errors", async () => {
        await expect(buildLatestSteamcmdRecord((async () => new Response("changed")) as unknown as typeof fetch)).rejects.toThrow(/reviewed pin/);
        await expect(buildLatestSteamcmdRecord((async () => new Response("missing", { status: 404 })) as unknown as typeof fetch)).rejects.toThrow(/404/);
    });
});

// .NET archives are checked against Microsoft's SHA-512 before their SHA-256
// is recorded; the fetch test proves the bytes are hashed, not the metadata trusted.
describe("update-dotnet", () => {
    const version = "8.0.33";
    const body = (rid: string) => `runtime ${rid}`;
    const sha512 = (text: string) => crypto.createHash("sha512").update(text).digest("hex");
    const meta = (): DotnetReleases => ({
        "channel-version": "8.0",
        "latest-runtime": version,
        releases: [{
            "release-version": version,
            runtime: {
                version,
                files: Object.values(RIDS).map((rid) => {
                    const ext = rid!.startsWith("win-") ? "zip" : "tar.gz";
                    return { name: `dotnet-runtime-${rid}.${ext}`, rid, url: `https://builds.dotnet.microsoft.com/dotnet/Runtime/${version}/dotnet-runtime-${version}-${rid}.${ext}`, hash: sha512(body(rid!)) };
                }),
            },
        }],
    });
    const fetchFrom = (bytes: (url: string) => string, metadata = meta()) =>
        (async (input: string | URL) => {
            const url = String(input);
            if (url.endsWith("/releases.json")) return Response.json(metadata);
            return new Response(bytes(url));
        }) as unknown as typeof fetch;
    const ridOf = (url: string) => /dotnet-runtime-[\d.]+-(.+)\.(?:tar\.gz|zip)$/.exec(url)![1]!;

    it("records verified archives with the host, fxr and shared framework under bin/", async () => {
        const record = await buildLatestDotnetRecord("8.0", fetchFrom((url) => body(ridOf(url))));
        assertValidRecord(record);
        expect(record.name).toBe("dotnet-8");
        expect(record.version).toBe(version);
        expect(Object.keys(record.platforms).sort()).toEqual(["linux-arm64", "linux-x64", "macos-arm64", "macos-x64", "windows-x64"]);
        const linux = record.platforms["linux-x64"]!;
        expect(linux.sha256).toBe(crypto.createHash("sha256").update(body("linux-x64")).digest("hex"));
        expect(linux.recipe).toEqual({ unpack: "tar", take: { "bin/dotnet": "dotnet", "bin/host": "host", "bin/shared": "shared", "LICENSE.txt": "LICENSE.txt", "ThirdPartyNotices.txt": "ThirdPartyNotices.txt" } });
        expect(record.platforms["windows-x64"]!.recipe!.take["bin/dotnet.exe"]).toBe("dotnet.exe");
        expect(record.platforms["windows-x64"]!.recipe!.unpack).toBe("zip");
    });
    it("refuses bytes that do not match Microsoft's SHA-512", async () => {
        await expect(buildLatestDotnetRecord("8.0", fetchFrom(() => "tampered"))).rejects.toThrow(/SHA-512 differs/);
    });
    it("refuses missing platforms, foreign hosts and other channels", () => {
        const missing = meta();
        missing.releases[0]!.runtime!.files = missing.releases[0]!.runtime!.files.filter((f) => f.rid !== "osx-arm64");
        expect(() => runtimeFiles(missing)).toThrow(/no osx-arm64 runtime archive/);
        const foreign = meta();
        foreign.releases[0]!.runtime!.files[0]!.url = "https://example.com/dotnet-runtime-8.0.33-linux-x64.tar.gz";
        expect(() => runtimeFiles(foreign)).toThrow(/unexpected/);
        expect(() => buildDotnetRecord("8.0", version, runtimeFiles(meta()).files, {})).toThrow(/download missing/);
    });
    it("refuses metadata for another channel and HTTP errors", async () => {
        await expect(buildLatestDotnetRecord("8.0", fetchFrom(() => "", { ...meta(), "channel-version": "9.0" }))).rejects.toThrow(/metadata is for 9.0/);
        await expect(buildLatestDotnetRecord("8.0", (async () => new Response("gone", { status: 404 })) as unknown as typeof fetch)).rejects.toThrow(/404/);
    });
});

function protonRelease(): GithubRelease {
    const tag = "GE-Proton11-11";
    return { tag_name: tag, assets: ["x86_64", "aarch64"].flatMap((arch) => ["tar.gz", "sha512sum"].map((suffix) => ({ name: `${tag}-${arch}.${suffix}`, digest: `sha256:${sha("a")}`, size: 100, browser_download_url: `https://github.com/GloriousEggroll/proton-ge-custom/releases/download/${tag}/${tag}-${arch}.${suffix}` }))) };
}
const protonSums = Object.fromEntries(["x86_64", "aarch64"].map((arch) => [`GE-Proton11-11-${arch}.sha512sum`, `${"b".repeat(128)}  GE-Proton11-11-${arch}.tar.gz\n`]));

describe("update-proton", () => {
    it("builds validated Linux recipes for both architectures", () => {
        const record = buildProtonRecord(protonRelease(), protonSums);
        assertValidRecord(record);
        expect(record.version).toBe("GE-Proton11-11");
        expect(Object.keys(record.platforms)).toEqual(["linux-x64", "linux-arm64"]);
        for (const [key, arch] of [["linux-x64", "x86_64"], ["linux-arm64", "aarch64"]] as const) expect(record.platforms[key]?.recipe).toEqual({ unpack: "tar", take: { bin: `GE-Proton11-11-${arch}` } });
    });
    it("refuses missing archives, digests, and checksum companions", () => {
        for (const suffix of ["tar.gz", "sha512sum"]) {
            const r = protonRelease(); r.assets = r.assets.filter((a) => a.name !== `GE-Proton11-11-aarch64.${suffix}`);
            expect(() => buildProtonRecord(r, protonSums)).toThrow(/missing/);
        }
        const r = protonRelease(); r.assets[0]!.digest = null;
        expect(() => buildProtonRecord(r, protonSums)).toThrow(/no sha256/);
        expect(() => buildProtonRecord(protonRelease(), {})).toThrow(/malformed checksum/);
        expect(() => buildProtonRecord(protonRelease(), Object.fromEntries(Object.entries(protonSums).map(([k,v]) => [k, v.replace("tar.gz", "wrong.tar.gz")])))).toThrow(/malformed checksum/);
    });
    it("refuses prereleases, drafts, and unexpected tags", () => {
        for (const change of [{ prerelease: true }, { draft: true }, { tag_name: "GE-Proton11-11-rc1" }]) expect(() => buildProtonRecord({ ...protonRelease(), ...change }, protonSums)).toThrow();
    });
    it("fetches metadata and checksum files, never archives", async () => {
        const calls: string[] = [];
        const fetchFn = (async (url: string) => {
            calls.push(String(url));
            if (String(url).endsWith("/latest")) return Response.json(protonRelease());
            const name = String(url).split("/").pop()!;
            if (!(name in protonSums)) throw new Error(`unexpected fetch ${url}`);
            return new Response(protonSums[name]);
        }) as unknown as typeof fetch;
        expect((await buildLatestProtonRecord(fetchFn)).name).toBe("proton");
        expect(calls).toHaveLength(3);
    });
});

function opencodeRelease(tag = "v2.2.5", overrides: Partial<GithubRelease> = {}, digestFor = (i: number) => `sha256:${sha(String(i))}`): GithubRelease {
    const files = [
        "opencode-linux-x64-baseline.tar.gz",
        "opencode-linux-arm64.tar.gz",
        "opencode-darwin-x64-baseline.zip",
        "opencode-darwin-arm64.zip",
        "opencode-windows-x64-baseline.zip",
        "opencode-windows-arm64.zip",
        // builds that must never be picked
        "opencode-linux-x64.tar.gz",
        "opencode-linux-x64-musl.tar.gz",
        "opencode-linux-arm64-musl.tar.gz",
        "opencode-desktop-linux-amd64.deb",
    ];
    return {
        tag_name: tag,
        assets: [
            ...files.map((name, i) => ({
                name,
                size: 100 + i,
                digest: i < 6 ? digestFor(i) : `sha256:${sha("f")}`,
                browser_download_url: `https://github.com/anomalyco/opencode/releases/download/${tag}/${name}`,
            })),
            { name: "SHA256SUMS", browser_download_url: `https://github.com/anomalyco/opencode/releases/download/${tag}/SHA256SUMS` },
        ],
        ...overrides,
    };
}
const opencodeSums = [
    "opencode-linux-x64-baseline.tar.gz",
    "opencode-linux-arm64.tar.gz",
    "opencode-darwin-x64-baseline.zip",
    "opencode-darwin-arm64.zip",
    "opencode-windows-x64-baseline.zip",
    "opencode-windows-arm64.zip",
]
    .map((name, i) => `${sha(String(i))}  ${name}`)
    .join("\n");

describe("update-opencode", () => {
    it("takes the baseline x64 and glibc builds, each archive root being bin/", () => {
        const record = buildOpencodeRecord(opencodeRelease(), opencodeSums);
        assertValidRecord(record);
        expect(record).toMatchObject({ name: "opencode", version: "2.2.5" });
        expect(Object.keys(record.platforms)).toEqual([...PLATFORM_KEYS]);
        expect(record.platforms["linux-x64"]).toMatchObject({ layout: "bin", sha256: sha("0"), url: expect.stringContaining("opencode-linux-x64-baseline.tar.gz") });
        expect(record.platforms["macos-x64"]?.url).toContain("opencode-darwin-x64-baseline.zip");
        expect(record.platforms["windows-x64"]?.url).toContain("opencode-windows-x64-baseline.zip");
        expect(record.platforms["windows-arm64"]).toMatchObject({ layout: "bin", sha256: sha("5") });
        expect(JSON.stringify(record)).not.toContain("musl");
        expect(JSON.stringify(record)).not.toContain("desktop");
    });

    it("refuses when GitHub's digest and SHA256SUMS disagree, or the file is not listed", () => {
        expect(() => buildOpencodeRecord(opencodeRelease(), opencodeSums.replace(sha("3"), sha("9")))).toThrow(/darwin-arm64.zip digest disagrees/);
        expect(() => buildOpencodeRecord(opencodeRelease(), opencodeSums.split("\n").slice(1).join("\n"))).toThrow(/linux-x64-baseline.tar.gz is not in SHA256SUMS/);
    });

    it("refuses an asset without a digest or a missing asset instead of publishing a partial record", () => {
        const noDigest = opencodeRelease("v2.2.5", {}, (i) => (i === 4 ? null : `sha256:${sha(String(i))}`) as string);
        expect(() => buildOpencodeRecord(noDigest, opencodeSums)).toThrow(/windows-x64-baseline.zip has no sha256/);
        const missing = opencodeRelease();
        missing.assets = missing.assets.filter((a) => a.name !== "opencode-linux-arm64.tar.gz");
        expect(() => buildOpencodeRecord(missing, opencodeSums)).toThrow(/opencode-linux-arm64.tar.gz missing/);
    });

    it("refuses prereleases, drafts, and tags outside the 2.x line", () => {
        expect(() => buildOpencodeRecord(opencodeRelease("v2.2.5", { prerelease: true }), opencodeSums)).toThrow(/not a stable/);
        expect(() => buildOpencodeRecord(opencodeRelease("v2.2.5", { draft: true }), opencodeSums)).toThrow(/not a stable/);
        for (const tag of ["v1.19.5", "v2.3.0-beta.1", "process-daemon-v0.4.0", "v3.0.0"]) {
            expect(() => buildOpencodeRecord(opencodeRelease(tag), opencodeSums)).toThrow(/unexpected release tag/);
        }
    });

    it("picks the newest stable v2.x release, whatever GitHub's latest or the list order says", () => {
        const pick = newestV2Release([
            opencodeRelease("process-daemon-v0.4.0"),
            opencodeRelease("v2.10.0", { prerelease: true }),
            opencodeRelease("v2.9.0", { draft: true }),
            opencodeRelease("v2.3.9"),
            opencodeRelease("v2.10.1"),
            opencodeRelease("v1.19.5"),
            opencodeRelease("v2.4.0"),
        ]);
        expect(pick.tag_name).toBe("v2.10.1");
        expect(() => newestV2Release([opencodeRelease("v1.19.5")])).toThrow(/no stable v2.x release/);
    });

    it("lists releases, picks the 2.x one and fetches its checksum file", async () => {
        const calls: string[] = [];
        const fetchFn = (async (url: string) => {
            calls.push(String(url));
            return String(url).endsWith("SHA256SUMS") ? new Response(opencodeSums) : Response.json([opencodeRelease("v1.19.5"), opencodeRelease("v2.2.5")]);
        }) as unknown as typeof fetch;
        expect((await buildLatestOpencodeRecord(fetchFn)).version).toBe("2.2.5");
        expect(calls[0]).toContain("/releases?per_page=30");
        expect(calls[1]).toContain("/v2.2.5/SHA256SUMS");
        const noSums = (async () => Response.json([{ ...opencodeRelease("v2.2.5"), assets: [] }])) as unknown as typeof fetch;
        await expect(buildLatestOpencodeRecord(noSums)).rejects.toThrow(/SHA256SUMS missing/);
    });
});

const CODEX_TAG = "rust-v0.166.0";
const codexFile = (key: PlatformKey) => `codex-package-${TARGETS[key].triple}.tar.gz`;
function codexRelease(overrides: Partial<GithubRelease> = {}, digestFor = (i: number) => `sha256:${sha(String(i))}`): GithubRelease {
    return {
        tag_name: CODEX_TAG,
        assets: [
            ...PLATFORM_KEYS.map((key, i) => ({
                name: codexFile(key),
                size: 100 + i,
                digest: digestFor(i),
                browser_download_url: `https://github.com/openai/codex/releases/download/${CODEX_TAG}/${codexFile(key)}`,
            })),
            // the same package in a format SHA256SUMS does not list
            { name: "codex-package-x86_64-unknown-linux-musl.tar.zst", digest: `sha256:${sha("e")}`, browser_download_url: "https://github.com/openai/codex/releases/download/x.tar.zst" },
            { name: "codex-package_SHA256SUMS", browser_download_url: `https://github.com/openai/codex/releases/download/${CODEX_TAG}/codex-package_SHA256SUMS` },
        ],
        ...overrides,
    };
}
const codexSums = PLATFORM_KEYS.map((key, i) => `${sha(String(i))}  ${codexFile(key)}`).join("\n");

// what each real 0.166.0 archive holds, listed with tar -t
function codexListings(): ArchiveListings {
    const exe = (key: PlatformKey) => (key.startsWith("windows-") ? ".exe" : "");
    return Object.fromEntries(
        PLATFORM_KEYS.map((key) => {
            const e = exe(key);
            const members = [
                "bin/", `bin/codex${e}`, `bin/codex-code-mode-host${e}`, `bin/codex-exec-server${e}`, "codex-package.json",
                "codex-path/", `codex-path/rg${e}`, "codex-resources/", "codex-resources/voice/", "codex-resources/voice/NOTICE.md", `codex-resources/voice/bin/codex-voice-host${e}`,
            ];
            if (key.startsWith("linux-")) members.push("codex-resources/bwrap");
            if (key.startsWith("windows-")) members.push("codex-resources/codex-command-runner.exe", "codex-resources/codex-windows-sandbox-setup.exe");
            return [key, members];
        }),
    ) as ArchiveListings;
}

describe("update-codex", () => {
    it("takes the package without voice/, plus the sandbox helpers that exist for each OS", () => {
        const record = buildCodexRecord(codexRelease(), codexSums, codexListings());
        assertValidRecord(record);
        expect(record).toMatchObject({ name: "codex", version: "0.166.0" });
        expect(Object.keys(record.platforms)).toEqual([...PLATFORM_KEYS]);
        expect(record.platforms["linux-x64"]).toMatchObject({
            url: expect.stringContaining("codex-package-x86_64-unknown-linux-musl.tar.gz"),
            sha256: sha("0"),
            recipe: { unpack: "tar", take: { bin: "bin", "codex-package.json": "codex-package.json", "codex-path": "codex-path", "codex-resources/bwrap": "codex-resources/bwrap" } },
        });
        // macOS has nothing in codex-resources besides voice/
        expect(record.platforms["macos-arm64"]?.recipe?.take).toEqual({ bin: "bin", "codex-package.json": "codex-package.json", "codex-path": "codex-path" });
        expect(Object.keys(record.platforms["windows-arm64"]!.recipe!.take).sort()).toEqual([
            "bin", "codex-package.json", "codex-path", "codex-resources/codex-command-runner.exe", "codex-resources/codex-windows-sandbox-setup.exe",
        ]);
        expect(JSON.stringify(record)).not.toContain("voice");
        expect(JSON.stringify(record)).not.toContain(".zst");
        for (const dl of Object.values(record.platforms)) expect(dl!.layout).toBeUndefined();
    });

    it("refuses a take source that is missing from the archive's listing", () => {
        const listings = codexListings();
        listings["linux-arm64"] = listings["linux-arm64"].filter((p) => p !== "codex-resources/bwrap");
        expect(() => buildCodexRecord(codexRelease(), codexSums, listings)).toThrow(/aarch64-unknown-linux-musl.tar.gz: codex-resources\/bwrap is not in the archive/);
        const noExe = codexListings();
        noExe["windows-x64"] = noExe["windows-x64"].filter((p) => !p.startsWith("bin/"));
        expect(() => buildCodexRecord(codexRelease(), codexSums, noExe)).toThrow(/bin is not in the archive/);
        const empty = codexListings();
        empty["macos-x64"] = [];
        expect(() => buildCodexRecord(codexRelease(), codexSums, empty)).toThrow(/no archive listing/);
    });

    it("refuses when GitHub's digest and codex-package_SHA256SUMS disagree, or either is missing", () => {
        expect(() => buildCodexRecord(codexRelease(), codexSums.replace(sha("2"), sha("9")), codexListings())).toThrow(/digest disagrees/);
        expect(() => buildCodexRecord(codexRelease(), codexSums.split("\n").slice(1).join("\n"), codexListings())).toThrow(/is not in codex-package_SHA256SUMS/);
        const r = codexRelease({}, (i) => (i === 3 ? null : `sha256:${sha(String(i))}`) as string);
        expect(() => buildCodexRecord(r, codexSums, codexListings())).toThrow(/aarch64-apple-darwin.tar.gz has no sha256/);
    });

    it("refuses prereleases, drafts and tags that are not rust-vX.Y.Z", () => {
        expect(() => buildCodexRecord(codexRelease({ prerelease: true }), codexSums, codexListings())).toThrow(/not a stable/);
        expect(() => buildCodexRecord(codexRelease({ draft: true }), codexSums, codexListings())).toThrow(/not a stable/);
        for (const tag of ["rust-v0.167.0-alpha.1", "v0.166.0", "rust-v0.166"]) {
            expect(() => buildCodexRecord(codexRelease({ tag_name: tag }), codexSums, codexListings())).toThrow(/unexpected release tag/);
        }
    });

    it("fetches the release and its checksum file, and lists every archive through the injected inspector", async () => {
        const fetchFn = (async (url: string) =>
            String(url).endsWith("codex-package_SHA256SUMS") ? new Response(codexSums) : Response.json(codexRelease())) as unknown as typeof fetch;
        const inspected: string[] = [];
        const listings = codexListings();
        const record = await buildLatestCodexRecord(fetchFn, async (d) => {
            inspected.push(`${d.key} ${d.sha256}`);
            return listings[d.key];
        });
        expect(record.version).toBe("0.166.0");
        expect(inspected.sort()).toEqual(PLATFORM_KEYS.map((key, i) => `${key} ${sha(String(i))}`).sort());
        await expect(buildLatestCodexRecord(fetchFn, async () => ["bin/"])).rejects.toThrow(/is not in the archive/);
        const noSums = (async () => Response.json({ ...codexRelease(), assets: [] })) as unknown as typeof fetch;
        await expect(buildLatestCodexRecord(noSums, async () => [])).rejects.toThrow(/codex-package_SHA256SUMS missing/);
    });

    it("lists a real tar.gz it downloaded and refuses bytes that do not hash to the digest", async () => {
        const dir = mkdtempSync(path.join(tmpdir(), "origami-test-"));
        try {
            mkdirSync(path.join(dir, "src", "bin"), { recursive: true });
            writeFileSync(path.join(dir, "src", "bin", "codex"), "codex");
            writeFileSync(path.join(dir, "src", "codex-package.json"), "{}");
            const archive = path.join(dir, "a.tar.gz");
            expect(Bun.spawnSync(["tar", "-czf", archive, "-C", path.join(dir, "src"), "bin", "codex-package.json"]).exitCode).toBe(0);
            const bytes = await Bun.file(archive).bytes();
            const fetchFn = (async () => new Response(bytes)) as unknown as typeof fetch;
            const download = { key: "linux-x64" as const, file: "a.tar.gz", url: "https://x.test/a.tar.gz", sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
            expect((await inspectArchive(fetchFn)(download)).sort()).toEqual(["bin/", "bin/codex", "codex-package.json"]);
            await expect(inspectArchive(fetchFn)({ ...download, sha256: sha("0") })).rejects.toThrow(/hash to .*, not the published/);
            await expect(inspectArchive((async () => new Response("gone", { status: 404 })) as unknown as typeof fetch)(download)).rejects.toThrow(/404/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// Claude Code: canned Anthropic manifest, npm packuments and tarball facts for 2.1.309.
const CLAUDE_VERSION = "2.1.309";
const claudeBinary = (key: PlatformKey) => (key.startsWith("windows-") ? "claude.exe" : "claude");
const claudeKeyIndex = (key: PlatformKey) => PLATFORM_KEYS.indexOf(key) + 1;

function claudeManifest(): ClaudeManifest {
    return {
        version: CLAUDE_VERSION,
        platforms: {
            ...Object.fromEntries(PLATFORM_KEYS.map((key) => [CLAUDE_PLATFORM[key], { binary: claudeBinary(key), checksum: sha(String(claudeKeyIndex(key))) }])),
            "linux-x64-musl": { binary: "claude", checksum: sha("f") },
        },
    };
}
function claudeFacts(key: PlatformKey): TarballFacts {
    return {
        size: 1000 + claudeKeyIndex(key),
        sha1: String(claudeKeyIndex(key)).repeat(40),
        sha256: sha(String.fromCharCode(96 + claudeKeyIndex(key))),
        sha512: Buffer.from(`sha512 of ${key}`).toString("base64"),
        members: ["package/", `package/${claudeBinary(key)}`, "package/LICENSE.md", "package/README.md", "package/package.json"],
        binarySha256: sha(String(claudeKeyIndex(key))),
    };
}
function claudePackument(key: PlatformKey): NpmPackument {
    const claude = CLAUDE_PLATFORM[key];
    return {
        name: `@anthropic-ai/claude-code-${claude}`,
        version: CLAUDE_VERSION,
        dist: {
            tarball: `https://registry.npmjs.org/@anthropic-ai/claude-code-${claude}/-/claude-code-${claude}-${CLAUDE_VERSION}.tgz`,
            integrity: `sha512-${claudeFacts(key).sha512}`,
            shasum: claudeFacts(key).sha1,
        },
    };
}

interface FakeClaude {
    channel?: string;
    manifest?: ClaudeManifest;
    fingerprint?: string;
    packument?: (key: PlatformKey) => NpmPackument;
    facts?: (key: PlatformKey) => TarballFacts;
}
function fakeClaudeIo(f: FakeClaude = {}): ClaudeCodeIo {
    const packument = f.packument ?? claudePackument;
    const facts = f.facts ?? claudeFacts;
    const keyOfPackage = (url: string) => PLATFORM_KEYS.find((key) => url.includes(`claude-code-${CLAUDE_PLATFORM[key]}/`))!;
    return {
        text: async (url) => (url.endsWith("/stable") || url.endsWith("/latest") ? (f.channel ?? CLAUDE_VERSION) : "PUBLIC KEY"),
        json: async <T>(url: string) => packument(keyOfPackage(url)) as T,
        bytes: async (url) => new TextEncoder().encode(url.endsWith(".sig") ? "signature" : JSON.stringify(f.manifest ?? claudeManifest())),
        verifySignature: async () => f.fingerprint ?? SIGNING_FINGERPRINT,
        inspectTarball: async (url) => facts(keyOfPackage(url)),
    };
}

describe("update-claude-code", () => {
    it("builds the record from the signed manifest and the npm tarballs, sha256 being the tarball's", async () => {
        const record = await buildLatestClaudeCodeRecord("stable", fakeClaudeIo());
        assertValidRecord(record);
        expect(record).toMatchObject({ name: "claude-code", version: CLAUDE_VERSION });
        expect(Object.keys(record.platforms)).toEqual([...PLATFORM_KEYS]);
        expect(record.platforms["linux-x64"]).toEqual({
            url: "https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/-/claude-code-linux-x64-2.1.309.tgz",
            sha256: claudeFacts("linux-x64").sha256,
            size: claudeFacts("linux-x64").size,
            recipe: { unpack: "tar", take: { "bin/claude": "package/claude", "LICENSE.md": "package/LICENSE.md" } },
        });
        // darwin and win32 are Anthropic's names for macos and windows
        expect(record.platforms["macos-arm64"]?.url).toContain("claude-code-darwin-arm64-2.1.309.tgz");
        expect(record.platforms["windows-x64"]?.recipe).toEqual({ unpack: "tar", take: { "bin/claude.exe": "package/claude.exe", "LICENSE.md": "package/LICENSE.md" } });
        expect(JSON.stringify(record)).not.toContain("musl");
    });

    it("reads the version from the chosen channel", async () => {
        const reads: string[] = [];
        const io = fakeClaudeIo();
        const text = io.text;
        io.text = async (url) => (reads.push(url), text(url));
        await buildLatestClaudeCodeRecord("latest", io);
        expect(reads[0]).toBe("https://downloads.claude.ai/claude-code-releases/latest");
    });

    it("refuses a manifest signed by any key but the pinned one", async () => {
        const other = "0123456789ABCDEF0123456789ABCDEF01234567";
        await expect(buildLatestClaudeCodeRecord("stable", fakeClaudeIo({ fingerprint: other }))).rejects.toThrow(/signed by 0123456789ABCDEF0123456789ABCDEF01234567, not Anthropic's pinned key/);
        // the comparison ignores spacing and case, never the digits
        const spaced = SIGNING_FINGERPRINT.toLowerCase().replace(/(.{4})/g, "$1 ");
        expect((await buildLatestClaudeCodeRecord("stable", fakeClaudeIo({ fingerprint: spaced }))).version).toBe(CLAUDE_VERSION);
    });

    it("refuses a signature that fails to verify", async () => {
        const io = fakeClaudeIo();
        io.verifySignature = async () => {
            throw new Error("the manifest signature does not verify (BADSIG)");
        };
        await expect(buildLatestClaudeCodeRecord("stable", io)).rejects.toThrow(/BADSIG/);
    });

    it("refuses a tarball whose sha512 or sha1 differs from the registry's", async () => {
        const wrongIntegrity = (key: PlatformKey) => (key === "macos-x64" ? { ...claudePackument(key), dist: { ...claudePackument(key).dist, integrity: `sha512-${Buffer.from("other").toString("base64")}` } } : claudePackument(key));
        await expect(buildLatestClaudeCodeRecord("stable", fakeClaudeIo({ packument: wrongIntegrity }))).rejects.toThrow(/darwin-x64: tarball sha512 differs/);
        const wrongShasum = (key: PlatformKey) => (key === "linux-arm64" ? { ...claudePackument(key), dist: { ...claudePackument(key).dist, shasum: "a".repeat(40) } } : claudePackument(key));
        await expect(buildLatestClaudeCodeRecord("stable", fakeClaudeIo({ packument: wrongShasum }))).rejects.toThrow(/linux-arm64: tarball sha1 differs/);
        const noIntegrity = (key: PlatformKey) => ({ ...claudePackument(key), dist: { ...claudePackument(key).dist, integrity: undefined } });
        await expect(buildLatestClaudeCodeRecord("stable", fakeClaudeIo({ packument: noIntegrity }))).rejects.toThrow(/no sha512 integrity/);
    });

    it("refuses a binary inside the tarball that differs from the signed manifest", async () => {
        const tampered = (key: PlatformKey) => (key === "windows-arm64" ? { ...claudeFacts(key), binarySha256: sha("9") } : claudeFacts(key));
        await expect(buildLatestClaudeCodeRecord("stable", fakeClaudeIo({ facts: tampered }))).rejects.toThrow(/win32-arm64: the binary inside the tarball differs from the signed manifest/);
    });

    it("refuses a platform missing from the manifest, or a tarball missing a member the recipe takes", async () => {
        const manifest = claudeManifest();
        delete manifest.platforms!["darwin-arm64"];
        await expect(buildLatestClaudeCodeRecord("stable", fakeClaudeIo({ manifest }))).rejects.toThrow(/darwin-arm64: not in the signed manifest/);
        const noLicense = (key: PlatformKey) => ({ ...claudeFacts(key), members: claudeFacts(key).members.filter((m) => m !== "package/LICENSE.md") });
        await expect(buildLatestClaudeCodeRecord("stable", fakeClaudeIo({ facts: noLicense }))).rejects.toThrow(/package\/LICENSE.md is not in the tarball/);
        const wrongBinary = claudeManifest();
        wrongBinary.platforms!["win32-x64"]!.binary = "claude";
        await expect(buildLatestClaudeCodeRecord("stable", fakeClaudeIo({ manifest: wrongBinary }))).rejects.toThrow(/manifest names the binary "claude", expected claude.exe/);
    });

    it("refuses a manifest or registry answer for another version or package", async () => {
        await expect(buildLatestClaudeCodeRecord("stable", fakeClaudeIo({ manifest: { ...claudeManifest(), version: "2.1.310" } }))).rejects.toThrow(/manifest is for "2.1.310"/);
        const otherVersion = (key: PlatformKey) => ({ ...claudePackument(key), version: "2.1.310" });
        await expect(buildLatestClaudeCodeRecord("stable", fakeClaudeIo({ packument: otherVersion }))).rejects.toThrow(/registry answered for version "2.1.310"/);
        const otherPackage = (key: PlatformKey) => ({ ...claudePackument(key), name: "@anthropic-ai/claude-code" });
        await expect(buildLatestClaudeCodeRecord("stable", fakeClaudeIo({ packument: otherPackage }))).rejects.toThrow(/registry answered for "@anthropic-ai\/claude-code"/);
    });

    it("refuses a channel that does not name a plain version", async () => {
        for (const channel of ["2.1", "v2.1.309", "2.1.309-beta", "<html>", ""]) {
            await expect(buildLatestClaudeCodeRecord("stable", fakeClaudeIo({ channel }))).rejects.toThrow(/unexpected version/);
        }
        expect(() => buildClaudeCodeRecord("latest", claudeManifest(), {} as never, {} as never)).toThrow(/unexpected version/);
    });

    it("hashes a real tarball and its binary, and lists what it holds", async () => {
        const dir = mkdtempSync(path.join(tmpdir(), "origami-test-"));
        try {
            mkdirSync(path.join(dir, "src", "package"), { recursive: true });
            writeFileSync(path.join(dir, "src", "package", "claude"), "the binary");
            writeFileSync(path.join(dir, "src", "package", "LICENSE.md"), "licence");
            const archive = path.join(dir, "a.tgz");
            expect(Bun.spawnSync(["tar", "-czf", archive, "-C", path.join(dir, "src"), "package"]).exitCode).toBe(0);
            const bytes = await Bun.file(archive).bytes();
            const fetchFn = (async () => new Response(bytes)) as unknown as typeof fetch;
            const facts = await inspectTarball(fetchFn)("https://x.test/a.tgz", "package/claude");
            const h = (alg: string, enc: "hex" | "base64") => crypto.createHash(alg).update(bytes).digest(enc);
            expect(facts).toMatchObject({
                size: bytes.byteLength,
                sha1: h("sha1", "hex"),
                sha256: h("sha256", "hex"),
                sha512: h("sha512", "base64"),
                binarySha256: crypto.createHash("sha256").update("the binary").digest("hex"),
            });
            expect(facts.members.sort()).toEqual(["package/", "package/LICENSE.md", "package/claude"]);
            await expect(inspectTarball(fetchFn)("https://x.test/a.tgz", "package/claude.exe")).rejects.toThrow(/package\/claude.exe is not in/);
            await expect(inspectTarball((async () => new Response("gone", { status: 404 })) as unknown as typeof fetch)("https://x.test/a.tgz", "package/claude")).rejects.toThrow(/404/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// the real gpg binary, against a throwaway key: the status-line parsing is the trust boundary
describe("update-claude-code signature check", () => {
    const manifest = new TextEncoder().encode('{"version":"2.1.309"}');
    async function signer() {
        const home = mkdtempSync(path.join(tmpdir(), "origami-gpg-test-"));
        const env = { ...process.env, GNUPGHOME: home };
        const gpg = (args: string[], input?: Uint8Array) => Bun.spawnSync(["gpg", "--batch", "--no-tty", ...args], { env, stdin: input });
        expect(gpg(["--passphrase", "", "--quick-generate-key", "Test Signer <test@example.com>", "ed25519", "sign", "never"]).exitCode).toBe(0);
        const publicKey = gpg(["--armor", "--export"]).stdout.toString();
        const fingerprint = /fpr:+([A-F0-9]{40}):/.exec(gpg(["--with-colons", "--list-keys"]).stdout.toString())![1]!;
        const sign = (data: Uint8Array) => new Uint8Array(gpg(["--detach-sign", "--output", "-"], data).stdout);
        const done = () => {
            Bun.spawnSync(["gpgconf", "--kill", "gpg-agent"], { env });
            rmSync(home, { recursive: true, force: true });
        };
        return { publicKey, fingerprint, sign, done };
    }

    it("returns the primary fingerprint of a valid signature", async () => {
        const s = await signer();
        try {
            expect(await gpgVerify(manifest, s.sign(manifest), s.publicKey)).toBe(s.fingerprint);
        } finally {
            s.done();
        }
    });

    it("says so when gpg is not installed instead of falling back", async () => {
        const savedPath = process.env.PATH;
        process.env.PATH = "/nonexistent";
        try {
            await expect(gpgVerify(manifest, manifest, "key")).rejects.toThrow(/gpg is not installed/);
        } finally {
            process.env.PATH = savedPath;
        }
    });

    it("refuses a manifest that was changed after signing, a foreign key, and garbage", async () => {
        const s = await signer();
        const other = await signer();
        try {
            const signature = s.sign(manifest);
            await expect(gpgVerify(new TextEncoder().encode('{"version":"9.9.9"}'), signature, s.publicKey)).rejects.toThrow(/does not verify/);
            // signed by a key the imported key block does not contain
            await expect(gpgVerify(manifest, other.sign(manifest), s.publicKey)).rejects.toThrow(/does not verify/);
            await expect(gpgVerify(manifest, new TextEncoder().encode("not a signature"), s.publicKey)).rejects.toThrow();
            await expect(gpgVerify(manifest, signature, "not a key")).rejects.toThrow(/could not import/);
        } finally {
            s.done();
            other.done();
        }
    });
});

describe("new package records through the signed-record path", () => {
    it("signs every platform of opencode, codex and claude-code, the recipe included where there is one", async () => {
        const records = [
            buildOpencodeRecord(opencodeRelease(), opencodeSums),
            buildCodexRecord(codexRelease(), codexSums, codexListings()),
            await buildLatestClaudeCodeRecord("stable", fakeClaudeIo()),
        ];
        for (const record of records) {
            let written: PackageRecord | null = null;
            await putRecord(record, keys.privateKey, async (_command, args) => {
                written = JSON.parse(args[5]!);
                return { stdout: "", stderr: "" };
            }, PUBLIC);
            expect(Object.keys(written!.platforms)).toEqual([...PLATFORM_KEYS]);
            for (const [platform, entry] of Object.entries(written!.platforms)) {
                const msg = releaseMessage.package(record.name, record.version, platform, entry!.sha256, entry!.recipe && recipeDigest(entry!.recipe));
                expect(verifyRelease(msg, entry!.signature, PUBLIC)).toBe(true);
            }
        }
    });
});
