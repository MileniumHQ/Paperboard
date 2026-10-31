import { STEAMCMD_BUILDS, buildSteamcmdRecord, buildLatestSteamcmdRecord } from "../scripts/update-steamcmd";
import { RIDS, runtimeFiles, buildDotnetRecord, buildLatestDotnetRecord, type DotnetReleases } from "../scripts/update-dotnet";
import { buildProtonRecord, buildLatestProtonRecord } from "../scripts/update-proton";
import { buildOpencodeRecord, buildLatestOpencodeRecord, newestV2Release } from "../scripts/update-opencode";
import { TARGETS, buildCodexRecord, buildLatestCodexRecord, inspectArchive, type ArchiveListings } from "../scripts/update-codex";
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
