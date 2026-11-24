// Where backups go. The daemon owns the list of backup locations and which
// one each panel uses, in <data dir>/backups/destinations.json (its keys
// keep the name locations had when the file was first written). Location
// secrets (S3 secret keys, Google sign-ins) live in the vault under the
// reserved "shell-backups" owner, never in this file. The computer's own
// folder is built in and cannot be removed; it carries the machine's name,
// which the shell shows as the name it gives the computer.
import * as fs from "fs";
import * as path from "path";
import { isPanelId } from "@mileniumhq/paperapi/panelIdentity";
import { writeFileAtomic } from "../core/storage";
import { ErrorCode } from "../core/protocol";
import { RpcError } from "../rpc/errors";
import { computerHostname } from "../server/hostname";
import type { S3Settings } from "./s3Store";
import type { DriveSettings } from "./driveStore";
import { errorCode } from "@mileniumhq/paperapi/errors";
import { LOCAL_LOCATION_ID, isLocationId } from "@mileniumhq/paperapi/protocol";

/** vault owner for location secrets; shell-* ids are reserved, no panel holds it */
export const BACKUP_VAULT_OWNER = "shell-backups";
export { LOCAL_LOCATION_ID, isLocationId };
export const MAX_LOCATIONS = 16;
export const LOCATION_LABEL_MAX = 60;

export type StoredLocation =
    | { id: string; kind: "local"; label: string }
    | { id: string; kind: "s3"; label: string; s3: S3Settings }
    | { id: string; kind: "gdrive"; label: string; drive: DriveSettings };

export interface BackupConfig {
    version: 1;
    locations: StoredLocation[];
    /** panel id to location id */
    panels: Record<string, string>;
}

export function localLocation(): StoredLocation {
    return { id: LOCAL_LOCATION_ID, kind: "local", label: computerHostname() };
}

function str(v: unknown, max: number): v is string {
    return typeof v === "string" && v.length <= max;
}

function parseLocation(raw: any): StoredLocation | null {
    if (!raw || typeof raw !== "object" || !isLocationId(raw.id) || raw.id === LOCAL_LOCATION_ID) return null;
    if (!str(raw.label, LOCATION_LABEL_MAX)) return null;
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
    const locations: StoredLocation[] = [localLocation()];
    for (const entry of raw.destinations) {
        if (entry?.id === LOCAL_LOCATION_ID) continue;
        const parsed = parseLocation(entry);
        if (!parsed) throw new Error(`it has a malformed backup location: ${JSON.stringify(entry?.id ?? null)}`);
        locations.push(parsed);
    }
    const panels: Record<string, string> = {};
    for (const [panelId, locationId] of Object.entries(raw.panels)) {
        if (!isPanelId(panelId) || !isLocationId(locationId)) throw new Error(`it has a malformed panel entry: ${JSON.stringify(panelId)}`);
        // a panel pointing at a removed location has no location
        if (locations.some((l) => l.id === locationId)) panels[panelId] = locationId;
    }
    return { version: 1, locations, panels };
}

/** reads the config. A missing file is a fresh install; a file that is
 * there but unreadable or malformed is a BackupConfigUnreadableError, never
 * an empty config */
export function readBackupConfig(file: string): BackupConfig {
    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (err) {
        if (errorCode(err) === "ENOENT") return { version: 1, locations: [localLocation()], panels: {} };
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
    const stored = { version: config.version, destinations: config.locations.filter((l) => l.id !== LOCAL_LOCATION_ID), panels: config.panels };
    await writeFileAtomic(file, JSON.stringify(stored, null, 2));
}
