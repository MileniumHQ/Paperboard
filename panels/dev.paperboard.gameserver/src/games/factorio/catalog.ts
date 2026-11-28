/**
 * The free headless Factorio server, from the publisher. Each release is
 * pinned: its link (factorio.com/get-download, which sends a download to a
 * signed address that soon expires), its size, and the SHA-256 Wube lists
 * at factorio.com/download/sha256sums/, checked against the operator's own
 * download. Releases are added here explicitly, never learned from the
 * download being installed. No factorio.com account is needed to download it.
 */
export interface FactorioRelease {
    version: string;
    url: string;
    size: number;
    sha256: string;
}

export const releases: readonly FactorioRelease[] = [{
    version: "2.1.25",
    url: "https://factorio.com/get-download/2.1.25/headless/linux64",
    size: 61484908,
    sha256: "78da2f5aa99e9e0af7586d6bf82c04aae91165d53036720dabb26e855688f3ae",
}];

/** The newest release Paperboard installs. */
export const newestRelease: FactorioRelease = releases[0]!;

export function releaseFor(version: string): FactorioRelease {
    const release = releases.find((r) => r.version === version);
    if (!release) throw new Error(`Factorio ${version} is not in the verified release catalog`);
    return release;
}

/** Where the archive keeps the server, under the one folder it unpacks to. */
export const ARCHIVE_ROOT = "factorio";
export const EXECUTABLE = "bin/x64/factorio";

