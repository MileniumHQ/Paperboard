import { serverBridge, serverVersion } from "./server";
import { ACTION_IDS } from "../service/contract";
import { modrinthFetch, parseSearchHits, SEARCH_LIMIT, type ModrinthHit, type RawHit } from "./plugins";
import { RESOURCEPACK_PROJECT_TYPE, type ResourcePackSelection } from "../core/resourcepack";
import type { ResourcePackView } from "../service/resourcepack";
import type { ModrinthVersion } from "../core/modrinth";

export type { ModrinthHit, ModrinthVersion, ResourcePackSelection, ResourcePackView };

// Modrinth search runs in the page like the Datapacks tab's; reading,
// selecting and removing the pack belong to the service (service/resourcepack.ts).

export async function searchResourcePacks(query: string, signal?: AbortSignal): Promise<ModrinthHit[]> {
    const mcVersion = serverVersion();
    if (!mcVersion) throw new Error("Choose a server version before browsing resource packs.");
    const data = await modrinthFetch<{ hits?: RawHit[] }>(
        "/search",
        {
            query,
            limit: String(SEARCH_LIMIT),
            facets: JSON.stringify([[`project_type:${RESOURCEPACK_PROJECT_TYPE}`], [`versions:${mcVersion}`]]),
            index: query ? "relevance" : "downloads",
        },
        signal,
    );
    return parseSearchHits(data.hits);
}

export const readResourcePack = () => serverBridge.call<ResourcePackView>(ACTION_IDS.readResourcePack);

export const listResourcePackVersions = (projectId: string) =>
    serverBridge.call<ModrinthVersion[]>(ACTION_IDS.listResourcePackVersions, { projectId });

export const selectModrinthResourcePack = (projectId: string, versionId: string) =>
    serverBridge.call<ResourcePackSelection>(ACTION_IDS.selectResourcePack, { projectId, versionId });

export const selectCustomResourcePack = (url: string) =>
    serverBridge.call<ResourcePackSelection>(ACTION_IDS.selectResourcePack, { url });

export const removeResourcePack = () => serverBridge.call(ACTION_IDS.removeResourcePack);
