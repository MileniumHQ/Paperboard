import { serverVersion } from "./server";
import { searchProjects, type ModrinthHit } from "./modrinth";
import { RESOURCEPACK_PROJECT_TYPE, type ResourcePackSelection } from "../core/resourcepack";
import type { ResourcePackView } from "../service/resourcepack";
import type { ModrinthVersion } from "../core/modrinth";
import { serverCalls } from "./api";

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

export const readResourcePack = () => serverCalls.readResourcePack();

export const listResourcePackVersions = (projectId: string) =>
    serverCalls.listResourcePackVersions({ projectId });

export const selectModrinthResourcePack = (projectId: string, versionId: string) =>
    serverCalls.selectResourcePack({ projectId, versionId });

export const selectCustomResourcePack = (url: string) =>
    serverCalls.selectResourcePack({ url });

export const removeResourcePack = () => serverCalls.removeResourcePack();
