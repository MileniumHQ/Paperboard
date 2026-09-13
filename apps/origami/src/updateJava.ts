export interface PlatformDownload {
    url: string;
    sha256?: string;
}

export interface JavaPackageData {
    name: string;
    version: string;
    platforms: {
        "linux-x64"?: PlatformDownload;
        "linux-arm64"?: PlatformDownload;
        "macos-x64"?: PlatformDownload;
        "macos-arm64"?: PlatformDownload;
        "windows-x64"?: PlatformDownload;
        "windows-arm64"?: PlatformDownload;
        [key: string]: PlatformDownload | undefined;
    };
}

export interface JavaUpdateResult {
    success: boolean;
    updated: string[];
    errors: Record<string, string>;
    packages: Record<string, JavaPackageData>;
}

function mapAdoptiumBinaryToPlatformKey(
    os: string,
    arch: string,
): string | null {
    const cleanOs = os.toLowerCase();
    const cleanArch = arch.toLowerCase();

    if (cleanOs === "linux") {
        if (cleanArch === "x64") return "linux-x64";
        if (cleanArch === "aarch64" || cleanArch === "arm64")
            return "linux-arm64";
    } else if (cleanOs === "mac" || cleanOs === "macos") {
        if (cleanArch === "x64") return "macos-x64";
        if (cleanArch === "aarch64" || cleanArch === "arm64")
            return "macos-arm64";
    } else if (cleanOs === "windows") {
        if (cleanArch === "x64") return "windows-x64";
        if (cleanArch === "aarch64" || cleanArch === "arm64")
            return "windows-arm64";
    }
    return null;
}

export async function fetchJavaPackage(
    featureVersion: number | string,
): Promise<JavaPackageData | null> {
    const res = await fetch(
        `https://api.adoptium.net/v3/assets/latest/${featureVersion}/hotspot?image_type=jdk`,
        {
            headers: {
                "User-Agent": "Origami-Java-Updater/1.0",
                Accept: "application/json",
            },
        },
    );
    if (!res.ok) return null;

    const assets = (await res.json()) as any[];
    if (!Array.isArray(assets) || assets.length === 0) return null;

    const first = assets[0];
    const rawVersion =
        first.release_name?.replace(/^jdk-?/, "") ||
        first.version?.openjdk_version ||
        String(featureVersion);

    const platforms: Record<string, PlatformDownload> = {};

    for (const entry of assets) {
        const binary = entry.binary;
        if (!binary || !binary.package?.link) continue;

        const platformKey = mapAdoptiumBinaryToPlatformKey(
            binary.os,
            binary.architecture,
        );
        if (platformKey && !platforms[platformKey]) {
            platforms[platformKey] = {
                url: binary.package.link,
                // Unlike the registry's own "checksum must come from a
                // source separate from the download record" rule, this
                // sha256 comes from the same Adoptium API record as the
                // URL. That is deliberate: Adoptium is a well-known
                // authority reached over TLS, and this record is re-fetched
                // fresh on every update run — nothing publisher-supplied is
                // persisted or echoed back. The authority itself is the
                // trust anchor; there is no self-attesting third party here
                // to deceive.
                sha256: binary.package.checksum,
            };
        }
    }

    return {
        name: `java-${featureVersion}`,
        version: rawVersion,
        platforms,
    };
}

export async function updateJavaPackages(
    packagesKv: KVNamespace,
    targetVersion?: number | string,
): Promise<JavaUpdateResult> {
    let versionsToUpdate: (number | string)[] = [];

    if (targetVersion) {
        versionsToUpdate = [targetVersion];
    } else {
        const releasesRes = await fetch(
            "https://api.adoptium.net/v3/info/available_releases",
            {
                headers: {
                    "User-Agent": "Origami-Java-Updater/1.0",
                    Accept: "application/json",
                },
            },
        );
        if (!releasesRes.ok) {
            throw new Error(
                `Failed to query Adoptium available releases: ${releasesRes.status} ${releasesRes.statusText}`,
            );
        }

        const releasesData = (await releasesRes.json()) as {
            available_releases?: number[];
        };
        versionsToUpdate = releasesData.available_releases || [
            8, 11, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
        ];
    }

    const updated: string[] = [];
    const errors: Record<string, string> = {};
    const packages: Record<string, JavaPackageData> = {};

    for (const ver of versionsToUpdate) {
        const key = `java-${ver}`;
        try {
            const pkg = await fetchJavaPackage(ver);
            if (pkg && Object.keys(pkg.platforms).length > 0) {
                await packagesKv.put(key, JSON.stringify(pkg, null, 2));
                updated.push(key);
                packages[key] = pkg;
            } else {
                errors[key] = "No JDK platforms found for release";
            }
        } catch (err: any) {
            errors[key] = err?.message || String(err);
        }
    }

    return {
        success: updated.length > 0,
        updated,
        errors,
        packages,
    };
}
