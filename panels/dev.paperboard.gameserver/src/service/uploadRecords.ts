import { UPLOAD_RECORDS_KEY, parseUploadRecords } from "../core/addonUpload";

// Which paths below the server folder the user uploaded, kept in the panel's
// config. Uploaded files have no Modrinth record; this is how the lists tell.

export interface UploadRecordDeps {
    readConfig(): Promise<Record<string, unknown>>;
    writeConfig(patch: Record<string, unknown>): Promise<void>;
}

// one records write at a time: two quick uploads must not both read the
// old records and the second drop the first's entries
let recordsQueue: Promise<unknown> = Promise.resolve();

/** Changes which paths are recorded as uploaded. */
export function updateUploadRecords(
    deps: UploadRecordDeps,
    change: (records: Record<string, { at: number }>) => void,
): Promise<void> {
    const run = recordsQueue.then(async () => {
        const records = parseUploadRecords((await deps.readConfig())[UPLOAD_RECORDS_KEY]);
        change(records);
        await deps.writeConfig({ [UPLOAD_RECORDS_KEY]: records });
    });
    recordsQueue = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}

/** Forgets that these paths (below the server folder) were uploaded; they are gone. */
export async function forgetUploads(deps: UploadRecordDeps, paths: string[]): Promise<void> {
    const records = parseUploadRecords((await deps.readConfig())[UPLOAD_RECORDS_KEY]);
    if (!paths.some((path) => path in records)) return;
    await updateUploadRecords(deps, (current) => {
        for (const path of paths) delete current[path];
    });
}

