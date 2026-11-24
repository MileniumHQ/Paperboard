// The daemon's backup service: making, listing, restoring and deleting a
// panel's backups at the location the user chose for it.
//
// A backup goes as far as the panel's service takes it, holding the
// panel's operation lock (installs and uninstalls wait):
// 1. beforeBackup stops what would write over the copy and names the files
// 2. the files are packed as they are; nothing is stopped by the daemon
// 3. afterBackup lets the panel carry on
// 4. the archive is uploaded, after the lock is released
//
// A restore downloads the archive, checks the size and sha256 its record
// names and the panel version that made it, then, holding the lock:
// beforeRestore stops what uses the files, they are swapped for the
// backup's (restore.ts), and afterRestore hands the panel its data back.
// When afterRestore fails, the files go back and it hears the failure.
import * as fs from "fs";
import * as path from "path";
import type { PaperCraneEngine } from "../engine/index";
import { invalidParams } from "../rpc/errors";
import { hashFile } from "../core/storage";
import { logger } from "../core/logger";
import { createBackupArchive, extractBackupArchive, type ArchiveContents } from "./archive";
import { BackupLocations, conflict, notFound } from "./locations";
import { recoverRestores, swapIn } from "./restore";
import { GOOGLE_ENDPOINTS, type DriveEndpoints } from "./driveStore";
import { BACKUP_ID_RE, MAX_BACKUP_PATHS, newBackupId, type BackupProgress, type BackupProgressChange, type BackupRecord, type BackupStep, type BackupStore } from "./types";
import { isBackupPath } from "@mileniumhq/paperapi/backups";
import { BACKUP_LABEL_MAX } from "@mileniumhq/paperapi/protocol";
import { errorMessage } from "@mileniumhq/paperapi/errors";
import type { BackupLocation } from "@mileniumhq/paperapi/backups";

/** byte counts reach listeners at most this often; a new step at once */
export const PROGRESS_INTERVAL_MS = 250;

/** a record is kept beside its archive, and in Google Drive as its description */
const RECORD_MAX_BYTES = 8 * 1024;

