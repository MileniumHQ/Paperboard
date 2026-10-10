import { isValidEntryName } from "./dirs";
import type { ModrinthFile, ModrinthVersion } from "./modrinth";

// Datapacks live in the active world's `datapacks/` folder, as .zip files
// or unpacked folders. The Datapacks tab installs Modrinth's datapack
// builds there (Modrinth lists them under the "datapack" loader) and keeps
// one display record per installed file.

export const DATAPACK_RECORDS_KEY = "datapackInstalls";
export const DATAPACK_LOADER = "datapack";

export interface DatapackRecord {
    projectId: string;
    slug: string;
    title: string;
    version: string;
    iconUrl?: string;
}

/** Records keyed "<world>/<file name>": the same pack in two worlds is two installs. */
export type DatapackRecords = Record<string, DatapackRecord>;

export function datapackRecordKey(world: string, name: string): string {
    return `${world}/${name}`;
}

function isRecord(value: unknown): value is DatapackRecord {
    if (typeof value !== "object" || value === null) return false;
    const rec = value as Record<string, unknown>;
    return (
        typeof rec.projectId === "string" &&
        typeof rec.slug === "string" &&
        typeof rec.title === "string" &&
        typeof rec.version === "string" &&
        (rec.iconUrl === undefined || typeof rec.iconUrl === "string")
    );
}

export function parseDatapackRecords(raw: unknown): DatapackRecords {
    if (typeof raw !== "object" || raw === null) return {};
    const records: DatapackRecords = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (isRecord(value)) records[key] = value;
    }
    return records;
}

/** A datapacks/ entry Paperboard may name, install or remove. */
export function assertDatapackName(name: unknown): string {
    if (typeof name !== "string" || !isValidEntryName(name)) {
        throw new Error(`Not a datapack name Paperboard can use: ${JSON.stringify(name)}`);
    }
    return name;
}

/**
 * The build to install for a Minecraft version: the requested version when
 * given, else the newest. Either way it must be a datapack build for this
 * exact Minecraft version with a verifiable .zip: a pack built for another
 * version's pack format fails to load or loads wrong, so there is no
 * cross-version fallback.
 */
export function pickDatapackBuild(
    versions: readonly ModrinthVersion[],
    mcVersion: string,
    versionId?: string,
): { version: ModrinthVersion; file: ModrinthFile } {
    const candidates = versionId ? versions.filter((v) => v.id === versionId) : versions;
    if (versionId && candidates.length === 0) {
        throw new Error("That datapack version is not available for this server");
    }
    for (const version of candidates) {
        if (!version.loaders.includes(DATAPACK_LOADER) || !version.gameVersions.includes(mcVersion)) continue;
        const file = version.primary;
        if (!file || !file.filename.toLowerCase().endsWith(".zip")) continue;
        assertDatapackName(file.filename);
        return { version, file };
    }
    throw new Error(`This datapack has no build for Minecraft ${mcVersion}`);
}
