export type ServerSoftwareType = "vanilla" | "paper" | "fabric" | "neoforge";

export interface VersionItem {
    id: string;
    type: "release" | "snapshot" | "old_beta" | "old_alpha" | "beta" | "other";
    releaseTime?: string;
}

export interface VersionInfo {
    id: string;
    type?: "release" | "snapshot" | string;
    url?: string;
    releaseTime?: string;
}

export interface SoftwareBuildInfo {
    software: ServerSoftwareType;
    version: string;
    build?: string | number;
    downloadUrl?: string;
    filename?: string;
}

export function getRequiredJavaVersion(mcVersion: string): string {
    if (mcVersion.startsWith("26.") || mcVersion.startsWith("27."))
        return "java-25";

    const parts = mcVersion.split(".").map(Number);
    const major = parts[0] ?? 1;
    const minor = parts[1] ?? 0;
    const patch = parts[2] ?? 0;

    if (major >= 26) return "java-25";
    if (minor >= 21 || (minor === 20 && patch >= 5)) return "java-21";
    if (minor >= 18) return "java-17";
    if (minor === 17) return "java-16";

    return "java-8";
}

const PISTON_META_URL =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

export async function getDetailedVanillaVersions(): Promise<VersionItem[]> {
    const res = await fetch(PISTON_META_URL);
    const data = await res.json();
    return (data.versions || []).map((v: any) => ({
        id: v.id,
        type: v.type as "release" | "snapshot" | "old_beta" | "old_alpha",
        releaseTime: v.releaseTime,
    }));
}

export async function getVanillaVersions(
    includeSnapshots = false,
): Promise<string[]> {
    const res = await fetch(PISTON_META_URL);
    const data = await res.json();
    return data.versions
        .filter((v: any) => (includeSnapshots ? true : v.type === "release"))
        .map((v: any) => v.id);
}

export async function getVanillaDownload(
    versionId: string,
): Promise<{ url: string; sha1: string; filename: string }> {
    const res = await fetch(PISTON_META_URL);
    const data = await res.json();
    const version = data.versions.find((v: any) => v.id === versionId);
    if (!version) throw new Error(`Version ${versionId} not found`);

    const versionRes = await fetch(version.url);
    const versionData = await versionRes.json();
    const server = versionData.downloads?.server;
    if (!server) throw new Error(`No server jar for ${versionId}`);

    return {
        url: server.url,
        sha1: server.sha1,
        filename: `vanilla-${versionId}.jar`,
    };
}

const PAPER_API_URL = "https://fill.papermc.io/v3/projects/paper";

export async function getPaperVersions(): Promise<string[]> {
    const res = await fetch(PAPER_API_URL);
    const data = await res.json();
    return Object.values(data.versions as Record<string, string[]>).flat();
}

export async function getPaperBuilds(version: string): Promise<number[]> {
    const res = await fetch(`${PAPER_API_URL}/versions/${version}`);
    const data = await res.json();
    return data.builds || [];
}

export async function getPaperDownload(
    version: string,
    build?: number | string,
): Promise<{
    url: string;
    sha256: string;
    filename: string;
    build: number | string;
}> {
    const targetBuild = build ?? (await getPaperBuilds(version))[0];
    if (!targetBuild)
        throw new Error(`No builds found for Paper version ${version}`);

    const res = await fetch(
        `${PAPER_API_URL}/versions/${version}/builds/${targetBuild}`,
    );
    const data = await res.json();
    const server = data.downloads?.["server:default"];
    if (!server)
        throw new Error(
            `No server download for Paper ${version} build ${targetBuild}`,
        );

    return {
        url: server.url,
        sha256: server.checksums?.sha256,
        filename: server.name || `paper-${version}-${targetBuild}.jar`,
        build: targetBuild,
    };
}

const FABRIC_META_URL = "https://meta.fabricmc.net/v2/versions";

export async function getFabricGameVersions(
    includeSnapshots = false,
): Promise<string[]> {
    const res = await fetch(`${FABRIC_META_URL}/game`);
    const data = await res.json();
    return data
        .filter((v: any) => (includeSnapshots ? true : v.stable))
        .map((v: any) => v.version);
}

export async function getFabricLoaderVersions(
    gameVersion?: string,
): Promise<string[]> {
    const endpoint = gameVersion
        ? `${FABRIC_META_URL}/loader/${gameVersion}`
        : `${FABRIC_META_URL}/loader`;
    const res = await fetch(endpoint);
    const data = await res.json();
    return data
        .map((item: any) => item.loader?.version || item.version)
        .filter(Boolean);
}

export async function getFabricDownload(
    gameVersion: string,
    loaderVersion?: string,
    installerVersion = "1.1.2",
): Promise<{ url: string; filename: string }> {
    const targetLoader =
        loaderVersion ?? (await getFabricLoaderVersions(gameVersion))[0];
    if (!targetLoader)
        throw new Error(
            `No loader found for Fabric on Minecraft ${gameVersion}`,
        );

    const url = `${FABRIC_META_URL}/loader/${gameVersion}/${targetLoader}/${installerVersion}/server/jar`;
    return {
        url,
        filename: `fabric-server-mc.${gameVersion}-loader.${targetLoader}-launcher.${installerVersion}.jar`,
    };
}

