import { javaPackageFor } from "./versionProfile";
import { SOFTWARE, SOFTWARE_IDS, type ServerSoftwareType } from "../software/catalog";
import type { VersionItem } from "../software/types";

// UI-facing entry points over the software catalog (src/software). The
// catalog owns the list of softwares; nothing here enumerates them.
export type { ServerSoftwareType, VersionItem };
export { SOFTWARE, SOFTWARE_IDS };

export const SOFTWARE_NAMES: Readonly<Record<ServerSoftwareType, string>> = Object.fromEntries(
    SOFTWARE_IDS.map((id) => [id, SOFTWARE[id].name]),
) as Record<ServerSoftwareType, string>;

// null when version missing or unparseable. The thresholds live in
// versionProfile's override table; this is the one entry point the installer
// and lifecycle use.
export function getRequiredJavaVersion(mcVersion: string): string | null {
    return javaPackageFor(mcVersion);
}
