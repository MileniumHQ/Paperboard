// GitHub release facts shared by the updaters that trust GitHub's asset digests.

export interface GithubAsset {
    name: string;
    size?: number;
    digest?: string | null;
    browser_download_url: string;
}

export interface GithubRelease {
    tag_name: string;
    draft?: boolean;
    prerelease?: boolean;
    assets: GithubAsset[];
}

export function parseSha256Sums(text: string): Map<string, string> {
    const sums = new Map<string, string>();
    for (const line of text.split(/\r?\n/)) {
        const m = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(?:\.\/)?(.+)$/);
        if (m) sums.set(m[2]!.trim(), m[1]!.toLowerCase());
    }
    return sums;
}

export interface AssetDownload {
    url: string;
    sha256: string;
    size?: number;
}

/** The named asset with its GitHub sha256 digest; `label` prefixes every error. */
export function digestedAsset(assets: GithubAsset[], file: string, label: string): AssetDownload {
    const asset = assets.find((a) => a.name === file);
    if (!asset) throw new Error(`${label}: asset ${file} missing`);
    const sha256 = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toLowerCase();
    if (!sha256) throw new Error(`${label}: ${file} has no sha256 digest`);
    return { url: asset.browser_download_url, sha256, ...(typeof asset.size === "number" ? { size: asset.size } : {}) };
}

/** digestedAsset, which must also be listed in the release's sums file with the same hash. */
export function verifiedAsset(release: GithubRelease, file: string, sums: Map<string, string>, sumsFile: string): AssetDownload {
    const download = digestedAsset(release.assets, file, release.tag_name);
    const listed = sums.get(file);
    if (!listed) throw new Error(`${release.tag_name}: ${file} is not in ${sumsFile}`);
    if (listed !== download.sha256) throw new Error(`${release.tag_name}: ${file} digest disagrees with ${sumsFile}`);
    return download;
}
