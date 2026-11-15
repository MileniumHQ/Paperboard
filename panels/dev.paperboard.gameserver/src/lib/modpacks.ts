import { minecraftSoftware } from "../games/minecraft/index";
import { serverSoftware } from "./server";
import { serverCalls } from "./api";
import { searchProjects, type ModrinthHit } from "./modrinth";
import { MODPACK_LOADER, type ModpackRecord } from "../core/modpack";
import type { ModpackInstallOutcome, ModrinthVersion } from "../service/contract";

export type { ModpackInstallOutcome, ModpackRecord, ModrinthHit, ModrinthVersion };

// Modrinth search runs in the page like the Mods tab's; reading, installing
// and removing the pack belong to the service (service/modpacks.ts).

export async function searchModpacks(query: string, signal?: AbortSignal): Promise<ModrinthHit[]> {
    const loader = MODPACK_LOADER[minecraftSoftware(serverSoftware())];
    if (!loader) return [];
    return searchProjects({
        query,
        signal,
        facets: [
            ["project_type:modpack"],
            [`categories:${loader.modrinth}`],
            ["server_side:required", "server_side:optional"],
        ],
        // the facet lets a few client-only packs through; they install nothing on a server
        keep: (hit) => hit.server_side !== "unsupported",
    });
}

export const readModpack = async () => serverCalls().readModpack();

export const listModpackVersions = async (projectId: string) => serverCalls().listModpackVersions({ projectId });

// downloading and placing a pack runs for minutes: the contract waits it out
// (progress arrives through state)
export const installModpack = async (projectId: string, versionId: string) => serverCalls().installModpack({ projectId, versionId });

export const removeModpack = async () => serverCalls().removeModpack();
