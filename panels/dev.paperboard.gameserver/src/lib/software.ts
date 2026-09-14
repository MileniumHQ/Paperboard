import semver from "semver";
import { javaPackageFor } from "./versionProfile";

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

// null when version missing or unparseable. The thresholds live in
// versionProfile's override table; this is the one entry point the installer
// and lifecycle use.
export function getRequiredJavaVersion(mcVersion: string): string | null {
    return javaPackageFor(mcVersion);
}

const PISTON_META_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const PAPER_API_URL = "https://fill.papermc.io/v3/projects/paper";
const FABRIC_META_URL = "https://meta.fabricmc.net/v2/versions";

// manifest cached in-memory per session
let pistonManifestCache: any | null = null;

async function getPistonManifest(): Promise<any> {
    if (!pistonManifestCache) {
        const res = await fetch(PISTON_META_URL);
        pistonManifestCache = await res.json();
    }
    return pistonManifestCache;
}

export async function getDetailedVanillaVersions(): Promise<VersionItem[]> {
    const data = await getPistonManifest();
    return (data.versions || []).map((v: any) => ({
        id: v.id,
        type: v.type,
        releaseTime: v.releaseTime,
    }));
}

export async function getVanillaDownload(versionId: string): Promise<{ url: string; sha1: string; filename: string }> {
    const data = await getPistonManifest();
    const version = data.versions.find((v: any) => v.id === versionId);
    if (!version) throw new Error(`Version ${versionId} not found`);

    const versionRes = await fetch(version.url);
    const versionData = await versionRes.json();
    const server = versionData.downloads?.server;
    if (!server) throw new Error(`No server jar for ${versionId}`);
    // no checksum from the manifest means no install — never proceed with
    // an undefined sha1 (same rule as the registry and Modrinth paths)
    if (typeof server.sha1 !== "string" || !server.sha1) {
        throw new Error(`Mojang published no sha1 for ${versionId}; refusing to download unverified`);
    }

    return { url: server.url, sha1: server.sha1, filename: `vanilla-${versionId}.jar` };
}

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
    // Paper's sha256 is the trust anchor; a build without one is refused
    const sha256 = server.checksums?.sha256;
    if (typeof sha256 !== "string" || !sha256) {
        throw new Error(
            `Paper published no sha256 for ${version} build ${targetBuild}; refusing to download unverified`,
        );
    }

    return {
        url: server.url,
        sha256,
        filename: server.name || `paper-${version}-${targetBuild}.jar`,
        build: targetBuild,
    };
}

export async function getFabricLoaderVersions(gameVersion?: string): Promise<string[]> {
    const endpoint = gameVersion ? `${FABRIC_META_URL}/loader/${gameVersion}` : `${FABRIC_META_URL}/loader`;
    const res = await fetch(endpoint);
    const data = await res.json();
    return data.map((item: any) => item.loader?.version || item.version).filter(Boolean);
}

// known limitation: Fabric publishes no checksums for the server
// launcher jar. the pinned meta.fabricmc.net host + pinned installer
// version are the trust anchor. if upstream ever publishes hashes for
// this endpoint, pin them here the way vanilla/Paper do.
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
    version: string,
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
