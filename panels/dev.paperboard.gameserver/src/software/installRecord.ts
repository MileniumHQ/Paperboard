import { isInstallArtifactName } from "../core/installFiles";
import { isServerSoftware, type ServerSoftwareType } from "./catalog";
import { DEFAULT_LAUNCH, parseLaunchSpec, type LaunchSpec } from "./launch";

// What the last successful install put in the server folder, written to
// panel config by the install action alone. Lifecycle launches from it and
// the next install removes exactly its files.

export const INSTALL_RECORD_KEY = "install";

/** config keys only the install action writes */
export const INSTALL_OWNED_CONFIG_KEYS = ["software", "version", INSTALL_RECORD_KEY] as const;

export interface InstallRecord {
    software: ServerSoftwareType;
    version: string;
    build: string | null;
    launch: LaunchSpec;
    /** top-level server-folder entries this install created */
    files: string[];
    /** the staging directory that activated it, for crash recovery */
    staging: string;
}

/** Null when absent; throws when present but not something this panel wrote. */
export function parseInstallRecord(raw: unknown): InstallRecord | null {
    if (raw === undefined || raw === null) return null;
    const record = raw as Record<string, unknown>;
    const launch = parseLaunchSpec(record.launch);
    const files = record.files;
    if (
        typeof raw !== "object" ||
        !isServerSoftware(record.software) ||
        typeof record.version !== "string" ||
        !(record.build === null || typeof record.build === "string") ||
        !launch ||
        !Array.isArray(files) ||
        !files.every((name) => isInstallArtifactName(name)) ||
        typeof record.staging !== "string"
    ) {
        throw new Error("The recorded server install is unreadable; reinstall the server software from Versions");
    }
    return {
        software: record.software,
        version: record.version,
        build: record.build as string | null,
        launch,
        files: files as string[],
        staging: record.staging,
    };
}

/**
 * The launch and owned files of whatever is installed. Installs from before
 * the record existed only ever wrote server.jar and launched it with -jar,
 * so a config without a record describes exactly that.
 */
export function currentInstall(config: Record<string, unknown> | null | undefined): {
    record: InstallRecord | null;
    launch: LaunchSpec;
    files: string[];
} {
    const record = parseInstallRecord(config?.[INSTALL_RECORD_KEY]);
    if (record) return { record, launch: record.launch, files: record.files };
    return { record: null, launch: DEFAULT_LAUNCH, files: ["server.jar"] };
}
