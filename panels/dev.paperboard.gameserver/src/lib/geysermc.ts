import type { GeyserMCSource } from "../core/plugins";
import type { ResolvedDownload } from "./plugins";
import { apiFetch } from "./userAgent";

// GeyserMC's own download API: the only place Floodgate for Paper is
// published. Every build lists a sha256 per platform file.

const GEYSERMC_API = "https://download.geysermc.org/v2/projects";

interface GeyserMCBuild {
    version: string;
    build: number;
    downloads: Record<string, { name: string; sha256: string }>;
}

/** the newest build's file for `source`, pinned to its build number so the sha256 describes it */
export async function resolveGeyserMCLatest(source: GeyserMCSource, filename: string): Promise<ResolvedDownload & { sha256: string }> {
    const base = `${GEYSERMC_API}/${encodeURIComponent(source.project)}`;
    const res = await apiFetch(`${base}/versions/latest/builds/latest`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GeyserMC's download service answered HTTP ${res.status}`);
    const latest = (await res.json()) as GeyserMCBuild;
    const file = latest.downloads?.[source.platform];
    if (typeof latest.version !== "string" || !Number.isInteger(latest.build) || !file?.sha256) {
        throw new Error(`GeyserMC's latest ${source.project} build has no ${source.platform} download`);
    }
    return {
        url: `${base}/versions/${encodeURIComponent(latest.version)}/builds/${latest.build}/downloads/${encodeURIComponent(source.platform)}`,
        filename,
        // the number GeyserMC's own Modrinth uploads use, e.g. 2.12.1-b1276
        versionNumber: `${latest.version}-b${latest.build}`,
        sha256: file.sha256,
        gameVersions: [],
        exactMatch: true,
    };
}
