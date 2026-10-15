// Where backups go. The daemon owns the list of backup locations and which
// one each panel uses, in <data dir>/backups/destinations.json. Location
// secrets (S3 secret keys, Google sign-ins) live in the vault under the
// reserved "shell-backups" owner, never in this file. The computer's own
// folder is built in and cannot be removed; it carries the machine's name,
// which the shell shows as the name it gives the computer.
import * as fs from "fs";
import * as path from "path";
import { isPanelId } from "../../../../packages/paperapi/src/panelIdentity";
import { writeFileAtomic } from "../storage";
import { ErrorCode } from "../protocol";
import { RpcError } from "../rpc/errors";
import { computerHostname } from "../hostname";
import type { S3Settings } from "./s3Store";
import type { DriveSettings } from "./driveStore";

/** vault owner for location secrets; shell-* ids are reserved, no panel holds it */
export const BACKUP_VAULT_OWNER = "shell-backups";
export const LOCAL_DESTINATION_ID = "local";
export const MAX_DESTINATIONS = 16;
export const DESTINATION_LABEL_MAX = 60;
const DESTINATION_ID_RE = /^d-[0-9a-f]{12}$/;

export type Destination =
    | { id: string; kind: "local"; label: string }
    | { id: string; kind: "s3"; label: string; s3: S3Settings }
    | { id: string; kind: "gdrive"; label: string; drive: DriveSettings };

export interface BackupConfig {
    version: 1;
    destinations: Destination[];
    /** panel id to destination id */
    panels: Record<string, string>;
}

export function localDestination(): Destination {
    return { id: LOCAL_DESTINATION_ID, kind: "local", label: computerHostname() };
}

export function isDestinationId(value: unknown): value is string {
    return typeof value === "string" && (value === LOCAL_DESTINATION_ID || DESTINATION_ID_RE.test(value));
}

function str(v: unknown, max: number): v is string {
    return typeof v === "string" && v.length <= max;
}

function parseDestination(raw: any): Destination | null {
    if (!raw || typeof raw !== "object" || !isDestinationId(raw.id) || raw.id === LOCAL_DESTINATION_ID) return null;
    if (!str(raw.label, DESTINATION_LABEL_MAX)) return null;
    if (raw.kind === "s3") {
        const s = raw.s3;
        if (!s || ![s.endpoint, s.region, s.bucket, s.prefix, s.accessKeyId].every((v) => str(v, 512)) || typeof s.pathStyle !== "boolean") return null;
        return { id: raw.id, kind: "s3", label: raw.label, s3: { endpoint: s.endpoint, region: s.region, bucket: s.bucket, prefix: s.prefix, accessKeyId: s.accessKeyId, pathStyle: s.pathStyle } };
    }
    if (raw.kind === "gdrive") {
        const d = raw.drive;
        if (!d || !str(d.clientId, 512) || !str(d.folderId, 256) || !d.folderId) return null;
        return { id: raw.id, kind: "gdrive", label: raw.label, drive: { clientId: d.clientId, folderId: d.folderId } };
    }
    return null;
}

/** The locations file exists but cannot be trusted. Reads and writes refuse
 * until recoverBackupConfig sets it aside: a fresh list written over it
 * would destroy the only record of where backups live. */
export class BackupConfigUnreadableError extends RpcError {
    constructor(file: string, reason: string) {
        super(
            ErrorCode.CONFLICT,
            `The backup locations file ${path.basename(file)} could not be read (${reason}). Set it aside from Computer Info > Backups to start a fresh list; the damaged file is kept`,
        );
        this.name = "BackupConfigUnreadableError";
    }
}

function parseBackupConfig(raw: any): BackupConfig {
    if (!raw || typeof raw !== "object" || raw.version !== 1 || !Array.isArray(raw.destinations) || !raw.panels || typeof raw.panels !== "object") {
        throw new Error("it is not a backup locations file this Paperboard understands");
    }
    const destinations: Destination[] = [localDestination()];
    for (const entry of raw.destinations) {
        if (entry?.id === LOCAL_DESTINATION_ID) continue;
        const parsed = parseDestination(entry);
        if (!parsed) throw new Error(`it has a malformed backup location: ${JSON.stringify(entry?.id ?? null)}`);
        destinations.push(parsed);
    }
    const panels: Record<string, string> = {};
    for (const [panelId, destId] of Object.entries(raw.panels)) {
        if (!isPanelId(panelId) || !isDestinationId(destId)) throw new Error(`it has a malformed panel entry: ${JSON.stringify(panelId)}`);
        // a panel pointing at a removed location has no location
        if (destinations.some((d) => d.id === destId)) panels[panelId] = destId;
    }
    return { version: 1, destinations, panels };
}

/** reads the config. A missing file is a fresh install; a file that is
 * there but unreadable or malformed is a BackupConfigUnreadableError, never
 * an empty config */
export function readBackupConfig(file: string): BackupConfig {
    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { version: 1, destinations: [localDestination()], panels: {} };
        throw new BackupConfigUnreadableError(file, (err as Error).message);
    }
    try {
        return parseBackupConfig(JSON.parse(text));
    } catch (err) {
        throw new BackupConfigUnreadableError(file, (err as Error).message);
    }
}

/** the explicit recovery: moves an unreadable locations file aside
 * (<file>.corrupt-<ms>, kept) so a fresh list can start. Refuses when the
 * file reads fine. Resolves with the kept file's name. */
export function recoverBackupConfig(file: string): string {
    try {
        readBackupConfig(file);
    } catch (err) {
        if (!(err instanceof BackupConfigUnreadableError)) throw err;
        const kept = `${file}.corrupt-${Date.now()}`;
        fs.renameSync(file, kept);
        return path.basename(kept);
    }
    throw new RpcError(ErrorCode.CONFLICT, "The backup locations file is readable; there is nothing to recover");
}

export async function writeBackupConfig(file: string, config: BackupConfig): Promise<void> {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const stored = { ...config, destinations: config.destinations.filter((d) => d.id !== LOCAL_DESTINATION_ID) };
    await writeFileAtomic(file, JSON.stringify(stored, null, 2));
}
