// Directory-argument validation for the panel-owned filesystem helpers.
// Pure and testable: the lister must accept the panel root ("") as well as
// a relative path of safe segments (worlds live under nested directories
// like "world/dimensions/minecraft/overworld/region"), and refuse
// traversal, absolute paths and empty segments before they can reach a
// shell-adjacent command.
//
// The previous guard accepted only a single segment and rejected "" —
// which silently made the server-root listing return nothing, so the world
// manager could never see a world.

// only these characters may reach a path or shell command. `+` is included
// because Modrinth jar names commonly contain it (e.g. "voicechat-...+26.2.jar")
// and paths are never shell-interpolated (execFile/argv throughout).
const ENTRY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ ()+-]*$/;

export function isValidEntryName(name: string): boolean {
    return ENTRY_NAME_PATTERN.test(name) && !name.includes("..");
}

// "" is the panel's server directory; anything else must be `/`-joined
// safe segments. Empty segments ("a//b"), leading/trailing slashes, "..",
// backslashes and non-strings are all refused here, at the boundary.
export function isListableDirArg(dir: unknown): dir is string {
    if (typeof dir !== "string") return false;
    if (dir === "") return true;
    return dir
        .split("/")
        .every((segment) => segment !== "" && isValidEntryName(segment));
}

/**
 * The argv for listing one directory on Windows. The lister feeds logs,
 * plugin jars and player-stat files, so it must return FILES as well as
 * folders: `/a:d` lists only directories and hid every file from the UI.
 * `-l` drops reparse points (symlink loops), `-h` drops hidden entries.
 */
export function windowsDirArgs(absoluteDir: string): string[] {
    return ["/c", "dir", "/b", "/a:-l-h", absoluteDir];
}
