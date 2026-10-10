import { serverBridge, serverVersion } from "./server";
import { ACTION_IDS } from "../service/contract";
import { modrinthFetch, parseSearchHits, SEARCH_LIMIT, type ModrinthHit, type RawHit } from "./plugins";
import type { DatapackListing } from "../service/datapacks";
import type { ModrinthVersion } from "../core/modrinth";

export type { DatapackListing, ModrinthHit, ModrinthVersion };

// Modrinth search runs in the page like the Mods tab's; listing, installing
// and removing belong to the service (service/datapacks.ts).

export async function searchDatapacks(query: string, signal?: AbortSignal): Promise<ModrinthHit[]> {
    const mcVersion = serverVersion();
    if (!mcVersion) throw new Error("Choose a server version before browsing datapacks.");
    const data = await modrinthFetch<{ hits?: RawHit[] }>(
        "/search",
        {
            query,
            limit: String(SEARCH_LIMIT),
            facets: JSON.stringify([["project_type:datapack"], [`versions:${mcVersion}`]]),
            index: query ? "relevance" : "downloads",
        },
        signal,
    );
    return parseSearchHits(data.hits);
}

export const listDatapacks = () => serverBridge.call<DatapackListing>(ACTION_IDS.listDatapacks);

export const listDatapackVersions = (projectId: string) =>
    serverBridge.call<ModrinthVersion[]>(ACTION_IDS.listDatapackVersions, { projectId });

export const installDatapack = (projectId: string, versionId: string) =>
    serverBridge.call<{ name: string; world: string; version: string }>(ACTION_IDS.installDatapack, {
        projectId,
        versionId,
    });

export const removeDatapack = (name: string) => serverBridge.call(ACTION_IDS.removeDatapack, { name });
