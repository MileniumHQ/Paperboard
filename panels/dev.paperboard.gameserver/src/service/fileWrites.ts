// How the service edits a file the server reads: one edit at a time per
// file, each written whole by PaperAPI's writeFileAtomic. The Loader tab and
// the Files tab both edit server files, so both go through here.

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
