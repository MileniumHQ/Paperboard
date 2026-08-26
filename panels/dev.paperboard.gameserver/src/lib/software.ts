import semver from "semver";

export type ServerSoftwareType = "vanilla" | "paper" | "fabric";

export const SOFTWARE_NAMES: Record<ServerSoftwareType, string> = {
    vanilla: "Vanilla",
    paper: "Paper",
    fabric: "Fabric",
};

export interface VersionItem {
    id: string;
    type: "release" | "snapshot" | "old_beta" | "old_alpha" | "beta" | "other";
    releaseTime?: string;
}

// Determines required Java runtime package via semver comparison
export function getRequiredJavaVersion(mcVersion: string): string {
    const v = semver.coerce(mcVersion);
    if (!v) return "java-8";

    if (semver.gte(v, "26.0.0")) return "java-25";
    if (semver.gte(v, "1.20.5")) return "java-21";
    if (semver.gte(v, "1.18.0")) return "java-17";
    if (semver.gte(v, "1.17.0")) return "java-16";
    return "java-8";
}

const PISTON_META_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const PAPER_API_URL = "https://fill.papermc.io/v3/projects/paper";
const FABRIC_META_URL = "https://meta.fabricmc.net/v2/versions";

// Mojang official vanilla version resolvers
export async function getDetailedVanillaVersions(): Promise<VersionItem[]> {
    const res = await fetch(PISTON_META_URL);
    const data = await res.json();
    return (data.versions || []).map((v: any) => ({
        id: v.id,
        type: v.type,
        releaseTime: v.releaseTime,
    }));
}

export async function getVanillaDownload(versionId: string): Promise<{ url: string; sha1: string; filename: string }> {
    const res = await fetch(PISTON_META_URL);
    const data = await res.json();
    const version = data.versions.find((v: any) => v.id === versionId);
    if (!version) throw new Error(`Version ${versionId} not found`);

    const versionRes = await fetch(version.url);
    const versionData = await versionRes.json();
    const server = versionData.downloads?.server;
    if (!server) throw new Error(`No server jar for ${versionId}`);

    return { url: server.url, sha1: server.sha1, filename: `vanilla-${versionId}.jar` };
}

// PaperMC version resolvers
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

export async function getPaperDownload(version: string, build?: number | string) {
    const targetBuild = build ?? (await getPaperBuilds(version))[0];
    if (!targetBuild) throw new Error(`No builds found for Paper version ${version}`);

    const res = await fetch(`${PAPER_API_URL}/versions/${version}/builds/${targetBuild}`);
    const data = await res.json();
    const server = data.downloads?.["server:default"];
    if (!server) throw new Error(`No server download for Paper ${version} build ${targetBuild}`);

    return {
        url: server.url,
        sha256: server.checksums?.sha256,
        filename: server.name || `paper-${version}-${targetBuild}.jar`,
        build: targetBuild,
    };
}

// FabricMC version resolvers
export async function getFabricLoaderVersions(gameVersion?: string): Promise<string[]> {
    const endpoint = gameVersion ? `${FABRIC_META_URL}/loader/${gameVersion}` : `${FABRIC_META_URL}/loader`;
    const res = await fetch(endpoint);
    const data = await res.json();
    return data.map((item: any) => item.loader?.version || item.version).filter(Boolean);
}

export async function getFabricDownload(
    gameVersion: string,
    loaderVersion?: string,
    installerVersion = "1.1.2",
): Promise<{ url: string; filename: string }> {
    const targetLoader = loaderVersion ?? (await getFabricLoaderVersions(gameVersion))[0];
    if (!targetLoader) throw new Error(`No loader found for Fabric on Minecraft ${gameVersion}`);

    return {
        url: `${FABRIC_META_URL}/loader/${gameVersion}/${targetLoader}/${installerVersion}/server/jar`,
        filename: `fabric-server-mc.${gameVersion}-loader.${targetLoader}-launcher.${installerVersion}.jar`,
    };
}

// Unified version and server JAR downloader for any supported software type
export async function getDetailedVersionsForSoftware(software: ServerSoftwareType): Promise<VersionItem[]> {
    switch (software) {
        case "vanilla":
            return getDetailedVanillaVersions();
        case "paper": {
            const versions = await getPaperVersions();
            return versions.map((v) => ({
                id: v,
                type: v.includes("pre") || v.includes("rc") ? "snapshot" : "release",
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
        default:
            throw new Error(`Unsupported software: ${software}`);
    }
}

export async function getSoftwareDownload(
    software: ServerSoftwareType,
    version = "1.21.4",
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
        default:
            throw new Error(`Unsupported software: ${software}`);
    }
}
