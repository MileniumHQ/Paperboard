import { WORLD_TRANSFER_DIR } from "./worldArchive";

// Add-ons the user uploads from disk. The page copies the picked files into
// a staging folder of the server folder; the service checks every one and
// moves it into place, or refuses with a message that names the file. These
// are the rules, pure: service/addonUploads.ts moves the bytes.

/** the staged upload: .paperboard-transfer/addon-<stage>/ */
const STAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function addonStageDir(stage: unknown): string {
    if (typeof stage !== "string" || !STAGE_ID.test(stage)) throw new Error("That is not an upload Paperboard started");
    return `${WORLD_TRANSFER_DIR}/addon-${stage}`;
}

/** which paths the user uploaded, keyed by path below the server folder */
export const UPLOAD_RECORDS_KEY = "addonUploads";

export interface UploadRecord {
    /** when it was added, ms since the epoch */
    at: number;
}

export function parseUploadRecords(raw: unknown): Record<string, UploadRecord> {
    if (typeof raw !== "object" || raw === null) return {};
    const records: Record<string, UploadRecord> = {};
    for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
        const at = (value as { at?: unknown } | null)?.at;
        if (typeof at === "number" && Number.isFinite(at)) records[path] = { at };
    }
    return records;
}

/** an uploaded archive larger than this is refused, as is a Modrinth modpack's */
export const MAX_UPLOAD_ARCHIVE_BYTES = 256 * 1024 * 1024;
/** how many add-ons one upload may carry */
export const MAX_UPLOAD_ITEMS = 200;

export type ArchiveKind = "plugin" | "mod" | "datapack";

/** The file that makes an archive this kind of add-on, any one of them at the archive's top. */
export const ARCHIVE_MARKERS: Record<ArchiveKind, readonly string[]> = {
    plugin: ["plugin.yml", "paper-plugin.yml"],
    mod: ["fabric.mod.json", "META-INF/mods.toml", "META-INF/neoforge.mods.toml"],
    datapack: ["pack.mcmeta"],
};

const NOUN: Record<ArchiveKind, string> = { plugin: "a plugin", mod: "a mod", datapack: "a datapack" };

/** An entry name that would leave the folder it unpacks into, or that no OS accepts. */
export function unsafeEntryName(name: string): boolean {
    return (
        name.startsWith("/") ||
        name.includes("\\") ||
        name.includes("\0") ||
        /^[A-Za-z]:/.test(name) ||
        name.split("/").includes("..")
    );
}

/**
 * Why an archive with these entry names is not an add-on of `kind`, or null.
 * `label` is how the message names it (the uploaded file's name).
 */
export function archiveProblem(entryNames: readonly string[], kind: ArchiveKind, label: string): string | null {
    const unsafe = entryNames.find(unsafeEntryName);
    if (unsafe !== undefined) return `${label} holds a path that leaves its folder (${JSON.stringify(unsafe)}), so it was not added.`;
    const markers = ARCHIVE_MARKERS[kind];
    if (entryNames.some((name) => markers.includes(name))) return null;
    const list = markers.length === 1 ? markers[0]! : `${markers.slice(0, -1).join(", ")} or ${markers.at(-1)}`;
    // a datapack zipped as its folder is the usual slip: the marker is one level down
    const nested = entryNames.find((name) => markers.some((marker) => name.split("/").length === 2 && name.endsWith(`/${marker}`)));
    const hint = nested ? ` ${markers[0]} is inside "${nested.split("/")[0]}/"; zip the folder's contents, not the folder.` : "";
    return `${label} is not ${NOUN[kind]}: it has no ${list} at its top.${hint}`;
}
