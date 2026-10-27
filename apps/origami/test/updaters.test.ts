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
import { assertValidRecord } from "../scripts/lib/records";
import { writeRecords } from "../scripts/lib/cli";
import { putRecord, wranglerPutArgs } from "../scripts/lib/kv";
import type { PackageRecord } from "../scripts/lib/records";
import * as crypto from "node:crypto";
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
