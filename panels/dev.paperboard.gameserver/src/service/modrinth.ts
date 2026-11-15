import { MODRINTH_API, type RawModrinthVersion } from "../core/modrinth";

/** A project's version records on Modrinth for these loaders (and Minecraft versions); an answer that is no list throws. */
export async function modrinthVersions<T = RawModrinthVersion>(
    fetchJson: <R>(url: string) => Promise<R>,
    projectId: string,
    filters: { loaders: string[]; gameVersions?: string[] },
): Promise<T[]> {
    const query = new URLSearchParams({
        loaders: JSON.stringify(filters.loaders),
        ...(filters.gameVersions ? { game_versions: JSON.stringify(filters.gameVersions) } : {}),
        include_changelog: "false",
    });
    const raw = await fetchJson<unknown>(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${query}`);
    if (!Array.isArray(raw)) throw new Error("Modrinth returned no version list");
    return raw as T[];
}
