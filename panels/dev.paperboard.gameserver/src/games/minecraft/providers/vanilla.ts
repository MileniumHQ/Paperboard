import { isSupportedMcVersion } from "../../../lib/versionProfile";
import { fetchJson } from "../../../software/http";
import type { SoftwareProvider, VersionItem } from "../../../software/types";

const PISTON_META_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

interface PistonManifest {
    versions?: { id: string; type: string; url: string; releaseTime?: string }[];
}

// read fresh each time: the service runs for weeks, and a release Mojang
// publishes meanwhile must show up in Versions
const getPistonManifest = () => fetchJson<PistonManifest>(PISTON_META_URL);

export const vanillaProvider: SoftwareProvider = {
    id: "vanilla",

    async listVersions(): Promise<VersionItem[]> {
        const data = await getPistonManifest();
        return (data.versions || []).map((v) => ({
            id: v.id,
            type: v.type === "release" ? "release" : "snapshot",
            releaseTime: v.releaseTime,
            installable: isSupportedMcVersion(v.id),
        }));
    },

    async resolveBuild(mcVersion, pinned) {
        if (pinned !== undefined) throw new Error("Vanilla has no builds to pin");
        const data = await getPistonManifest();
        const version = (data.versions || []).find((v) => v.id === mcVersion);
        if (!version) throw new Error(`Version ${mcVersion} not found`);

        const versionData = await fetchJson<{
            downloads?: { server?: { url?: string; sha1?: string } };
        }>(version.url);
        const server = versionData.downloads?.server;
        if (!server?.url) throw new Error(`No server jar for ${mcVersion}`);
        // no checksum from the manifest means no install — never proceed with
        // an undefined sha1 (same rule as the registry and Modrinth paths)
        if (typeof server.sha1 !== "string" || !server.sha1) {
            throw new Error(`Mojang published no sha1 for ${mcVersion}; refusing to download unverified`);
        }
        return { build: null, artifact: { url: server.url, sha1: server.sha1 } };
    },

    install: { type: "jar" },
};
