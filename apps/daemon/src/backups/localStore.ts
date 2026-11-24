// The computer's own folder: backups in <data dir>/backups/panels/<panel
// dir>/<target folder>/, an archive and its record side by side. The archive lands under a temp name
// and the record is written last, so a listed backup always has its bytes.
import * as fs from "fs";
import * as path from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import { panelFilesDirName, writeFileAtomic } from "../core/storage";
import { logger } from "../core/logger";
import { BACKUP_ID_RE, BackupListingError, newestFirst, parseBackupRecord, targetFolder, type BackupRecord, type BackupStore, type BackupUsage, type BytesProgress } from "./types";

/** a file copy that reports the bytes copied so far */
async function copyCounting(from: string, to: string, onProgress?: BytesProgress): Promise<void> {
    if (!onProgress) return fs.promises.copyFile(from, to);
    let copied = 0;
    const counter = new Transform({
        transform(chunk: Buffer, _enc, done) {
            copied += chunk.length;
            onProgress(copied);
            done(null, chunk);
        },
    });
    await pipeline(fs.createReadStream(from), counter, fs.createWriteStream(to));
}

export class LocalBackupStore implements BackupStore {
    constructor(private readonly root: string) {}

    private dir(panelId: string, target: string | null): string {
        return path.join(this.root, panelFilesDirName(panelId), targetFolder(target));
    }

    private files(record: BackupRecord): { archive: string; record: string } {
        const dir = this.dir(record.panelId, record.target);
        return { archive: path.join(dir, `${record.id}.pbbackup`), record: path.join(dir, `${record.id}.json`) };
    }

    async check(): Promise<void> {
        fs.mkdirSync(this.root, { recursive: true });
        fs.accessSync(this.root, fs.constants.W_OK);
    }

    async usage(): Promise<BackupUsage> {
        fs.mkdirSync(this.root, { recursive: true });
        let used = 0;
        for (const entry of fs.readdirSync(this.root, { withFileTypes: true, recursive: true })) {
            if (entry.isFile() && entry.name.endsWith(".pbbackup")) used += fs.statSync(path.join(entry.parentPath, entry.name)).size;
        }
        const fsStats = fs.statfsSync(this.root);
        return { used, available: fsStats.bavail * fsStats.bsize };
    }

    async list(panelId: string, target: string | null): Promise<BackupRecord[]> {
        const dir = this.dir(panelId, target);
        if (!fs.existsSync(dir)) return [];
        const records: BackupRecord[] = [];
        const unreadable: string[] = [];
        for (const file of fs.readdirSync(dir)) {
            const id = file.endsWith(".json") ? file.slice(0, -".json".length) : "";
            if (!BACKUP_ID_RE.test(id)) continue;
            let parsed: BackupRecord | null = null;
            try {
                parsed = parseBackupRecord(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
            } catch (err) {
                unreadable.push(id);
                logger.warn(`[backups] unreadable backup record ${file}:`, err);
                continue;
            }
            if (!parsed) {
                unreadable.push(id);
                continue;
            }
            // a record for another panel or target, or without its archive, is not listed
            if (parsed.panelId === panelId && parsed.target === target && fs.existsSync(this.files(parsed).archive)) records.push(parsed);
        }
        if (unreadable.length) throw new BackupListingError(unreadable);
        return newestFirst(records);
    }

    async put(record: BackupRecord, archivePath: string, onProgress?: BytesProgress): Promise<void> {
        const target = this.files(record);
        fs.mkdirSync(path.dirname(target.archive), { recursive: true });
        const part = `${target.archive}.part`;
        try {
            await copyCounting(archivePath, part, onProgress);
            await fs.promises.rename(part, target.archive);
            await writeFileAtomic(target.record, JSON.stringify(record, null, 2));
        } catch (err) {
            await fs.promises.rm(part, { force: true });
            await fs.promises.rm(target.archive, { force: true });
            throw err;
        }
    }

    async get(record: BackupRecord, destPath: string, onProgress?: BytesProgress): Promise<void> {
        await copyCounting(this.files(record).archive, destPath, onProgress);
    }

    async remove(record: BackupRecord): Promise<void> {
        const target = this.files(record);
        // the record goes first: a half-removed backup is never listed
        await fs.promises.rm(target.record, { force: true });
        await fs.promises.rm(target.archive, { force: true });
    }
}
