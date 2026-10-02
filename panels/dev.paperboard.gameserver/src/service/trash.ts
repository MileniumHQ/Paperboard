import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { isListableDirArg } from "../core/dirs";

// Recoverable removal for worlds, world reset, plugins and player data.
// Each source is renamed into a retained `.trash-<ts>` directory inside the
// server folder, keeping its relative path (plugins/x.jar and mods/x.jar
// cannot collide). Nothing is recursively deleted; the trash directory is
// the recovery point.
//
// This runs in the panel service, which the daemon starts on the computer
// that owns the server folder, so the move is a plain filesystem rename on
// that machine. It replaced a command typed into a temporary terminal,
// which depended on a working pty, the shell's quoting and echo, and
// scraping a success marker from the output; on Windows any one of those
// failing left the move undone with no reason given.
//
// A missing path is skipped (a world may have no _nether/_the_end until
// those dimensions are entered). A path that exists but cannot be moved
// stops the removal: entries already moved stay in the trash directory and
// the rest stay in place.

export interface TrashFs {
    mkdir(path: string, opts: { recursive: true }): Promise<unknown>;
    rename(from: string, to: string): Promise<void>;
    lstat(path: string): Promise<unknown>;
}

export interface TrashRemoveDeps {
    getServerDir: () => Promise<string>;
    /** filesystem of the server's computer; tests inject failures */
    fs?: TrashFs;
}

const TRASH_DIR_PATTERN = /^\.trash-[A-Za-z0-9-]+$/;

export function trashDirName(stamp: number = Date.now()): string {
    return `.trash-${stamp}`;
}

function errorCode(err: unknown): string | undefined {
    return (err as { code?: string } | null)?.code;
}

function describeMoveFailure(relative: string, err: unknown): string {
    const code = errorCode(err);
    // Windows refuses to move a file another process holds open, which is
    // what a running server does to its plugin jars and world files
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
        return `"${relative}" is in use or not writable; stop the server and try again`;
    }
    const message = err instanceof Error ? err.message : String(err);
    return `"${relative}" could not be moved: ${message}`;
}

export async function trashRemovePathsWith(
    deps: TrashRemoveDeps,
    paths: string[],
    trashDir: string = trashDirName(),
): Promise<void> {
    if (paths.length === 0) {
        throw new Error("Refusing to run a trash-remove with no paths");
    }
    // boundary: every path is a relative chain of safe segments inside the
    // server folder; anything else is refused before the disk is touched
    if (!TRASH_DIR_PATTERN.test(trashDir)) {
        throw new Error(`Refusing unsafe trash directory: ${JSON.stringify(trashDir)}`);
    }
    for (const relative of paths) {
        if (relative === "" || !isListableDirArg(relative)) {
            throw new Error(`Refusing to trash unsafe path: ${JSON.stringify(relative)}`);
        }
    }
    const fs = deps.fs ?? nodeFs;
    const root = await deps.getServerDir();
    const inRoot = (relative: string) => nodePath.join(root, ...relative.split("/"));
    const trashRoot = inRoot(trashDir);

    const moved: string[] = [];
    for (const relative of paths) {
        const source = inRoot(relative);
        try {
            await fs.lstat(source);
        } catch (err) {
            if (errorCode(err) === "ENOENT") continue;
            throw new Error(describeMoveFailure(relative, err));
        }
        const target = nodePath.join(trashRoot, ...relative.split("/"));
        try {
            await fs.mkdir(nodePath.dirname(target), { recursive: true });
            await fs.rename(source, target);
        } catch (err) {
            const reason = describeMoveFailure(relative, err);
            throw new Error(
                moved.length > 0
                    ? `${reason}. Already removed items are kept in "${trashDir}" in the server folder`
                    : reason,
            );
        }
        moved.push(relative);
    }
}
