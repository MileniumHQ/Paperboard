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
export function releaseFor(version: string) {
    const release = releases.find(r => r.version === version);
    if (!release) throw new Error(`Terraria ${version} is not in the verified release catalog`);
    return release;
}
export function entrypoint(os: string): string {
    switch (os) {
        case "linux": return "Linux/TerrariaServer.bin.x86_64";
        case "win32": return "Windows/TerrariaServer.exe";
        case "darwin": return "Mac/Terraria Server.app/Contents/MacOS/TerrariaServer.bin.osx";
        default: throw new Error(`Unsupported Terraria OS: ${os}`);
    }
}
