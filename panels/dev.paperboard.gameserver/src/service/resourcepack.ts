import { createHash } from "node:crypto";
import {
    RESOURCEPACK_MAX_BYTES,
    RESOURCEPACK_PROJECT_TYPE,
    RESOURCEPACK_SELECTION_KEY,
    assertResourcePackUrl,
    parseResourcePackSelection,
    pickResourcePackBuild,
    resourcePackProperties,
    selectionFor,
    type ResourcePackSelection,
} from "../core/resourcepack";
import {
    MODRINTH_API,
    assertModrinthId,
    parseModrinthProject,
    parseModrinthVersion,
    type ModrinthVersion,
    type RawModrinthProject,
    type RawModrinthVersion,
} from "../core/modrinth";

// The Resource Pack tab's owner: lists a Modrinth resource pack's builds,
// points server.properties at one (URL and sha1 from Modrinth's own record)
// or at a pasted URL (hashed here by downloading it), and remembers what
// was picked. The page names a project and version, or a URL; the URL and
// hash written for a Modrinth pick are never the page's.

export interface ResourcePackDeps {
    fetchJson<T>(url: string): Promise<T>;
    /** a plain GET of a pack the user pointed at; the caller checks the status */
    fetchPack(url: string): Promise<Response>;
    readProperties(): Promise<Record<string, string>>;
    /** merges the given keys into server.properties and writes it */
    writeProperties(values: Record<string, string>): Promise<void>;
    readConfig(): Promise<Record<string, unknown>>;
    writeConfig(patch: Record<string, unknown>): Promise<void>;
}

export interface ResourcePackView {
    url: string;
    sha1: string;
    /** what the tab remembers about the pack at `url`, if it picked it */
    selection: ResourcePackSelection | null;
}

export async function readResourcePack(deps: Pick<ResourcePackDeps, "readProperties" | "readConfig">): Promise<ResourcePackView> {
    const properties = await deps.readProperties();
    const saved = parseResourcePackSelection((await deps.readConfig())[RESOURCEPACK_SELECTION_KEY]);
    return {
        url: properties["resource-pack"] ?? "",
        sha1: properties["resource-pack-sha1"] ?? "",
        selection: selectionFor(saved, properties),
    };
}

export async function listResourcePackVersions(
    projectId: unknown,
    mcVersion: string,
    deps: Pick<ResourcePackDeps, "fetchJson">,
): Promise<ModrinthVersion[]> {
    const id = assertModrinthId(projectId, "Project");
    if (!mcVersion) throw new Error("Choose a server version before picking a resource pack.");
    // no loader filter: resource packs list "minecraft" (and "iris"/"optifine"
    // for shader-aware builds), all of which the vanilla client loads
    const query = new URLSearchParams({
        game_versions: JSON.stringify([mcVersion]),
        include_changelog: "false",
    });
    const raw = await deps.fetchJson<RawModrinthVersion[]>(
        `${MODRINTH_API}/project/${encodeURIComponent(id)}/version?${query}`,
    );
    if (!Array.isArray(raw)) throw new Error("Modrinth returned no version list");
    return raw.map(parseModrinthVersion).filter((v): v is ModrinthVersion => v !== null);
}

// the record first: a record that outlives a failed properties write names a
// URL the file does not hold and is ignored, while the reverse would leave a
// pack the tab cannot name
async function apply(deps: ResourcePackDeps, selection: ResourcePackSelection): Promise<void> {
    const values = resourcePackProperties(selection);
    await deps.writeConfig({ [RESOURCEPACK_SELECTION_KEY]: selection });
    await deps.writeProperties(values);
}

export async function selectModrinthResourcePack(
    input: { projectId: unknown; versionId?: unknown },
    mcVersion: string,
    deps: ResourcePackDeps,
): Promise<ResourcePackSelection> {
    const projectId = assertModrinthId(input.projectId, "Project");
    const versionId =
        input.versionId === undefined || input.versionId === "" ? undefined : assertModrinthId(input.versionId, "Version");
    const versions = await listResourcePackVersions(projectId, mcVersion, deps);
    const { version, file } = pickResourcePackBuild(versions, mcVersion, versionId);
    if (version.projectId !== projectId) throw new Error("Modrinth answered with a different project's version");
    const project = parseModrinthProject(
        await deps.fetchJson<RawModrinthProject>(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}`),
    );
    if (project.projectId !== projectId) throw new Error("Modrinth answered with a different project");
    if (project.projectType !== RESOURCEPACK_PROJECT_TYPE) {
        throw new Error(`${project.title} is a Modrinth ${project.projectType || "project"}, not a resource pack`);
    }
    const selection: ResourcePackSelection = {
        source: "modrinth",
        url: file.url,
        sha1: file.sha1,
        projectId,
        slug: project.slug,
        title: project.title,
        version: version.versionNumber,
        versionId: version.id,
        ...(project.iconUrl ? { iconUrl: project.iconUrl } : {}),
    };
    await apply(deps, selection);
    return selection;
}

// "PK\x03\x04": a share page or a login wall answers 200 with HTML, and
// hashing that would hand clients a pack that is not one
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/** Downloads the pack at `url`, up to the server's size limit, and returns the sha1 of its bytes. */
export async function hashResourcePack(url: string, deps: Pick<ResourcePackDeps, "fetchPack">): Promise<{ sha1: string; size: number }> {
    const res = await deps.fetchPack(url);
    const cancel = () => res.body?.cancel().catch((err) => console.debug("[Service:ResourcePack] body cancel failed:", String(err)));
    if (!res.ok) {
        cancel();
        throw new Error(`${new URL(url).host} answered HTTP ${res.status} for the resource pack`);
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > RESOURCEPACK_MAX_BYTES) {
        cancel();
        throw new Error(`The resource pack is ${declared} bytes; servers accept at most ${RESOURCEPACK_MAX_BYTES}`);
    }
    if (!res.body) throw new Error("The resource pack download had no body");
    const hash = createHash("sha1");
    const reader = res.body.getReader();
    const head: number[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > RESOURCEPACK_MAX_BYTES) {
            await reader.cancel();
            throw new Error(`The resource pack is over ${RESOURCEPACK_MAX_BYTES} bytes; servers accept at most that`);
        }
        for (let i = 0; head.length < ZIP_MAGIC.length && i < value.byteLength; i++) head.push(value[i]);
        hash.update(value);
    }
    if (head.length < ZIP_MAGIC.length || ZIP_MAGIC.some((byte, i) => head[i] !== byte)) {
        throw new Error("That URL did not return a zip file. Use the pack's direct download link.");
    }
    return { sha1: hash.digest("hex"), size };
}

export async function selectCustomResourcePack(input: { url: unknown }, deps: ResourcePackDeps): Promise<ResourcePackSelection> {
    const url = assertResourcePackUrl(input.url);
    const { sha1 } = await hashResourcePack(url, deps);
    const selection: ResourcePackSelection = { source: "custom", url, sha1 };
    await apply(deps, selection);
    return selection;
}

export async function removeResourcePack(deps: Pick<ResourcePackDeps, "writeConfig" | "writeProperties">): Promise<void> {
    await deps.writeConfig({ [RESOURCEPACK_SELECTION_KEY]: null });
    await deps.writeProperties(resourcePackProperties(null));
}
