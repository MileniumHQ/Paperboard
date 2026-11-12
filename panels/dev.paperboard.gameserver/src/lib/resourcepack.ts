import { serverBridge, serverVersion } from "./server";
import { CALLS } from "../service/contract";
import { searchProjects, type ModrinthHit } from "./modrinth";
import { RESOURCEPACK_PROJECT_TYPE, type ResourcePackSelection } from "../core/resourcepack";
import type { ResourcePackView } from "../service/resourcepack";
import type { ModrinthVersion } from "../core/modrinth";

export type { ModrinthHit, ModrinthVersion, ResourcePackSelection, ResourcePackView };

// Modrinth search runs in the page like the Datapacks tab's; reading,
// selecting and removing the pack belong to the service (service/resourcepack.ts).

export async function searchResourcePacks(query: string, signal?: AbortSignal): Promise<ModrinthHit[]> {
    const mcVersion = serverVersion();
    if (!mcVersion) throw new Error("Choose a server version before browsing resource packs.");
    return searchProjects({
        query,
        signal,
        facets: [[`project_type:${RESOURCEPACK_PROJECT_TYPE}`], [`versions:${mcVersion}`]],
    });
}

export const readResourcePack = () => serverBridge.call<ResourcePackView>(CALLS.readResourcePack);

export const listResourcePackVersions = (projectId: string) =>
    serverBridge.call<ModrinthVersion[]>(CALLS.listResourcePackVersions, { projectId });

export const selectModrinthResourcePack = (projectId: string, versionId: string) =>
    serverBridge.call<ResourcePackSelection>(CALLS.selectResourcePack, { projectId, versionId });

export const selectCustomResourcePack = (url: string) =>
    serverBridge.call<ResourcePackSelection>(CALLS.selectResourcePack, { url });

export const removeResourcePack = () => serverBridge.call(CALLS.removeResourcePack);
