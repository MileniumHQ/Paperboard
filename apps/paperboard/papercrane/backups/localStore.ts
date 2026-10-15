// The computer's own folder: backups in <data dir>/backups/panels/<panel dir>/, an
// archive and its record side by side. The archive lands under a temp name
// and the record is written last, so a listed backup always has its bytes.
import * as fs from "fs";
import * as path from "path";
import { panelFilesDirName, writeFileAtomic } from "../storage";
import { logger } from "../logger";
import { BACKUP_ID_RE, BackupListingError, newestFirst, parseBackupRecord, type BackupRecord, type BackupStore, type BackupUsage } from "./types";

export class LocalBackupStore implements BackupStore {
    constructor(private readonly root: string) {}

    private panelDir(panelId: string): string {
        return path.join(this.root, panelFilesDirName(panelId));
    }

    private files(record: BackupRecord): { archive: string; record: string } {
        const dir = this.panelDir(record.panelId);
        return { archive: path.join(dir, `${record.id}.pbbackup`), record: path.join(dir, `${record.id}.json`) };
    }

    async check(): Promise<void> {
        fs.mkdirSync(this.root, { recursive: true });
        fs.accessSync(this.root, fs.constants.W_OK);
    }

    async usage(): Promise<BackupUsage> {
        fs.mkdirSync(this.root, { recursive: true });
        let used = 0;
        for (const panel of fs.readdirSync(this.root, { withFileTypes: true })) {
            if (!panel.isDirectory()) continue;
            for (const file of fs.readdirSync(path.join(this.root, panel.name))) {
                if (file.endsWith(".pbbackup")) used += fs.statSync(path.join(this.root, panel.name, file)).size;
            }
        }
        const fsStats = fs.statfsSync(this.root);
        return { used, available: fsStats.bavail * fsStats.bsize };
    }

    async list(panelId: string): Promise<BackupRecord[]> {
        const dir = this.panelDir(panelId);
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
            // a record for another panel, or without its archive, is not listed
            if (parsed.panelId === panelId && fs.existsSync(this.files(parsed).archive)) records.push(parsed);
        }
        if (unreadable.length) throw new BackupListingError(unreadable);
        return newestFirst(records);
    }

    async put(record: BackupRecord, archivePath: string): Promise<void> {
        const target = this.files(record);
        fs.mkdirSync(path.dirname(target.archive), { recursive: true });
        const part = `${target.archive}.part`;
        try {
            await fs.promises.copyFile(archivePath, part);
            await fs.promises.rename(part, target.archive);
            await writeFileAtomic(target.record, JSON.stringify(record, null, 2));
        } catch (err) {
            await fs.promises.rm(part, { force: true });
            await fs.promises.rm(target.archive, { force: true });
            throw err;
        }
    }

    async get(record: BackupRecord, destPath: string): Promise<void> {
        await fs.promises.copyFile(this.files(record).archive, destPath);
    }

    async remove(record: BackupRecord): Promise<void> {
        const target = this.files(record);
        // the record goes first: a half-removed backup is never listed
        await fs.promises.rm(target.record, { force: true });
        await fs.promises.rm(target.archive, { force: true });
    }
}
