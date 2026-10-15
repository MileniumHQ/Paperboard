import { serverBridge, serverSoftware } from "./server";
import { ACTION_IDS } from "../service/contract";
import { modrinthFetch, parseSearchHits, SEARCH_LIMIT, type ModrinthHit, type RawHit } from "./plugins";
import { MODPACK_LOADER, type ModpackRecord } from "../core/modpack";
import type { ModpackInstallOutcome } from "../service/modpacks";
import type { ModrinthVersion } from "../core/modrinth";

export type { ModpackInstallOutcome, ModpackRecord, ModrinthHit, ModrinthVersion };

// Modrinth search runs in the page like the Mods tab's; reading, installing
// and removing the pack belong to the service (service/modpacks.ts).

export async function searchModpacks(query: string, signal?: AbortSignal): Promise<ModrinthHit[]> {
    const loader = MODPACK_LOADER[serverSoftware()];
    if (!loader) return [];
    const data = await modrinthFetch<{ hits?: (RawHit & { server_side?: string })[] }>(
        "/search",
        {
            query,
            limit: String(SEARCH_LIMIT),
            facets: JSON.stringify([
                ["project_type:modpack"],
                [`categories:${loader.modrinth}`],
                ["server_side:required", "server_side:optional"],
            ]),
            index: query ? "relevance" : "downloads",
        },
        signal,
    );
    // the facet lets a few client-only packs through; they install nothing on a server
    return parseSearchHits(data.hits?.filter((hit) => hit.server_side !== "unsupported"));
}

export const readModpack = () => serverBridge.call<{ modpack: ModpackRecord | null }>(ACTION_IDS.readModpack);

export const listModpackVersions = (projectId: string) =>
    serverBridge.call<ModrinthVersion[]>(ACTION_IDS.listModpackVersions, { projectId });

// downloading and placing a pack runs for minutes: the call is waited out,
// not cut off at the bridge's 30 s default (progress arrives through state)
export const installModpack = (projectId: string, versionId: string) =>
    serverBridge.call<ModpackInstallOutcome>(ACTION_IDS.installModpack, { projectId, versionId }, { timeoutMs: null });

export const removeModpack = () =>
    serverBridge.call<{ removed: number; forgotten?: true }>(ACTION_IDS.removeModpack, {}, { timeoutMs: null });
