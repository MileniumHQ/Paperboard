// How the service replaces a file the server reads: one write at a time per
// file, and each write lands whole or not at all. The Loader tab and the
// Files tab both edit server files, so both go through here.

export interface AtomicWriteFs {
    writeFile(path: string, data: string | Uint8Array): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    rm(path: string, opts: { force: true }): Promise<void>;
    chmod?(path: string, mode: number): Promise<void>;
}

// one write at a time per file: two quick edits must not both read the
// old text and the second overwrite the first
const fileQueues = new Map<string, Promise<unknown>>();

export function serializedFileTask<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = fileQueues.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(
        () => undefined,
        () => undefined,
    );
    fileQueues.set(key, settled);
    void settled.then(() => {
        if (fileQueues.get(key) === settled) fileQueues.delete(key);
    });
    return run;
}

/** files queued or being written right now (for tests: the map must drain) */
export function pendingFileTasks(): number {
    return fileQueues.size;
}

/**
 * Replaces `absolute` with `data` through a temp file and a rename, so the
 * server never reads half a file. `mode` keeps the old file's permissions
 * (a start script stays executable).
 */
export async function writeFileAtomic(
    fs: AtomicWriteFs,
    absolute: string,
    data: string | Uint8Array,
    mode?: number,
): Promise<void> {
    const temp = `${absolute}.paperboard-tmp`;
    try {
        await fs.writeFile(temp, data);
        if (mode !== undefined && fs.chmod) await fs.chmod(temp, mode & 0o7777);
        await fs.rename(temp, absolute);
    } catch (err) {
        // the write's failure is what the caller gets; a leftover temp
        // file is only logged so it cannot replace that error
        await fs.rm(temp, { force: true }).catch((cleanupErr) =>
            console.error("[Service:Files] could not remove", temp, String(cleanupErr)),
        );
        throw err;
    }
}
