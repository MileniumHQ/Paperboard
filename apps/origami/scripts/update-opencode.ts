// Refreshes the `opencode` record (the OpenCode CLI the Agent panel drives)
// to the newest stable 2.x release of anomalyco/opencode.
//
//   bun run update:opencode              newest stable 2.x release
//   bun run update:opencode -- --dry-run print, don't write
//
// Paperboard does not host OpenCode. Each entry points at the project's own
// GitHub asset, which holds one file (opencode / opencode.exe) at the
// archive root, so the archive root is the package's bin/.
//
// Why not /releases/latest: GitHub still marks the old 1.x line (v1.19.5)
// as latest, and the panel speaks the 2.x config schema. The updater lists
// the recent releases and takes the newest stable v2.x tag.
//
// Builds: x64 ships the -baseline build everywhere (it runs on CPUs
// without AVX2). The -musl builds are dynamically linked against musl's
// loader and do not run on glibc, so they are never used.
//
// Trust: GitHub is the authority for the release's assets. Each asset's
// sha256 comes from GitHub's asset digest and must agree with the release's
// own SHA256SUMS; a missing or disagreeing fact drops the whole record
// rather than publishing a partial one.
import { writeRecords, report } from "./lib/cli";
import {
    assertValidRecord,
    fetchJson,
    fetchText,
    PLATFORM_KEYS,
    type PackageLayout,
    type PackageRecord,
    type PlatformDownload,
    type PlatformKey,
} from "./lib/records";
import { parseSha256Sums, type GithubRelease } from "./update-ollama";

const RELEASES = "https://api.github.com/repos/anomalyco/opencode/releases?per_page=30";
const TAG_RE = /^v(2)\.(\d+)\.(\d+)$/;

const ASSET_FOR: Record<PlatformKey, { file: string; layout: PackageLayout }> = {
    "linux-x64": { file: "opencode-linux-x64-baseline.tar.gz", layout: "bin" },
    "linux-arm64": { file: "opencode-linux-arm64.tar.gz", layout: "bin" },
    "macos-x64": { file: "opencode-darwin-x64-baseline.zip", layout: "bin" },
    "macos-arm64": { file: "opencode-darwin-arm64.zip", layout: "bin" },
    "windows-x64": { file: "opencode-windows-x64-baseline.zip", layout: "bin" },
    "windows-arm64": { file: "opencode-windows-arm64.zip", layout: "bin" },
};

/** The newest stable 2.x release among the listed ones, by version rather than list order. */
export function newestV2Release(releases: GithubRelease[]): GithubRelease {
    let best: { release: GithubRelease; parts: number[] } | undefined;
    for (const release of releases) {
        const m = TAG_RE.exec(release.tag_name);
        if (!m || release.draft || release.prerelease) continue;
        const parts = [Number(m[2]), Number(m[3])];
        if (!best || parts[0]! > best.parts[0]! || (parts[0] === best.parts[0] && parts[1]! > best.parts[1]!)) {
            best = { release, parts };
        }
    }
    if (!best) throw new Error("no stable v2.x release among the latest opencode releases");
    return best.release;
}

export function buildOpencodeRecord(release: GithubRelease, sumsText: string): PackageRecord {
    if (release.draft || release.prerelease) {
        throw new Error(`${release.tag_name} is not a stable release`);
    }
    if (!TAG_RE.test(release.tag_name)) {
        throw new Error(`unexpected release tag ${JSON.stringify(release.tag_name)}`);
    }
    const version = release.tag_name.slice(1);
    const sums = parseSha256Sums(sumsText);
    const platforms: Partial<Record<PlatformKey, PlatformDownload>> = {};
    for (const key of PLATFORM_KEYS) {
        const { file, layout } = ASSET_FOR[key];
        const asset = release.assets.find((a) => a.name === file);
        if (!asset) throw new Error(`${release.tag_name}: asset ${file} missing`);
        const digest = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toLowerCase();
        if (!digest) throw new Error(`${release.tag_name}: ${file} has no sha256 digest`);
        const listed = sums.get(file);
        if (!listed) throw new Error(`${release.tag_name}: ${file} is not in SHA256SUMS`);
        if (listed !== digest) {
            throw new Error(`${release.tag_name}: ${file} digest disagrees with SHA256SUMS`);
        }
        platforms[key] = {
            url: asset.browser_download_url,
            sha256: digest,
            ...(typeof asset.size === "number" ? { size: asset.size } : {}),
            layout,
        };
    }
    const record: PackageRecord = { name: "opencode", version, platforms };
    assertValidRecord(record);
    return record;
}

export async function buildLatestOpencodeRecord(fetchFn: typeof fetch = fetch): Promise<PackageRecord> {
    const releases = await fetchJson<GithubRelease[]>(RELEASES, fetchFn, {
        Accept: "application/vnd.github+json",
    });
    if (!Array.isArray(releases)) throw new Error("opencode releases: unexpected response");
    const release = newestV2Release(releases);
    const sumsAsset = release.assets?.find((a) => a.name === "SHA256SUMS");
    if (!sumsAsset) throw new Error(`${release.tag_name}: SHA256SUMS missing`);
    return buildOpencodeRecord(release, await fetchText(sumsAsset.browser_download_url, fetchFn));
}

async function main(argv: string[]): Promise<number> {
    const dryRun = argv.includes("--dry-run");
    let built: { key: string; record?: PackageRecord; error?: string };
    try {
        built = { key: "opencode", record: await buildLatestOpencodeRecord() };
    } catch (err) {
        built = { key: "opencode", error: err instanceof Error ? err.message : String(err) };
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