function versionParts(v: string): [number, number, number] | null {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** true when a backup from version `made` should not go onto `installed` */
export function isNewerVersion(made: string | null, installed: string | null): boolean {
    if (made === null || installed === null || made === installed) return false;
    const a = versionParts(made);
    const b = versionParts(installed);
    // versions that cannot be compared are not assumed safe
    if (!a || !b) return true;
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
}

/** what beforeBackup answered, checked: the panel names its own files, but only its own */
export function backupContents(answer: unknown): ArchiveContents {
    const refuse = (why: string) => new Error(`The panel's beforeBackup answered something that is not a backup's contents: ${why}`);
    if (!answer || typeof answer !== "object") throw refuse("it is not an object");
    const { paths, exclude = [], skip = [], data = null } = answer as Record<string, unknown>;
    const list = (value: unknown, name: string): string[] => {
        if (!Array.isArray(value) || value.length > MAX_BACKUP_PATHS) throw refuse(`${name} must list at most ${MAX_BACKUP_PATHS} paths`);
        for (const entry of value) if (!isBackupPath(entry)) throw refuse(`${JSON.stringify(entry)} in ${name} is not a path in the panel's storage`);
        if (new Set(value).size !== value.length) throw refuse(`${name} lists a path twice`);
        return value as string[];
    };
    const inside = (child: string, parent: string) => parent === "" || child.startsWith(`${parent}/`);
    const named = list(paths, "paths");
    for (const a of named) for (const b of named) if (a !== b && inside(a, b)) throw refuse(`${a} is inside ${b === "" ? "the whole storage" : b}, which it also names`);
    const left = list(exclude, "exclude");
    for (const e of left) if (e === "" || !named.some((p) => inside(e, p))) throw refuse(`${JSON.stringify(e)} in exclude is not under one of its paths`);
    if (!Array.isArray(skip) || skip.length > MAX_BACKUP_PATHS || skip.some((n) => typeof n !== "string" || !isBackupPath(n) || n === "" || n.includes("/"))) {
        throw refuse("skip must list file names");
    }
    if (named.length === 0 && data === null) throw refuse("it names no files and hands over no data");
    return { paths: named, exclude: left, skip: skip as string[], data };
}

type Report = (step: BackupStep, done?: number | null, total?: number | null) => void;

export class BackupService {
    readonly locations: BackupLocations;
    private readonly workDir: string;
    /** the running backups and restores, by panel and target */
    private readonly running = new Map<string, BackupProgress & { sentAt: number }>();
    private readonly progressListeners = new Set<(change: BackupProgressChange) => void>();

    constructor(
        private readonly engine: PaperCraneEngine,
        driveEndpoints: DriveEndpoints = GOOGLE_ENDPOINTS,
    ) {
        const root = path.join(engine.getAppDataDir(), "backups");
        this.locations = new BackupLocations(engine, root, driveEndpoints);
        // beside the data, so restored files move in with a rename
        this.workDir = path.join(root, ".work");
    }

    /** startup only, before panel services start: rolls back a restore a crash interrupted */
    recoverAtStartup(): void {
        recoverRestores(this.workDir, (panelId) => this.engine.resolveAppFilesDir(panelId));
    }

    // ─── Progress ───────────────────────────────────────────────────────

    /** where the panel's backups go, and the target's running backup */
    status(panelId: string, target: string | null): { location: BackupLocation | null; progress: BackupProgress | null } {
        const running = this.running.get(key(panelId, target));
        return { location: this.locations.forPanel(panelId), progress: running ? withoutStamp(running) : null };
    }

    /** the backups and restores running now for a panel, any target */
    progressFor(panelId: string): BackupProgress[] {
        return [...this.running.values()].filter((p) => p.panelId === panelId).map(withoutStamp);
    }

    /** hears every running backup's step and bytes, and its end */
    onProgress(listener: (change: BackupProgressChange) => void): () => void {
        this.progressListeners.add(listener);
        return () => this.progressListeners.delete(listener);
    }

    private emit(change: BackupProgressChange): void {
        for (const listener of this.progressListeners) {
            try {
                listener(change);
            } catch (err) {
                // quiet: a listener is a socket's delivery, which reports its own failures
                logger.error("[backups] a progress listener failed:", err);
            }
        }
    }

    /** runs one backup or restore of a target, reporting its steps; one at a time per target */
    private async job(panelId: string, target: string | null, kind: "create" | "restore", run: (report: Report) => Promise<BackupRecord>): Promise<BackupRecord> {
        const id = key(panelId, target);
        const current = this.running.get(id);
        if (current) throw conflict(`A backup ${current.kind === "create" ? "is being made" : "is being restored"} for this ${target === null ? "panel" : "target"}`);
        const report: Report = (step, done = null, total = null) => {
            const previous = this.running.get(id);
            const now = Date.now();
            const progress: BackupProgress = { panelId, target, kind, step, done, total };
            // byte counts at most every PROGRESS_INTERVAL_MS; a new step or a finished one at once
            const due = !previous || previous.step !== step || done === total || now - previous.sentAt >= PROGRESS_INTERVAL_MS;
            this.running.set(id, { ...progress, sentAt: due ? now : previous!.sentAt });
            if (due) this.emit({ panelId, target, progress });
        };
        report("preparing");
        try {
            fs.mkdirSync(this.workDir, { recursive: true });
            return await run(report);
        } finally {
            this.running.delete(id);
            this.emit({ panelId, target, progress: null });
        }
    }

    // ─── A panel's backups ──────────────────────────────────────────────

    async create(panelId: string, target: string | null, label: string | null): Promise<BackupRecord> {
        if (label !== null && (typeof label !== "string" || label.length > BACKUP_LABEL_MAX)) {
            throw invalidParams(`label must be at most ${BACKUP_LABEL_MAX} characters`);
        }
        const hooks = this.engine.backupHooks(panelId);
        if (!hooks?.has("before-backup")) throw conflict(hooks ? "This panel's service has no beforeBackup, so it can't be backed up" : "The panel's service is not running, so it can't be backed up");
        const store = this.locations.storeFor(panelId);
        return this.job(panelId, target, "create", async (report) => {
            const id = newBackupId();
            const archive = path.join(this.workDir, `${id}.pbbackup`);
            try {
                const made = await this.engine.withPanelOperation(panelId, async () => {
                    const panelVersion = this.engine.installedPanelVersion(panelId);
                    const answer = await this.engine.askBackupHook(panelId, "before-backup", { target });
                    // from here the panel is ready for a copy: it hears how the copy went, whatever happens
                    let contents: ArchiveContents | null = null;
                    let packed: { size: number; sha256: string } | null = null;
                    let failure: unknown = null;
                    try {
                        contents = backupContents(answer);
                        report("packing");
                        packed = await createBackupArchive(this.engine.resolveAppFilesDir(panelId), contents, archive, (done, total) => report("packing", done, total));
                    } catch (err) {
                        failure = err;
                    }
                    report("resuming");
                    if (this.engine.backupHooks(panelId)?.has("after-backup")) {
                        const copied = failure === null ? { target, ok: true } : { target, ok: false, error: errorMessage(failure) };
                        try {
                            await this.engine.askBackupHook(panelId, "after-backup", { copied });
                        } catch (err) {
                            throw new Error(`${failure === null ? "The files were copied" : `The copy failed (${errorMessage(failure)})`}, but the panel could not carry on: ${errorMessage(err)}`, { cause: err });
                        }
                    }
                    if (failure !== null) throw failure;
                    return { ...packed!, panelVersion, contents: contents! };
                });
                const record: BackupRecord = {
                    format: 2,
                    id,
                    panelId,
                    target,
                    createdAt: new Date().toISOString(),
                    size: made.size,
                    sha256: made.sha256,
                    panelVersion: made.panelVersion,
                    label: label?.trim() || null,
                    paths: made.contents.paths,
                    exclude: made.contents.exclude,
                };
                if (Buffer.byteLength(JSON.stringify(record)) > RECORD_MAX_BYTES) throw new Error("The backup names too many paths to keep its record; name fewer, larger folders");
                report("saving", 0, made.size);
                await store.put(record, archive, (done) => report("saving", done, made.size));
                return record;
            } finally {
                await fs.promises.rm(archive, { force: true });
            }
        });
    }

    list(panelId: string, target: string | null): Promise<BackupRecord[]> {
        return this.locations.storeFor(panelId).list(panelId, target);
    }

    private async find(store: BackupStore, panelId: string, target: string | null, backupId: string): Promise<BackupRecord> {
        if (typeof backupId !== "string" || !BACKUP_ID_RE.test(backupId)) throw invalidParams("backupId is not a backup id");
        const record = (await store.list(panelId, target)).find((r) => r.id === backupId);
        if (!record) throw notFound(`Backup ${backupId} is not at this panel's backup location`);
        return record;
    }

    async restore(panelId: string, target: string | null, backupId: string): Promise<BackupRecord> {
        const hooks = this.engine.backupHooks(panelId);
        if (!hooks?.has("after-restore")) throw conflict(hooks ? "This panel's service has no afterRestore, so it can't restore its backups" : "The panel's service is not running, so it can't restore its backups");
        const store = this.locations.storeFor(panelId);
        return this.job(panelId, target, "restore", async (report) => {
            const record = await this.find(store, panelId, target, backupId);
            const installed = this.engine.installedPanelVersion(panelId);
            if (isNewerVersion(record.panelVersion, installed)) {
                throw conflict(`This backup was made by version ${record.panelVersion} of the panel; ${installed} is installed. Update the panel first`);
            }
            const archive = path.join(this.workDir, `${record.id}-download.pbbackup`);
            const staging = await fs.promises.mkdtemp(path.join(this.workDir, "unpack-"));
            try {
                report("downloading", 0, record.size);
                await store.get(record, archive, (done) => report("downloading", Math.min(done, record.size), record.size));
                report("checking");
                if (fs.statSync(archive).size !== record.size || (await hashFile(archive, "sha256")) !== record.sha256) {
                    throw new Error("The downloaded backup does not match its record; it was not restored");
                }
                report("unpacking");
                const { filesDir, data } = await extractBackupArchive(archive, staging);
                await this.engine.withPanelOperation(panelId, async () => {
                    report("preparing");
                    if (this.engine.backupHooks(panelId)?.has("before-restore")) {
                        await this.engine.askBackupHook(panelId, "before-restore", { restore: { target, backup: record } });
                    }
                    report("restoring");
                    // the panel stopped for the restore: whatever happens, it hears how it ended
                    const failed = async (err: unknown): Promise<never> => {
                        try {
                            await this.engine.askBackupHook(panelId, "after-restore", { ended: { target, backup: record, ok: false, error: errorMessage(err) } });
                        } catch (tellErr) {
                            throw new Error(`${errorMessage(err)}; then the panel could not carry on: ${errorMessage(tellErr)}`, { cause: err });
                        }
                        throw err;
                    };
                    let swap: ReturnType<typeof swapIn>;
                    try {
                        swap = swapIn(this.workDir, panelId, this.engine.resolveAppFilesDir(panelId), filesDir, record);
                    } catch (err) {
                        return failed(err);
                    }
                    try {
                        await this.engine.askBackupHook(panelId, "after-restore", { ended: { target, backup: record, ok: true, data } });
                    } catch (err) {
                        const why = new Error(`The panel could not pick up from the restored files, so they were put back: ${errorMessage(err)}`, { cause: err });
                        try {
                            swap.rollback();
                        } catch (rollbackErr) {
                            throw new Error(`${why.message}; ${errorMessage(rollbackErr)}`, { cause: err });
                        }
                        return failed(why);
                    }
                    await swap.commit();
                });
                return record;
            } finally {
                await fs.promises.rm(archive, { force: true });
                await fs.promises.rm(staging, { recursive: true, force: true });
            }
        });
    }

    async remove(panelId: string, target: string | null, backupId: string): Promise<void> {
        const store = this.locations.storeFor(panelId);
        await store.remove(await this.find(store, panelId, target, backupId));
    }
}

const key = (panelId: string, target: string | null) => `${panelId}\n${target ?? ""}`;

const withoutStamp = ({ sentAt: _sentAt, ...progress }: BackupProgress & { sentAt: number }): BackupProgress => progress;
