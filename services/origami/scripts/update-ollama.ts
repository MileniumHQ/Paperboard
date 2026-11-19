// Refreshes the `ollama` record to the latest stable GitHub release.
//
//   bun run update:ollama              latest stable (no drafts/prereleases)
//   bun run update:ollama -- --dry-run print, don't write
//
// Trust: GitHub is the authority for ollama/ollama release assets. Each
// asset's sha256 comes from GitHub's asset digest and must agree with the
// release's own sha256sum.txt; a missing or disagreeing fact drops the
// whole record rather than publishing a partial one.
import { parseSha256Sums, verifiedAsset, type GithubRelease } from "./lib/github";
import { runUpdater, settle } from "./lib/cli";
import { fetchJson, fetchText } from "./lib/download";
import {
    assertValidRecord,
    PLATFORM_KEYS,
    type PackageLayout,
    type PackageRecord,
    type PlatformDownload,
    type PlatformKey,
} from "./lib/records";

const LATEST = "https://api.github.com/repos/ollama/ollama/releases/latest";

// Base builds only. GPU add-ons (-rocm, -mlx, -jetpack*) unpack on top of
// the base tree, and Ollama resolves its libraries relative to its own
// executable, so an add-on cannot live in a package directory of its own.
const ASSET_FOR: Record<PlatformKey, { file: string; layout: PackageLayout }> = {
    // bin/ollama + lib/ollama/...
    "linux-x64": { file: "ollama-linux-amd64.tar.zst", layout: "root" },
    "linux-arm64": { file: "ollama-linux-arm64.tar.zst", layout: "root" },
    // flat: ollama + dylibs side by side; universal binary
    "macos-x64": { file: "ollama-darwin.tgz", layout: "bin" },
    "macos-arm64": { file: "ollama-darwin.tgz", layout: "bin" },
    // flat: ollama.exe + lib/ollama/...
    "windows-x64": { file: "ollama-windows-amd64.zip", layout: "bin" },
    "windows-arm64": { file: "ollama-windows-arm64.zip", layout: "bin" },
};

export function buildOllamaRecord(release: GithubRelease, sumsText: string): PackageRecord {
    if (release.draft || release.prerelease) {
        throw new Error(`${release.tag_name} is not a stable release`);
    }
    const version = release.tag_name.replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`unexpected release tag ${JSON.stringify(release.tag_name)}`);
    }
    const sums = parseSha256Sums(sumsText);
    const platforms: Partial<Record<PlatformKey, PlatformDownload>> = {};
    for (const key of PLATFORM_KEYS) {
        const { file, layout } = ASSET_FOR[key];
        platforms[key] = { ...verifiedAsset(release, file, sums, "sha256sum.txt"), layout };
    }
    const record: PackageRecord = { name: "ollama", version, platforms };
    assertValidRecord(record);
    return record;
}

export async function buildLatestOllamaRecord(fetchFn: typeof fetch = fetch): Promise<PackageRecord> {
    const release = await fetchJson<GithubRelease>(LATEST, fetchFn, {
        Accept: "application/vnd.github+json",
    });
    const sumsAsset = release.assets?.find((a) => a.name === "sha256sum.txt");
    if (!sumsAsset) throw new Error(`${release.tag_name}: sha256sum.txt missing`);
    return buildOllamaRecord(release, await fetchText(sumsAsset.browser_download_url, fetchFn));
}

if (import.meta.main) {
    runUpdater(async () => [await settle("ollama", () => buildLatestOllamaRecord())]);
}
