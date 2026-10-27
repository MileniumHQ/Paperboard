// Refreshes the `helium` record (the Helium browser the Agents panel drives)
// to the latest stable release of imputnet's three platform repos.
//
//   bun run update:helium              latest stable (no drafts/prereleases)
//   bun run update:helium -- --dry-run print, don't write
//
// Paperboard does not host Helium. Each entry points at imputnet's own
// GitHub asset and carries a recipe that the daemon runs on the user's
// computer (papercrane/packageRecipe.ts): unpack the archive or disk image,
// take the browser out into bin/.
//
// Trust: GitHub is the authority for imputnet's release assets; each
// asset's sha256 is GitHub's asset digest. The three repos must be on the
// same version, or nothing is written, so every platform runs the same
// Chromium.
import { writeRecords, report } from "./lib/cli";
import {
    assertValidRecord,
    fetchJson,
    PLATFORM_KEYS,
    type PackageRecipe,
    type PackageRecord,
    type PlatformDownload,
    type PlatformKey,
} from "./lib/records";
import type { GithubRelease } from "./update-ollama";

export const REPOS = ["helium-linux", "helium-macos", "helium-windows"] as const;
export type HeliumRepo = (typeof REPOS)[number];

const latest = (repo: HeliumRepo) => `https://api.github.com/repos/imputnet/${repo}/releases/latest`;

// the asset each platform installs, and where its browser sits inside it
const BUILD_FOR: Record<PlatformKey, (v: string) => { repo: HeliumRepo; file: string; recipe: PackageRecipe }> = {
    "linux-x64": (v) => linux(v, "x86_64"),
    "linux-arm64": (v) => linux(v, "arm64"),
    "macos-x64": (v) => macos(v, "x86_64"),
    "macos-arm64": (v) => macos(v, "arm64"),
    "windows-x64": (v) => windows(v, "x64"),
    "windows-arm64": (v) => windows(v, "arm64"),
};

// helium-<v>-<arch>_linux/helium
function linux(v: string, arch: string) {
    const dir = `helium-${v}-${arch}_linux`;
    return { repo: "helium-linux" as const, file: `${dir}.tar.xz`, recipe: { unpack: "tar.xz" as const, take: { bin: dir } } };
}

// Helium.app at the image's root
function macos(v: string, arch: string) {
    return {
        repo: "helium-macos" as const,
        file: `helium_${v}_${arch}-macos.dmg`,
        recipe: { unpack: "dmg" as const, take: { "bin/Helium.app": "Helium.app" } },
    };
}

// helium_<v>_<arch>-windows/chrome.exe
function windows(v: string, arch: string) {
    const dir = `helium_${v}_${arch}-windows`;
    return { repo: "helium-windows" as const, file: `${dir}.zip`, recipe: { unpack: "zip" as const, take: { bin: dir } } };
}

export function buildHeliumRecord(releases: Record<HeliumRepo, GithubRelease>): PackageRecord {
    const versions = new Set<string>();
    for (const repo of REPOS) {
        const release = releases[repo];
        if (release.draft || release.prerelease) throw new Error(`${repo} ${release.tag_name} is not a stable release`);
        if (!/^\d+(\.\d+){2,3}$/.test(release.tag_name)) {
            throw new Error(`${repo}: unexpected release tag ${JSON.stringify(release.tag_name)}`);
        }
        versions.add(release.tag_name);
    }
    if (versions.size !== 1) {
        throw new Error(`the Helium repos are on different versions (${REPOS.map((r) => `${r} ${releases[r].tag_name}`).join(", ")})`);
    }
    const version = [...versions][0]!;
    const platforms: Partial<Record<PlatformKey, PlatformDownload>> = {};
    for (const key of PLATFORM_KEYS) {
        const { repo, file, recipe } = BUILD_FOR[key](version);
        const asset = releases[repo].assets.find((a) => a.name === file);
        if (!asset) throw new Error(`${repo} ${version}: asset ${file} missing`);
        const digest = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toLowerCase();
        if (!digest) throw new Error(`${repo} ${version}: ${file} has no sha256 digest`);
        platforms[key] = {
            url: asset.browser_download_url,
            sha256: digest,
            ...(typeof asset.size === "number" ? { size: asset.size } : {}),
            recipe,
        };
    }
    const record: PackageRecord = { name: "helium", version, platforms };
    assertValidRecord(record);
    return record;
}

export async function buildLatestHeliumRecord(fetchFn: typeof fetch = fetch): Promise<PackageRecord> {
    const releases = {} as Record<HeliumRepo, GithubRelease>;
    for (const repo of REPOS) {
        releases[repo] = await fetchJson<GithubRelease>(latest(repo), fetchFn, { Accept: "application/vnd.github+json" });
    }
    return buildHeliumRecord(releases);
}

async function main(argv: string[]): Promise<number> {
    const dryRun = argv.includes("--dry-run");
    let built: { key: string; record?: PackageRecord; error?: string };
    try {
        built = { key: "helium", record: await buildLatestHeliumRecord() };
    } catch (err) {
        built = { key: "helium", error: err instanceof Error ? err.message : String(err) };
    }
    return report(await writeRecords([built], { dryRun }), dryRun);
}

if (import.meta.main) {
    main(process.argv.slice(2)).then(
        (code) => process.exit(code),
        (err) => {
            console.error(err instanceof Error ? err.message : err);
            process.exit(1);
        },
    );
}
