/** Publisher API /api/get/dedicated-servers-names checked 2026-10-30.
 * No publisher checksum is supplied: hashes are pinned from operator downloads,
 * never learned from the same download being installed. Add releases explicitly.
 */
export const releases = [{
    version: "1.4.5.8", directory: "1458",
    url: "https://terraria.org/api/download/pc-dedicated-server/terraria-server-1458.zip",
    size: 46415317,
    sha256: "f513a4ac9789d34af766291ae217c9cd7d9472e13782a0e2b17512f70d7a8334",
}] as const;

/** tModLoader's GitHub releases, checked 2026-10-30. GitHub's asset digest
 * matched the operator's own download. `terraria` is the Terraria build the
 * release is made from: its log's first line, "Starting tModLoader server
 * <terraria>+<version>" (a Terraria_v… file name it looks for is not it).
 * `runtime` is the Origami .NET package it runs on.
 */
export const tmodloaderReleases = [{
    version: "2026.08.3.0", terraria: "1.4.4.9", directory: "tmodloader-2026.08.3.0", runtime: "dotnet-8",
    url: "https://github.com/tModLoader/tModLoader/releases/download/v2026.08.3.0/tModLoader.zip",
    size: 61142677,
    sha256: "61e865f3702b12ce4a26c5a90b9de99a12c65ffc228455eb3390ce54af1eab15",
}] as const;

export type TerrariaSoftware = "vanilla" | "tmodloader";
export const SOFTWARE: readonly TerrariaSoftware[] = ["vanilla", "tmodloader"];
export function terrariaSoftware(value: unknown): TerrariaSoftware {
    if (value === "vanilla" || value === "tmodloader") return value;
    throw new Error(`Unsupported Terraria software: ${String(value)}`);
}
export const softwareName = (software: TerrariaSoftware) => (software === "tmodloader" ? "tModLoader" : "Vanilla");

export function releaseFor(version: string) {
    const release = releases.find(r => r.version === version);
    if (!release) throw new Error(`Terraria ${version} is not in the verified release catalog`);
    return release;
}
export function tmodloaderReleaseFor(version: string) {
    const release = tmodloaderReleases.find(r => r.version === version);
    if (!release) throw new Error(`tModLoader ${version} is not in the verified release catalog`);
    return release;
}
/** The pinned archive a server of this software and version installs. */
export function archiveFor(software: TerrariaSoftware, version: string): { version: string; directory: string; url: string; size: number; sha256: string } {
    return software === "tmodloader" ? tmodloaderReleaseFor(version) : releaseFor(version);
}
/** Every release folder Paperboard can have installed, for recovery after an interrupted swap. */
export const installDirectories = (): string[] => [...releases, ...tmodloaderReleases].map(r => r.directory);

export function entrypoint(os: string): string {
    switch (os) {
        case "linux": return "Linux/TerrariaServer.bin.x86_64";
        case "win32": return "Windows/TerrariaServer.exe";
        case "darwin": return "Mac/Terraria Server.app/Contents/MacOS/TerrariaServer.bin.osx";
        default: throw new Error(`Unsupported Terraria OS: ${os}`);
    }
}
/** tModLoader runs as `dotnet tModLoader.dll`; this is the file every install must have. */
export const TMODLOADER_ENTRYPOINT = "tModLoader.dll";
