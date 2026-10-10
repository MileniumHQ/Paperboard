import { isSupportedMcVersion } from "../../lib/versionProfile";
import { fetchJson } from "../http";
import type { SoftwareProvider, VersionItem } from "../types";

const FABRIC_META_URL = "https://meta.fabricmc.net/v2/versions";
const FABRIC_INSTALLER_VERSION = "1.1.2";

/** The pinned loader when Fabric lists it for this Minecraft version, else the newest. */
export function pickFabricLoader(loaders: readonly (string | undefined)[], pinned?: string): string | null {
    if (pinned !== undefined) return loaders.includes(pinned) ? pinned : null;
    return loaders.find((loader): loader is string => Boolean(loader)) ?? null;
}

export const fabricProvider: SoftwareProvider = {
    id: "fabric",

    async listVersions(): Promise<VersionItem[]> {
        const data = await fetchJson<{ version: string; stable?: boolean }[]>(`${FABRIC_META_URL}/game`);
        return (data || []).map((v) => ({
            id: v.version,
            type: v.stable ? "release" : "snapshot",
            installable: isSupportedMcVersion(v.version),
        }));
    },

    // known limitation: Fabric publishes no checksums for the server
    // launcher jar. the pinned meta.fabricmc.net host + pinned installer
    // version are the trust anchor. if upstream ever publishes hashes for
    // this endpoint, pin them here the way vanilla/Paper do.
    async resolveBuild(mcVersion, pinned) {
        const loaders = await fetchJson<{ loader?: { version?: string } }[]>(
            `${FABRIC_META_URL}/loader/${encodeURIComponent(mcVersion)}`,
        );
        const loader = pickFabricLoader(loaders.map((item) => item.loader?.version), pinned);
        if (!loader) {
            throw new Error(
                pinned !== undefined
                    ? `Fabric Loader ${pinned} is not published for Minecraft ${mcVersion}`
                    : `No loader found for Fabric on Minecraft ${mcVersion}`,
            );
        }
        return {
            build: loader,
            artifact: {
                url: `${FABRIC_META_URL}/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loader)}/${FABRIC_INSTALLER_VERSION}/server/jar`,
            },
        };
    },

    install: { type: "jar" },
};
