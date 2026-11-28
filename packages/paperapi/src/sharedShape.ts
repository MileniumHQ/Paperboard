// What a shared document is, and the limits on it: one shape for the SDK
// that reads and writes them (shared.ts) and the daemon that keeps them
// (its network/shared.ts). Plain TypeScript.

/** The computer that wrote a version: its member id, its name in the computer list, and whether it is this one. */
export interface SharedAuthor {
    /** the computer's member id */
    computer: string;
    /** the name the person gave it; absent until it has one */
    name?: string;
    /** true when this computer wrote it */
    self: boolean;
}

interface SharedMeta {
    id: string;
    /** this version: what `basedOn` and restore() take */
    version: string;
    author: SharedAuthor;
    /** when it was written, in ms since the epoch, by the writer's clock */
    writtenAt: number;
}

/**
 * A document as this computer holds it: its value, or why it can't be read
 * yet (written under a network key this computer hasn't been given, or a
 * value the panel's reader refuses). Never "missing": a document that is
 * there and can't be read is said so.
 */
export type SharedDocument<T = unknown> = SharedMeta & ({ state: "value"; value: T } | { state: "unreadable"; error: string });

/** One kept version of a document: a value, a delete, or one this computer can't read. */
export type SharedVersion<T = unknown> = SharedDocument<T> | (SharedMeta & { state: "deleted" });

/** What a set answers: the document as written, and what it replaced when that wasn't the version it was based on. */
export interface SharedWrite<T = unknown> {
    document: SharedDocument<T>;
    /**
     * The version this write replaced although it wasn't `basedOn`: someone
     * else's change landed first. Null when the write was based on what it
     * replaced, or gave no `basedOn`.
     */
    overwrote: SharedVersion<T> | null;
}

/** What a delete answers: whether there was a document, and what it replaced when that wasn't `basedOn`. */
export interface SharedDelete<T = unknown> {
    deleted: boolean;
    overwrote: SharedVersion<T> | null;
}

/** the documents of a panel (or, for null, the shell's) changed: `{ panelId, ids }` */
export const SHARED_EVENT = "shared:changed";

/**
 * The largest document, as UTF-8 JSON. The record store takes 1 MiB, but
 * every computer holds every document in memory and keeps one version per
 * computer that wrote it; a quarter of that keeps a panel at its cap within
 * what a small computer carries, and leaves room in one WebSocket frame.
 */
export const SHARED_DOCUMENT_MAX_BYTES = 256 * 1024;
/** documents a panel holds at once */
export const SHARED_DOCUMENTS_MAX = 1000;
/**
 * Ids a panel has used, deleted ones included: a delete is a record every
 * computer keeps, so documents named afresh each time (a new id per item)
 * run out here. Reuse ids where a thing comes back.
 */
export const SHARED_IDS_MAX = 5000;
/**
 * All a panel's documents together, as stored. A list of every one is one
 * answer, which must fit a 20 MiB frame even when a tunnel carries it as
 * JSON inside JSON, where escaping can double it.
 */
export const SHARED_SPACE_MAX_BYTES = 8 * 1024 * 1024;
export const SHARED_ID_MAX_LENGTH = 200;

const SHARED_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const SHARED_PREFIX_RE = /^[A-Za-z0-9._/-]*$/;
const VERSION_RE = /^[0-9a-f]{64}$/;

/** A document id: letters, digits, ".", "_" and "-" in parts split by "/", each starting with a letter or digit; at most 200 characters. */
export function isSharedId(value: unknown): value is string {
    return typeof value === "string" && value.length <= SHARED_ID_MAX_LENGTH && SHARED_ID_RE.test(value);
}

export function requireSharedId(value: unknown): string {
    if (!isSharedId(value)) {
        throw new Error(
            `Invalid shared document id ${JSON.stringify(value)}: use letters, digits, ".", "_" and "-", in parts split by "/" that each start with a letter or digit, at most ${SHARED_ID_MAX_LENGTH} characters`,
        );
    }
    return value;
}

/** What list() and watch() narrow to: ids that start with it. */
export function isSharedPrefix(value: unknown): value is string {
    return typeof value === "string" && value.length <= SHARED_ID_MAX_LENGTH && SHARED_PREFIX_RE.test(value);
}

export function requireSharedPrefix(value: unknown): string {
    if (!isSharedPrefix(value)) throw new Error(`Invalid shared document prefix ${JSON.stringify(value)}: it is the start of an id`);
    return value;
}

/** A version as versions() and every document give it. */
export function isSharedVersion(value: unknown): value is string {
    return typeof value === "string" && VERSION_RE.test(value);
}
