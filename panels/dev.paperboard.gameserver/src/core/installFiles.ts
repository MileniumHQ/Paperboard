import { isValidEntryName } from "./dirs";

// The user's server, never an install artifact. An installer that produces
// one of these is refused, and no recorded install may claim one, so a
// later software switch can never delete a world or the user's settings.
const PROTECTED_ENTRIES = new Set([
    "config",
    "mods",
    "plugins",
    "logs",
    "crash-reports",
    "world",
    "world_nether",
    "world_the_end",
    "server.properties",
    "eula.txt",
    "ops.json",
    "whitelist.json",
    "banned-players.json",
    "banned-ips.json",
    "usercache.json",
]);

/** A top-level server-folder entry an install may own and later remove. */
export function isInstallArtifactName(name: unknown): name is string {
    return (
        typeof name === "string" &&
        isValidEntryName(name) &&
        !PROTECTED_ENTRIES.has(name.toLowerCase())
    );
}
