import { isSupportedMcVersion } from "../../lib/versionProfile";
import { fetchJson, fetchSha256Sidecar } from "../http";
import type { SoftwareProvider, VersionItem } from "../types";
import { compareNumeric, forgeInstallerArgs, releaseParts } from "./forgeFamily";

const FORGE_METADATA_URL =
    "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json";
const FORGE_PROMOTIONS_URL =
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const FORGE_MAVEN = "https://maven.minecraftforge.net/net/minecraftforge/forge";

/** maven-metadata.json: Minecraft version -> full Forge ids ("1.21.1-52.1.0"), oldest first */
export type ForgeMetadata = Record<string, string[]>;
/** promotions_slim.json `promos`: "<mc>-recommended" / "<mc>-latest" -> Forge build ("52.1.0") */
export type ForgePromotions = Record<string, string>;

/** Minecraft releases Forge has builds for, newest first. */
export function forgeMcVersions(metadata: ForgeMetadata): string[] {
    return Object.keys(metadata)
        .filter((mc) => releaseParts(mc) !== null && (metadata[mc]?.length ?? 0) > 0)
        .sort((a, b) => compareNumeric(releaseParts(b)!, releaseParts(a)!));
}

/**
 * The Forge build to install for a Minecraft version: the recommended
 * promotion, else the latest promotion, else the newest published build.
 * A promotion is only honoured when the Maven index lists that exact build;
 * the two records come from one publisher and must agree. A pinned build
 * replaces the promotions and must be listed the same way.
 */
export function pickForgeBuild(
    mcVersion: string,
    metadata: ForgeMetadata,
    promotions: ForgePromotions,
    pinned?: string,
): string | null {
    const published = new Set(metadata[mcVersion] ?? []);
    const prefix = `${mcVersion}-`;
    // a pin is honoured only as a build the Maven index lists for this version
    if (pinned !== undefined) return published.has(prefix + pinned) ? pinned : null;
    for (const key of [`${mcVersion}-recommended`, `${mcVersion}-latest`]) {
        const build = promotions[key];
        if (typeof build === "string" && published.has(prefix + build)) return build;
    }
    const newest = metadata[mcVersion]?.at(-1);
    return newest?.startsWith(prefix) ? newest.slice(prefix.length) : null;
}

export function forgeInstallerUrl(mcVersion: string, build: string): string {
    const id = encodeURIComponent(`${mcVersion}-${build}`);
    return `${FORGE_MAVEN}/${id}/forge-${id}-installer.jar`;
}

export const forgeProvider: SoftwareProvider = {
    id: "forge",

    async listVersions(): Promise<VersionItem[]> {
        const metadata = await fetchJson<ForgeMetadata>(FORGE_METADATA_URL);
        return forgeMcVersions(metadata).map((id) => ({
            id,
            type: "release",
            installable: isSupportedMcVersion(id),
        }));
    },

    async resolveBuild(mcVersion, pinned) {
        const [metadata, promotions] = await Promise.all([
            fetchJson<ForgeMetadata>(FORGE_METADATA_URL),
            fetchJson<{ promos?: ForgePromotions }>(FORGE_PROMOTIONS_URL),
        ]);
        const build = pickForgeBuild(mcVersion, metadata, promotions.promos ?? {}, pinned);
        if (!build) {
            throw new Error(
                pinned !== undefined
                    ? `Forge ${pinned} is not a build for Minecraft ${mcVersion}`
                    : `Forge has no build for Minecraft ${mcVersion}`,
            );
        }
        const url = forgeInstallerUrl(mcVersion, build);
        // same-host digest: transfer integrity, not a second authority (see neoforge.ts)
        const sha256 = await fetchSha256Sidecar(url);
        return { build, artifact: { url, sha256 } };
    },

    install: {
        type: "installer",
        args: forgeInstallerArgs,
        launchCandidates: (mcVersion, build) => ({
            // 1.17+: argument files, like NeoForge
            argfileDir: `libraries/net/minecraftforge/forge/${mcVersion}-${build}`,
            // up to 1.16.5: a runnable jar in the install root
            jars: [`forge-${mcVersion}-${build}.jar`, `forge-${mcVersion}-${build}-universal.jar`],
        }),
    },
};
