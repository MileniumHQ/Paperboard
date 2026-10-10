import { isSupportedMcVersion } from "../../lib/versionProfile";
import { fetchJson } from "../http";
import type { SoftwareProvider, VersionItem } from "../types";

const PAPER_API_URL = "https://fill.papermc.io/v3/projects/paper";

async function getPaperVersions(): Promise<string[]> {
    const data = await fetchJson<{ versions?: Record<string, string[]> }>(PAPER_API_URL);
    return Object.values(data.versions ?? {}).flat();
}

export const paperProvider: SoftwareProvider = {
    id: "paper",

    async listVersions(): Promise<VersionItem[]> {
        const versions = await getPaperVersions();
        return versions.map((v) => ({
            id: v,
            type: v.includes("pre") || v.includes("rc") ? "snapshot" : "release",
            installable: isSupportedMcVersion(v),
        }));
    },

    async resolveBuild(mcVersion, pinned) {
        if (pinned !== undefined) throw new Error("Paper installs take no pinned build");
        const builds = await fetchJson<{ builds?: number[] }>(
            `${PAPER_API_URL}/versions/${encodeURIComponent(mcVersion)}`,
        );
        const build = builds.builds?.[0];
        if (!build) throw new Error(`No builds found for Paper version ${mcVersion}`);

        const data = await fetchJson<{
            downloads?: Record<string, { url?: string; checksums?: { sha256?: string } }>;
        }>(`${PAPER_API_URL}/versions/${encodeURIComponent(mcVersion)}/builds/${build}`);
        const server = data.downloads?.["server:default"];
        if (!server?.url) throw new Error(`No server download for Paper ${mcVersion} build ${build}`);
        // Paper's sha256 is the trust anchor; a build without one is refused
        const sha256 = server.checksums?.sha256;
        if (typeof sha256 !== "string" || !sha256) {
            throw new Error(
                `Paper published no sha256 for ${mcVersion} build ${build}; refusing to download unverified`,
            );
        }
        return { build: String(build), artifact: { url: server.url, sha256 } };
    },

    install: { type: "jar" },
};
