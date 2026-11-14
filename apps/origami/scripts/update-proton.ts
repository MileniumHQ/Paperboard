// Refreshes standalone GE-Proton (Valve Proton is distributed via Steam).
// bun run update:proton -- --dry-run prints without writing.
// Trust: GitHub's asset sha256 digest is the authority, like Helium.
// Require and parse each release's matching .sha512sum, but do not claim
// cross-verification: comparing sha512 with sha256 is impossible without
// downloading and hashing the ~600 MB archive. The updater only downloads
// metadata/checksum files; the daemon verifies the archive's sha256.
import { runUpdater, settle } from "./lib/cli";
import { fetchJson, fetchText } from "./lib/download";
import { assertValidRecord, PLATFORM_KEYS, type PackageRecord, type PlatformKey, type PlatformDownload } from "./lib/records";
import { digestedAsset, type GithubRelease } from "./lib/github";

const LATEST = "https://api.github.com/repos/GloriousEggroll/proton-ge-custom/releases/latest";
const ARCH: Partial<Record<PlatformKey, string>> = { "linux-x64": "x86_64", "linux-arm64": "aarch64" };

function assertStableRelease(release: GithubRelease): void {
    if (release.draft || release.prerelease) throw new Error(`${release.tag_name} is not a stable release`);
    if (!/^GE-Proton[1-9]\d*-[1-9]\d*$/.test(release.tag_name)) throw new Error(`unexpected release tag ${JSON.stringify(release.tag_name)}`);
}

export function buildProtonRecord(release: GithubRelease, sums: Record<string, string>): PackageRecord {
    assertStableRelease(release);
    const platforms: Partial<Record<PlatformKey, PlatformDownload>> = {};
    for (const key of PLATFORM_KEYS) {
        const arch = ARCH[key];
        if (!arch) continue;
        const stem = `${release.tag_name}-${arch}`;
        const file = `${stem}.tar.gz`;
        const download = digestedAsset(release.assets, file, release.tag_name);
        const checksum = `${stem}.sha512sum`;
        if (!release.assets.some((a) => a.name === checksum)) throw new Error(`${checksum} missing`);
        const match = sums[checksum]?.trim().match(/^([a-f0-9]{128})\s+\*?(?:\.\/)?([^\r\n]+)$/i);
        if (!match || match[2] !== file) throw new Error(`${checksum} missing or malformed checksum for ${file}`);
        platforms[key] = { ...download, recipe: { unpack: "tar", take: { bin: stem } } };
    }
    const record: PackageRecord = { name: "proton", version: release.tag_name, platforms };
    assertValidRecord(record);
    return record;
}

export async function buildLatestProtonRecord(fetchFn: typeof fetch = fetch): Promise<PackageRecord> {
    const release = await fetchJson<GithubRelease>(LATEST, fetchFn, { Accept: "application/vnd.github+json" });
    // Validate release metadata before fetching any checksum URLs.
    assertStableRelease(release);
    const sums: Record<string, string> = {};
    for (const arch of Object.values(ARCH)) {
        const name = `${release.tag_name}-${arch}.sha512sum`;
        const asset = release.assets.find((a) => a.name === name);
        if (!asset) throw new Error(`${name} missing`);
        sums[name] = await fetchText(asset.browser_download_url, fetchFn);
    }
    return buildProtonRecord(release, sums);
}

if (import.meta.main) {
    runUpdater(async () => [await settle("proton", () => buildLatestProtonRecord())]);
}