const NEOFORGE_MAVEN_API = "https://maven.neoforged.net/api/maven";

export function neoForgeToMinecraftVersion(v: string): string {
    const clean = v.split("-")[0];
    const parts = clean.split(".");
    const major = parseInt(parts[0], 10);
    if (major >= 26) {
        if (parts[2] && parts[2] !== "0") {
            return `${parts[0]}.${parts[1]}.${parts[2]}`;
        }
        return `${parts[0]}.${parts[1]}`;
    } else {
        const minor = parts[0];
        const patch = parts[1];
        if (patch === "0") return `1.${minor}`;
        return `1.${minor}.${patch}`;
    }
}

export async function getNeoForgeVersions(): Promise<string[]> {
    const res = await fetch(
        `${NEOFORGE_MAVEN_API}/versions/releases/net/neoforged/neoforge`,
    );
    const data = await res.json();
    return [...(data.versions || [])].reverse();
}

export async function getNeoForgeDownload(version: string): Promise<{
    url: string;
    sha256?: string;
    filename: string;
    version: string;
}> {
    const allVersions = await getNeoForgeVersions();
    const candidates = allVersions.filter(
        (v) =>
            neoForgeToMinecraftVersion(v) === version ||
            v.startsWith(version) ||
            v === version,
    );
    if (candidates.length === 0) candidates.push(version);

    for (const v of candidates) {
        const filename = `neoforge-${v}-installer.jar`;
        const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/${filename}`;

        try {
            const headRes = await fetch(url, { method: "HEAD" });
            if (headRes.ok) {
                let sha256: string | undefined;
                try {
                    const shaRes = await fetch(`${url}.sha256`);
                    if (shaRes.ok) {
                        sha256 = (await shaRes.text()).trim();
                    }
                } catch {}
                return { url, sha256, filename, version: v };
            }
        } catch {}
    }

    throw new Error(
        `No available NeoForge installer found for version "${version}"`,
    );
}

export async function getDetailedVersionsForSoftware(
    software: ServerSoftwareType,
): Promise<VersionItem[]> {
    switch (software) {
        case "vanilla":
            return getDetailedVanillaVersions();
        case "paper": {
            const versions = await getPaperVersions();
            return versions.map((v) => ({
                id: v,
                type:
                    v.includes("pre") || v.includes("rc")
                        ? "snapshot"
                        : "release",
            }));
        }
        case "fabric": {
            const res = await fetch(`${FABRIC_META_URL}/game`);
            const data = await res.json();
            return (data || []).map((v: any) => ({
                id: v.version,
                type: v.stable ? "release" : "snapshot",
            }));
        }
        case "neoforge": {
            const rawVersions = await getNeoForgeVersions();
            const map = new Map<
                string,
                { latestBuild: string; isBeta: boolean }
            >();

            for (const v of rawVersions) {
                const mc = neoForgeToMinecraftVersion(v);
                if (!map.has(mc)) {
                    map.set(mc, {
                        latestBuild: v,
                        isBeta: v.includes("beta"),
                    });
                }
            }

            return Array.from(map.entries()).map(([mcVersion, info]) => ({
                id: mcVersion,
                type: info.isBeta ? "beta" : "release",
            }));
        }
        default:
            throw new Error(`Unsupported software: ${software}`);
    }
}

export async function getVersionsForSoftware(
    software: ServerSoftwareType,
    includeSnapshots = false,
): Promise<string[]> {
    switch (software) {
        case "vanilla":
            return getVanillaVersions(includeSnapshots);
        case "paper":
            return getPaperVersions();
        case "fabric":
            return getFabricGameVersions(includeSnapshots);
        case "neoforge":
            return getNeoForgeVersions();
        default:
            throw new Error(`Unsupported software: ${software}`);
    }
}

export async function getSoftwareDownload(
    software: ServerSoftwareType,
    version = "26.2",
): Promise<{ url: string; sha1?: string; sha256?: string; filename: string }> {
    switch (software) {
        case "vanilla": {
            const dl = await getVanillaDownload(version);
            return { url: dl.url, sha1: dl.sha1, filename: "server.jar" };
        }
        case "paper": {
            const dl = await getPaperDownload(version);
            return { url: dl.url, sha256: dl.sha256, filename: "server.jar" };
        }
        case "fabric": {
            const dl = await getFabricDownload(version);
            return { url: dl.url, filename: "server.jar" };
        }
        case "neoforge": {
            const dl = await getNeoForgeDownload(version);
            return { url: dl.url, sha256: dl.sha256, filename: "server.jar" };
        }
        default:
            throw new Error(`Unsupported software: ${software}`);
    }
}
