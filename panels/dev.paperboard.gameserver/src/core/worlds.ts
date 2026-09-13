import { trashRemovePathsWith, type TrashRemoveDeps } from "./trash";

export const WORLD_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// shell-safe level names for DELETION: single-quoteable on posix (only '
// is unsafe there) and double-quoteable on Windows (only " and % are
// unsafe there — cmd expands %VAR% inside quotes). Creation stays on the
// stricter WORLD_NAME_PATTERN; an exotic-but-valid level-name refuses
// loudly instead of deleting the wrong directory.
export const SHELL_SAFE_LEVEL_NAME = /^[A-Za-z0-9][A-Za-z0-9 _().-]{0,63}$/;

export function assertShellSafeLevelName(levelName: unknown): string {
    const safe = String(levelName ?? "").trim();
    if (
        !SHELL_SAFE_LEVEL_NAME.test(safe) ||
        safe.includes("..") ||
        safe.includes("/") ||
        safe.includes("\\")
    ) {
        throw new Error(`Refusing to delete unsafe world name: ${JSON.stringify(levelName)}`);
    }
    return safe;
}

// names reach shell commands, so stricter than the entry pattern
export function getWorldDirsToDelete(levelName: string): string[] {
    const safe = assertShellSafeLevelName(levelName);
    return [safe, `${safe}_nether`, `${safe}_the_end`];
}

export interface WorldListDeps {
    entries: string[];
    sanitize: (name: string) => string | null;
    exists: (path: string) => Promise<boolean>;
    onError?: (filename: string, err: unknown) => void;
}

// a directory is a world if it contains level.dat
export async function collectWorldDirs(deps: WorldListDeps): Promise<string[]> {
    const { entries, sanitize, exists, onError } = deps;
    const worlds: string[] = [];
    for (const entry of entries) {
        const safe = sanitize(entry);
        if (!safe) continue;
        try {
            if (await exists(`${safe}/level.dat`)) {
                worlds.push(safe);
            }
        } catch (err) {
            onError?.(safe, err);
        }
    }
    return worlds.sort((a, b) => a.localeCompare(b));
}

export interface WorldDeleteDeps extends TrashRemoveDeps {}

// deletes <level>, <level>_nether and <level>_the_end via a short-lived
// pty — trash first, then remove (see core/trash.ts), never a bare rm
export async function deleteWorldDirs(
    levelName: string,
    deps: WorldDeleteDeps,
): Promise<void> {
    const dirs = getWorldDirsToDelete(levelName);
    await trashRemovePathsWith(deps, dirs, "delete-world-pty");
}
