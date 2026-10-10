import { isSupportedMcVersion } from "../../lib/versionProfile";
import { fetchJson, fetchSha256Sidecar } from "../http";
import type { SoftwareProvider, VersionItem } from "../types";
import { compareNumeric, forgeInstallerArgs } from "./forgeFamily";

const NEOFORGE_VERSIONS_URL =
    "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
const NEOFORGE_MAVEN = "https://maven.neoforged.net/releases/net/neoforged/neoforge";

export interface NeoForgeBuild {
    build: string;
    mcVersion: string;
    /** false for `-beta` builds */
    stable: boolean;
    /** numeric parts for ordering */
    order: number[];
}

/**
 * Maps a NeoForge version to the Minecraft version it runs.
 *
 *   21.1.256      -> 1.21.1   (Minecraft 1.x: major.minor.build)
 *   21.0.167      -> 1.21     (minor 0 is the .0 release, written without it)
 *   26.1.2.114    -> 26.1.2   (Minecraft 26+: year.drop.hotfix.build)
 *   26.2.0.88     -> 26.2
 *
 * Alpha/snapshot builds (`26.1.0.0-alpha.1+snapshot-1`) and April-fools
 * lines (`0.25w14craftmine.3-beta`) return null: they target versions that
 * are not Minecraft releases.
 */
export function parseNeoForgeVersion(version: string): NeoForgeBuild | null {
    const legacy = /^(\d+)\.(\d+)\.(\d+)(-beta)?$/.exec(version);
    if (legacy) {
        const [major, minor, build] = [Number(legacy[1]), Number(legacy[2]), Number(legacy[3])];
        if (major < 20 || major >= 26) return null;
        return {
            build: version,
            mcVersion: minor === 0 ? `1.${major}` : `1.${major}.${minor}`,
            stable: !legacy[4],
            order: [major, minor, 0, build],
        };
    }
    const dated = /^(\d+)\.(\d+)\.(\d+)\.(\d+)(-beta)?$/.exec(version);
    if (dated) {
        const [year, drop, hotfix, build] = dated.slice(1, 5).map(Number) as [number, number, number, number];
        if (year < 26) return null;
        return {
            build: version,
            mcVersion: hotfix === 0 ? `${year}.${drop}` : `${year}.${drop}.${hotfix}`,
            stable: !dated[5],
            order: [year, drop, hotfix, build],
        };
    }
    return null;
}

/** Builds grouped by Minecraft version, each group newest first, groups newest first. */
export function groupNeoForgeBuilds(versions: readonly string[]): Map<string, NeoForgeBuild[]> {
    const parsed = versions
        .map(parseNeoForgeVersion)
        .filter((b): b is NeoForgeBuild => b !== null)
        .sort((a, b) => compareNumeric(b.order, a.order));
    const groups = new Map<string, NeoForgeBuild[]>();
    for (const build of parsed) {
        const group = groups.get(build.mcVersion);
        if (group) group.push(build);
        else groups.set(build.mcVersion, [build]);
    }
    return groups;
}

/**
 * The pinned build when it is one of this Minecraft version's builds;
 * otherwise the newest stable build, else newest beta: a beta-only line is
 * still the only line.
 */
export function pickNeoForgeBuild(builds: readonly NeoForgeBuild[], pinned?: string): NeoForgeBuild | null {
    if (pinned !== undefined) return builds.find((b) => b.build === pinned) ?? null;
    return builds.find((b) => b.stable) ?? builds[0] ?? null;
}

async function fetchGroups(): Promise<Map<string, NeoForgeBuild[]>> {
    const data = await fetchJson<{ versions?: unknown }>(NEOFORGE_VERSIONS_URL);
    if (!Array.isArray(data.versions)) throw new Error("NeoForge returned no version list");
    return groupNeoForgeBuilds(data.versions.filter((v): v is string => typeof v === "string"));
}

export function neoForgeInstallerUrl(build: string): string {
    return `${NEOFORGE_MAVEN}/${encodeURIComponent(build)}/neoforge-${encodeURIComponent(build)}-installer.jar`;
}

export const neoforgeProvider: SoftwareProvider = {
    id: "neoforge",

    async listVersions(): Promise<VersionItem[]> {
        const groups = await fetchGroups();
        return [...groups].map(([mcVersion, builds]) => ({
            id: mcVersion,
            // a Minecraft version NeoForge has only beta builds for sits
            // behind the picker's pre-release filter, like a snapshot
            type: builds.some((b) => b.stable) ? "release" : "snapshot",
            installable: isSupportedMcVersion(mcVersion),
        }));
    },

    async resolveBuild(mcVersion, pinned) {
        const groups = await fetchGroups();
        const build = pickNeoForgeBuild(groups.get(mcVersion) ?? [], pinned);
        if (!build) {
            throw new Error(
                pinned !== undefined
                    ? `NeoForge ${pinned} is not a build for Minecraft ${mcVersion}`
                    : `NeoForge has no build for Minecraft ${mcVersion}`,
            );
        }
        const url = neoForgeInstallerUrl(build.build);
        // The digest comes from the same Maven host as the jar. It catches a
        // corrupted or truncated transfer; it is not a second authority. The
        // pinned HTTPS host is the trust anchor, as with Fabric.
        const sha256 = await fetchSha256Sidecar(url);
        return { build: build.build, artifact: { url, sha256 } };
    },

    install: {
        type: "installer",
        args: forgeInstallerArgs,
        launchCandidates: (_mcVersion, build) => ({
            argfileDir: `libraries/net/neoforged/neoforge/${build}`,
        }),
    },
};
