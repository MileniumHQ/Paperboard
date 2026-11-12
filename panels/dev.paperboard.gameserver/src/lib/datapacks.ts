import { serverBridge, serverVersion } from "./server";
import { CALLS } from "../service/contract";
import { searchProjects, type ModrinthHit } from "./modrinth";
import type { DatapackListing } from "../service/datapacks";
import type { ModrinthVersion } from "../core/modrinth";

export type { DatapackListing, ModrinthHit, ModrinthVersion };

// Modrinth search runs in the page like the Mods tab's; listing, installing
// and removing belong to the service (service/datapacks.ts).

export async function searchDatapacks(query: string, signal?: AbortSignal): Promise<ModrinthHit[]> {
    const mcVersion = serverVersion();
    if (!mcVersion) throw new Error("Choose a server version before browsing datapacks.");
    return searchProjects({ query, signal, facets: [["project_type:datapack"], [`versions:${mcVersion}`]] });
}

export const listDatapacks = () => serverBridge.call<DatapackListing>(CALLS.listDatapacks);

export const listDatapackVersions = (projectId: string) =>
    serverBridge.call<ModrinthVersion[]>(CALLS.listDatapackVersions, { projectId });

export const installDatapack = (projectId: string, versionId: string) =>
    serverBridge.call<{ name: string; world: string; version: string }>(CALLS.installDatapack, {
        projectId,
        versionId,
    });

export const removeDatapack = (name: string) => serverBridge.call(CALLS.removeDatapack, { name });
