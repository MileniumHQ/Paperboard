import { isWindowsTarget } from "../lib/platform";

export const WORLD_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// names reach shell commands, so stricter than the entry pattern
export function getWorldDirsToDelete(levelName: string): string[] {
    const safe = levelName.trim();
    if (!WORLD_NAME_PATTERN.test(safe)) {
        throw new Error(`Refusing to delete unsafe world name: "${levelName}"`);
    }
    return [safe, `${safe}_nether`, `${safe}_the_end`];
}

export function buildDeleteWorldCommand(dirs: string[], isWin: boolean): string {
    return isWin
        ? `rmdir /s /q ${dirs.join(" ")} 2>nul || exit 0`
        : `rm -rf ${dirs.join(" ")}`;
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

export interface WorldDeleteDeps {
    getServerDir: () => Promise<string>;
    getTargetOs: () => Promise<string>;
    createPty: (id: string, opts: { cwd: string; cols: number; rows: number }) => unknown;
    writePty: (id: string, data: string) => void;
    scheduleDestroy: (id: string) => void;
}

// deletes <level>, <level>_nether and <level>_the_end via a short-lived pty
export async function deleteWorldDirs(
    levelName: string,
    deps: WorldDeleteDeps,
): Promise<void> {
    const dirs = getWorldDirsToDelete(levelName);
    const serverDir = await deps.getServerDir();
    const targetOs = await deps.getTargetOs();
    const isWin = isWindowsTarget(serverDir, targetOs);
    const deleteCmd = buildDeleteWorldCommand(dirs, isWin);

    await deps.createPty("delete-world-pty", { cwd: serverDir, cols: 80, rows: 24 });
    deps.writePty("delete-world-pty", `${deleteCmd}\nexit\n`);
    deps.scheduleDestroy("delete-world-pty");
}
