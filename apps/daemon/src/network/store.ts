// The replicated record store: every record this computer holds, on disk,
// and the two halves of sync. Records are described in record.ts.
//
// Who is a member, and how records travel, come from outside: the store
// takes a Membership (a certificate lookup and an admission rule) and any
// RecordSource or RecordSink (another store, a relay, a link). That keeps
// it the same whichever roster or transport sits around it.
//
// ─── Winning and earlier versions ────────────────────────────────────────────
//
// Last writer wins per space and id (record.ts "Order"). The store keeps,
// beside the winner, the newest version each other author wrote of that
// record, up to MAX_VERSIONS authors: that is what a conflict loses, and
// restore() brings one back as a new write. A version an author replaced
// itself is not kept. Which versions are kept depends only on the versions
// seen, so every computer keeps the same ones.
//
// ─── Sync ────────────────────────────────────────────────────────────────────
//
// Each version the store accepts gets the next number of its log: a
// sequence that only grows, named by a random log id. changes(cursor) lists
// what came after a cursor; a puller keeps one cursor per peer, and a cursor
// from another log (the peer's store was wiped) starts over from 0. A relay
// needs two calls and nothing else: append records (answering with its own
// log id, so a pusher can tell it was wiped), and list them after a cursor.
// A store passes on what it took from others too, so any one of them can be
// the only path between two more. Applying is idempotent and
// order-independent, so the same records reach the same state by any path.
//
// A record is accepted when its signature verifies against its author's
// certificate and Membership.admits its header. One that can't be decided
// yet (an author the roster doesn't know, a header the rule refuses, a clock
// too far ahead) is held, not dropped, and readmit() tries it again; a
// record that is accepted and that the rule refuses later goes back to held.
// A forged or malformed record is refused for good.
//
// What is guaranteed:
//  - While Membership's answers stay the same, the versions a store keeps
//    are a function of the set of records it has considered, in any order
//    and with any repeats: per author the newest, of those the newest
//    MAX_VERSIONS.
//  - Accepting a version throws away the ones it outranks (its author's
//    older one, or the oldest past MAX_VERSIONS). When readmit() later
//    takes an accepted version back to held, what it outranked is gone
//    here, so readmit() forgets every pull cursor and the next pulls fetch
//    everything again: any computer or relay that still has those versions
//    gives them back. Once computers that sync with each other (directly
//    or through a relay) have the same answers and have pulled from each
//    other since their last readmit(), all of them hold the same.
//  - That is all of it. A version no remaining computer or relay kept (all
//    of them accepted its replacement before hearing it was refused) is
//    gone everywhere alike.
//  - A pull never moves its cursor past a record it didn't keep: when held
//    is full it fails instead (MAX_HELD).
//
// ─── Disk ────────────────────────────────────────────────────────────────────
//
//   <dir>/meta.json            {"log", "reservedSeq", "owner"}: sequence
//                              numbers below reservedSeq may have been handed
//                              out; owner is the member id whose key signs
//                              and unwraps here (a store is one key's: opened
//                              with another it throws RecordStoreOwnerError)
//   <dir>/spaces/<hex>/<bb>.json
//                              {"records": [{"seq", "record"}]}: one bucket of
//                              a space, the folder its name as hex of UTF-8
//                              (case-proof filenames), the file the first byte
//                              of SHA-256 over the record id's UTF-8, as two
//                              lowercase hex characters. A bucket with no
//                              records has no file.
//   <dir>/held.json            {"records": [record]}
//   <dir>/cursors.json         {"pull:<peer>": {"log", "after"},
//                               "push:<peer>": {"log", "after", "sink"}}
//
// It is sized for settings and documents: up to a few thousand records of
// a few KB per space. A space is split into SPACE_BUCKETS files by a hash
// of the record id, so a change rewrites only the buckets of the ids it
// touched: about 1/256 of a big space. Everything is held in memory;
// changes() scans every record. Bulk data (files, logs, media, anything
// that grows without bound) does not belong here.
//
// Each file is replaced whole (writeFileAtomic), or removed when its bucket
// empties, so a crash leaves it old or new. A change that spans files writes
// where a record goes before where it leaves, and loading drops a held copy
// of a record already kept. A file that doesn't parse, or a record in a
// bucket or space that isn't its own, stops the store from opening: it is
// never read as empty, because starting over would hand out sequence
// numbers peers have already passed and lose records only this computer had.
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { errorCode, errorMessage } from "@mileniumhq/paperapi/errors";
import { isWriteFileAtomicTemp } from "@mileniumhq/paperapi/fs";
import { KeyedQueue, SerialQueue } from "@mileniumhq/paperapi/serialQueue";
import { logger } from "../core/logger";
import { ensurePrivateDir } from "../core/paths";
import { writeFileAtomic, writeJsonAtomicSync } from "../core/storage";
import type { TlsIdentity } from "../security/tlsIdentity";
import {
    KEYS_SPACE,
    ROSTER_SPACE,
    type NetworkKey,
    type RecordHeader,
    type WireRecord,
    checkId,
    checkSpace,
    compareRecords,
    headerOf,
    keysRecordId,
    newNetworkKey,
    openBody,
    parseWireRecord,
    recordDigest,
    sealBody,
    signRecord,
    unwrapKeys,
    verifyRecord,
    wrapKeys,
} from "./record";
import { isMemberId, memberIdOf } from "./memberId";

/**
 * How many authors' versions of one record are kept. A network is a
 * person's or a team's computers: more than 16 writing the same record
 * apart, all before any of them syncs, is past any network this is for,
 * and each kept version costs one record of disk per record id.
 */
export const MAX_VERSIONS = 16;
/**
 * How far ahead of this computer's clock a record's clock may be. Clocks
 * kept by NTP are within a second or two; a minute leaves room for a
 * computer that hasn't synced its clock lately, and caps how far one with
 * a wrong clock can pull the network's clocks ahead of real time.
 */
export const FUTURE_TOLERANCE_MS = 60_000;
/**
 * How many records wait in held at most. Holding covers records that come
 * before what admits them (a new computer's writes before the roster entry
 * that adds it), which can be a whole computer's worth.
 */
export const MAX_HELD = 10_000;
/** How many files a space is split into (store.ts "Disk"). */
export const SPACE_BUCKETS = 256;
const SEQ_BLOCK = 1024;
const MAX_COUNTER = 0xffff_ffff;

/** Who may write, injected by the roster. */
export interface Membership {
    /** The certificate (PEM) of the computer with this member id, or null when it isn't known. The store checks its key hashes to the id. */
    certFor(author: string): string | null;
    /**
     * Whether a record with this header may be accepted, given what the
     * roster knows now: its author, its clock and epoch (was the author a
     * member when it wrote this), its space. Asked again on readmit().
     */
    admits(header: RecordHeader): boolean;
}

export interface RecordStoreOptions {
    /** the folder the store owns */
    dir: string;
    /** this computer's TLS identity: records are signed and key records opened with it */
    identity: TlsIdentity;
    membership: Membership;
    /** the wall clock, in ms; tests pass their own */
    now?: () => number;
}

export interface ChangeCursor {
    log: string;
    after: number;
}

/** Where a push got to: in this store's log, and the log id the sink answered with. */
interface PushCursor extends ChangeCursor {
    sink: string;
}

export interface ChangeBatch {
    log: string;
    records: WireRecord[];
    /** the cursor's `after` for the next call */
    next: number;
    /** more records follow `next` */
    more: boolean;
}

/** Where records come from: another store, a relay, a link to one. */
export interface RecordSource {
    changes(cursor: ChangeCursor | null, limit: number): ChangeBatch | Promise<ChangeBatch>;
}

/** Where records go: a relay, a link. */
export interface RecordSink {
    /** Keeps the records, and answers with its log id, which changes when it has lost what it was given before. */
    append(records: WireRecord[]): string | Promise<string>;
}

export type Refusal = "malformed" | "bad-signature" | "held-full";

export interface ApplyResult {
    accepted: number;
    /** already here, or older than what is */
    known: number;
    held: number;
    refused: { reason: Refusal; message: string }[];
}

export interface RecordMeta {
    space: string;
    id: string;
    /** this version's digest: what restore() takes */
    version: string;
    wall: number;
    counter: number;
    author: string;
    epoch: number;
}

export type StoredRecord = RecordMeta &
    ({ state: "value"; value: unknown } | { state: "deleted" } | { state: "unreadable"; error: string });

/** The store in this folder belongs to another key: its keys can't be opened and its records weren't signed here. */
export class RecordStoreOwnerError extends Error {
    constructor(
        readonly dir: string,
        readonly owner: string,
        self: string,
    ) {
        super(`The record store in ${dir} belongs to computer ${owner}, not to this daemon's key (${self}).`);
        this.name = "RecordStoreOwnerError";
    }
}

export class RecordStoreCorruptError extends Error {
    constructor(file: string, reason: string) {
        super(
            `The record store file ${file} is damaged (${reason}). Nothing was changed. Moving the file aside lets this computer get its records from the others again; records only it had stay in the moved file.`,
        );
        this.name = "RecordStoreCorruptError";
    }
}

interface Version {
    record: WireRecord;
    digest: string;
    seq: number;
}

type Verdict = "accepted" | "known" | "held" | { reason: Refusal; message: string };

const spaceFolder = (space: string) => Buffer.from(space, "utf8").toString("hex");
/** the bucket a record id is kept in: the first byte of SHA-256 over its UTF-8, as hex (SPACE_BUCKETS of them) */
const bucketOf = (id: string) => crypto.createHash("sha256").update(id, "utf8").digest("hex").slice(0, 2);
const BUCKET_FILE_RE = /^([0-9a-f]{2})\.json$/;

export class RecordStore {
    /** this computer's member id: the author of what it writes */
    readonly self: string;
    private readonly dir: string;
    private readonly spacesDir: string;
    private readonly privateKey: crypto.KeyObject;
    private readonly membership: Membership;
    private readonly now: () => number;
    private readonly queue = new SerialQueue();
    private readonly peerLines = new KeyedQueue();
    private readonly watchers = new Map<string, Set<(ids: string[]) => void>>();
    private readonly acceptedListeners = new Set<() => void>();

    // loaded state: load() replaces all of it
    private log = "";
    private reservedSeq = 0;
    private nextSeq = 1;
    private clock = { wall: 0, counter: 0 };
    /** space → id → versions, the winner first */
    private spaces = new Map<string, Map<string, Version[]>>();
    private held = new Map<string, WireRecord>();
    private cursors: Record<string, ChangeCursor | PushCursor> = {};
    /** bumped whenever readmit() forgets the pull cursors, so a pull that was running can't put an old one back */
    private pullGeneration = 0;
    private keyring = new Map<string, NetworkKey>();
    private keyErrors = new Map<string, string>();

    // what the running change touched, saved and announced by flush()
    /** space → the ids whose bucket the running change must save */
    private dirty = new Map<string, Set<string>>();
    /** space → bucket → the ids kept in it, as saved: flush() keeps it in step with `spaces` */
    private buckets = new Map<string, Map<string, Set<string>>>();
    private heldDirty = false;
    private cursorsDirty = false;
    /** held records accepted by the running change, until flush() has saved them in their space */
    private leavingHeld = new Map<string, WireRecord>();
    private changed = new Map<string, Set<string>>();

    private constructor(options: RecordStoreOptions) {
        this.dir = options.dir;
        this.spacesDir = path.join(options.dir, "spaces");
        this.privateKey = crypto.createPrivateKey(options.identity.key);
        this.self = memberIdOf(options.identity.cert);
        this.membership = options.membership;
        this.now = options.now ?? Date.now;
    }

    /** Opens the store in `dir`, made if missing; throws RecordStoreCorruptError when a file is damaged. */
    static open(options: RecordStoreOptions): RecordStore {
        const store = new RecordStore(options);
        store.load();
        return store;
    }

    // ─── Reading ─────────────────────────────────────────────────────────────

    /** The record's winning version, or null when there is none or it was deleted. */
    get(space: string, id: string): StoredRecord | null {
        checkOwnSpace(space);
        checkId(id);
        const winner = this.spaces.get(space)?.get(id)?.[0];
        if (!winner || winner.record.deleted) return null;
        return this.view(winner);
    }

    /** Every record in the space that isn't deleted, by id. */
    list(space: string): StoredRecord[] {
        checkOwnSpace(space);
        const out: StoredRecord[] = [];
        const ids = this.spaces.get(space);
        for (const id of [...(ids?.keys() ?? [])].sort()) {
            const winner = ids!.get(id)![0];
            if (!winner.record.deleted) out.push(this.view(winner));
        }
        return out;
    }

    /** Every kept version of the record, the winner first; deletes included. */
    versions(space: string, id: string): StoredRecord[] {
        checkOwnSpace(space);
        checkId(id);
        return (this.spaces.get(space)?.get(id) ?? []).map((v) => this.view(v));
    }

    /** Calls `onChange` with the ids whose winner, or whether it can be read, changed, after the change is saved. */
    watch(space: string, onChange: (ids: string[]) => void): () => void {
        checkSpace(space);
        let set = this.watchers.get(space);
        if (!set) this.watchers.set(space, (set = new Set()));
        set.add(onChange);
        return () => {
            set.delete(onChange);
            if (!set.size) this.watchers.delete(space);
        };
    }

    /** Calls `listener` after every saved change that accepted a version, written here or taken from anywhere: what this store's peers have not seen. */
    onAccepted(listener: () => void): () => void {
        this.acceptedListeners.add(listener);
        return () => this.acceptedListeners.delete(listener);
    }

    /** The network keys this computer holds (no key bytes), and why any "@keys" record addressed to it could not be opened. */
    networkKeys(): { keys: { epoch: number; id: string }[]; current: { epoch: number; id: string } | null; problems: string[] } {
        const current = this.writeKey();
        return {
            keys: [...this.keyring.values()].map((k) => ({ epoch: k.epoch, id: k.id })).sort((a, b) => a.epoch - b.epoch || (a.id < b.id ? -1 : 1)),
            current: current && { epoch: current.epoch, id: current.id },
            problems: [...this.keyErrors.values()],
        };
    }

    /**
     * What a space holds, read from its records' headers (no body is
     * opened): how many ids, deletes included; how many aren't deleted; and
     * the bytes of those winners' bodies, and of `id`'s when it is one.
     */
    usage(space: string, id?: string): { ids: number; live: number; bytes: number; idBytes: number } {
        checkOwnSpace(space);
        const ids = this.spaces.get(space);
        let live = 0;
        let bytes = 0;
        for (const versions of ids?.values() ?? []) {
            const winner = versions[0].record;
            if (winner.deleted) continue;
            live++;
            bytes += Buffer.byteLength(winner.body, "base64");
        }
        const own = id === undefined ? undefined : ids?.get(id)?.[0].record;
        return { ids: ids?.size ?? 0, live, bytes, idBytes: own && !own.deleted ? Buffer.byteLength(own.body, "base64") : 0 };
    }

    /** How many records wait to be admitted. */
    get heldCount(): number {
        return this.held.size;
    }

    // ─── Writing ─────────────────────────────────────────────────────────────
    // Reads see a change as soon as it is made; if saving it fails, the call
    // rejects and the store goes back to what is on disk.

    async put(space: string, id: string, value: unknown): Promise<StoredRecord> {
        checkOwnSpace(space);
        checkId(id);
        return this.change(() => this.writeLocal(space, id, value, false));
    }

    async delete(space: string, id: string): Promise<void> {
        checkOwnSpace(space);
        checkId(id);
        return this.change(() => {
            this.writeLocal(space, id, null, true);
        });
    }

    /**
     * A write decided on the record's winner, in the store's line, so no
     * other change comes between: `decide` is given the winner (null for
     * none, a delete included as one) and answers what to write, or null for
     * nothing. A throw refuses the write with nothing changed. Resolves with
     * what was written and the winner it replaced.
     */
    write(
        space: string,
        id: string,
        decide: (current: StoredRecord | null) => { value: unknown } | { deleted: true } | null,
    ): Promise<{ written: StoredRecord | null; replaced: StoredRecord | null }> {
        checkOwnSpace(space);
        checkId(id);
        let replaced: StoredRecord | null = null;
        let decision: { value: unknown } | { deleted: true } | null = null;
        return this.change(
            () => {
                if (decision === null) return { written: null, replaced };
                const written = "value" in decision ? this.writeLocal(space, id, decision.value, false) : this.writeLocal(space, id, null, true);
                return { written, replaced };
            },
            () => {
                const winner = this.spaces.get(space)?.get(id)?.[0];
                replaced = winner ? this.view(winner) : null;
                decision = decide(replaced);
            },
        );
    }

    /** Makes an earlier version (from versions()) the winner again, as a new write that syncs like any other. */
    async restore(space: string, id: string, version: string): Promise<StoredRecord | null> {
        checkOwnSpace(space);
        checkId(id);
        return this.change(() => {
            const versions = this.spaces.get(space)?.get(id) ?? [];
            const found = versions.find((v) => v.digest === version);
            if (!found) throw new Error(`${space}/${id} has no earlier version ${version}`);
            if (found === versions[0]) throw new Error(`Version ${version} of ${space}/${id} is already the current one`);
            if (found.record.deleted) {
                this.writeLocal(space, id, null, true);
                return null;
            }
            const view = this.view(found);
            if (view.state !== "value") throw new Error(`Version ${version} of ${space}/${id} can't be read: ${view.state === "unreadable" ? view.error : "deleted"}`);
            return this.writeLocal(space, id, view.value, false);
        });
    }

    // ─── Network keys ────────────────────────────────────────────────────────

    /**
     * Starts a new key epoch: a fresh network key, written as one "@keys"
     * record per member with every key this computer holds. Leaving a
     * computer out of `memberCerts` is how it is shut out of new writes.
     * The members must include this computer.
     */
    createEpoch(memberCerts: string[]): Promise<{ epoch: number; id: string }> {
        return this.change(() => {
            const epoch = Math.max(-1, ...[...this.keyring.values()].map((k) => k.epoch)) + 1;
            const key = newNetworkKey(epoch);
            if (!memberCerts.some((c) => memberIdOf(c) === this.self)) {
                throw new Error("A new key epoch must include this computer, or it couldn't read what it writes");
            }
            this.publishKeys(memberCerts, [...this.keyring.values(), key]);
            return { epoch: key.epoch, id: key.id };
        });
    }

    /** Gives computers every network key this computer holds, without starting an epoch: how a computer that joins reads what is already there. */
    shareKeys(memberCerts: string[]): Promise<void> {
        return this.change(() => {
            if (!this.keyring.size) throw new Error("This computer holds no network keys to share");
            this.publishKeys(memberCerts, [...this.keyring.values()]);
        });
    }

    // ─── Sync ────────────────────────────────────────────────────────────────

    /** What this store accepted after `cursor`, oldest first. Only what is saved is listed. */
    async changes(cursor: ChangeCursor | null, limit: number): Promise<ChangeBatch> {
        if (!Number.isInteger(limit) || limit < 1) throw new Error(`A change batch holds at least one record, not ${limit}`);
        if (cursor !== null && !isCursor(cursor)) throw new Error(`Invalid change cursor ${JSON.stringify(cursor)}`);
        return this.queue.run(() => {
            const after = cursor && cursor.log === this.log ? cursor.after : 0;
            const later: Version[] = [];
            for (const ids of this.spaces.values()) {
                for (const versions of ids.values()) for (const v of versions) if (v.seq > after) later.push(v);
            }
            later.sort((a, b) => a.seq - b.seq);
            const batch = later.slice(0, limit);
            return {
                log: this.log,
                records: batch.map((v) => v.record),
                next: batch.length ? batch[batch.length - 1].seq : after,
                more: later.length > limit,
            };
        });
    }

    /** Takes records from anywhere; each is accepted, already known, held, or refused. */
    apply(records: unknown[]): Promise<ApplyResult> {
        return this.change(() => {
            const result: ApplyResult = { accepted: 0, known: 0, held: 0, refused: [] };
            for (const raw of records) {
                let record: WireRecord;
                try {
                    record = parseWireRecord(raw);
                } catch (err) {
                    result.refused.push({ reason: "malformed", message: errorMessage(err) });
                    continue;
                }
                count(result, this.consider(record, recordDigest(record), "remote"));
            }
            return result;
        });
    }

    /**
     * Asks Membership again about every record: accepted ones it now
     * refuses go back to held, held ones it admits (or whose clock is no
     * longer ahead) are accepted. Call it when the roster changes, and now
     * and then for clocks. Taking any accepted record back forgets every
     * pull cursor, so the next pulls fetch everything again.
     */
    readmit(): Promise<ApplyResult> {
        return this.change(() => {
            const result: ApplyResult = { accepted: 0, known: 0, held: 0, refused: [] };
            for (const [space, ids] of this.spaces) {
                for (const [id, versions] of ids) {
                    const kept = versions.filter((v) => this.membership.admits(headerOf(v.record)));
                    if (kept.length === versions.length) continue;
                    // what these outranked is gone here: pull everything again (see the top of this file)
                    this.forgetPullCursors();
                    for (const v of versions) if (!kept.includes(v)) this.held.set(v.digest, v.record);
                    this.heldDirty = true;
                    if (kept.length) ids.set(id, kept);
                    else ids.delete(id);
                    this.touch(space, id);
                }
            }
            for (const [digest, record] of [...this.held]) {
                this.held.delete(digest);
                const verdict = this.consider(record, digest, "held");
                count(result, verdict);
                if (verdict === "held") {
                    this.held.set(digest, record);
                    continue;
                }
                this.heldDirty = true;
                if (verdict === "accepted") this.leavingHeld.set(digest, record);
            }
            return result;
        });
    }

    /**
     * Takes what `peer` has that this store hasn't seen from it yet, batch
     * by batch, remembering where it got to. Fails, keeping its cursor
     * before them, when records it was given couldn't be kept.
     */
    pull(peer: string, source: RecordSource, limit = 500): Promise<ApplyResult> {
        const key = `pull:${peer}`;
        return this.peerLines.run(key, async () => {
            const total: ApplyResult = { accepted: 0, known: 0, held: 0, refused: [] };
            for (;;) {
                const generation = this.pullGeneration;
                const cursor = this.cursors[key] ?? null;
                const batch = await source.changes(cursor, limit);
                if (!batch || !Array.isArray(batch.records) || typeof batch.more !== "boolean" || !isCursor({ log: batch.log, after: batch.next })) {
                    throw new Error(`${peer} answered with a malformed change batch`);
                }
                // a source that says there is more must have moved on, or this never ends
                if (batch.more && (!batch.records.length || (cursor?.log === batch.log && batch.next <= cursor.after))) {
                    throw new Error(`${peer} says more records follow but gave none past ${cursor?.after ?? 0}`);
                }
                const result = await this.apply(batch.records);
                total.accepted += result.accepted;
                total.known += result.known;
                total.held += result.held;
                total.refused.push(...result.refused);
                const full = result.refused.filter((r) => r.reason === "held-full").length;
                if (full) {
                    throw new Error(
                        `${full} records from ${peer} weren't kept: ${MAX_HELD} records already wait to be admitted (their computers aren't in the network yet, or their clocks are ahead). ` +
                            "Add those computers to the network, or wait for their clocks, then readmit() and pull again: the pull kept its place before the records it couldn't keep.",
                    );
                }
                // a readmit() that forgot the cursors meanwhile wins: start over
                if (!(await this.saveCursor(key, { log: batch.log, after: batch.next }, generation))) continue;
                if (!batch.more) return total;
            }
        });
    }

    /** Hands `peer` (a relay) what it hasn't been given yet, remembering where it got to. */
    push(peer: string, sink: RecordSink, limit = 500): Promise<number> {
        const key = `push:${peer}`;
        return this.peerLines.run(key, async () => {
            let sent = 0;
            for (;;) {
                const saved = (this.cursors[key] ?? null) as PushCursor | null;
                const batch = await this.changes(saved, limit);
                const sinkLog = await sink.append(batch.records);
                if (typeof sinkLog !== "string" || !sinkLog) throw new Error(`${peer} answered a push without its log id`);
                sent += batch.records.length;
                if (saved && saved.sink !== sinkLog) {
                    // the sink lost what it was given: it gets everything again
                    await this.saveCursor(key, { log: batch.log, after: 0, sink: sinkLog });
                    continue;
                }
                await this.saveCursor(key, { log: batch.log, after: batch.next, sink: sinkLog });
                if (!batch.more) return sent;
            }
        });
    }

    // ─── Inside ──────────────────────────────────────────────────────────────

    /**
     * Runs `mutate` alone, saves what it touched, then tells watchers. Any
     * failure puts the store back to what is on disk. `prepare` runs first,
     * in the same line, and changes nothing: its throw refuses the change
     * without a reload.
     */
    private change<T>(mutate: () => T, prepare?: () => void): Promise<T> {
        return this.queue.run(async () => {
            prepare?.();
            const keysBefore = new Set(this.keyring.keys());
            const seqBefore = this.nextSeq;
            try {
                const out = mutate();
                if (this.dirty.has(KEYS_SPACE)) this.rebuildKeyring(keysBefore);
                await this.flush();
                this.announce();
                // every accepted version takes the next sequence number
                if (this.nextSeq !== seqBefore) this.announceAccepted();
                return out;
            } catch (err) {
                try {
                    this.load();
                } catch (loadErr) {
                    throw new AggregateError([err, loadErr], `${errorMessage(err)}, and the record store couldn't be read back: ${errorMessage(loadErr)}`);
                }
                throw err;
            }
        });
    }

    private writeLocal(space: string, id: string, value: unknown, deleted: boolean): StoredRecord {
        const key = this.writeKey();
        if (!key) throw new Error("This computer holds no network key yet, so it can't write records");
        const header: RecordHeader = { space, id, ...this.tick(), author: this.self, deleted, epoch: key.epoch, key: key.id };
        const body = deleted ? Buffer.alloc(0) : sealBody(header, key, value);
        // held to the rules every other computer checks it by
        const record = parseWireRecord(signRecord(header, body, this.privateKey));
        const digest = recordDigest(record);
        const verdict = this.consider(record, digest, "local");
        if (verdict !== "accepted") throw new Error(`This computer's write of ${space}/${id} was not accepted (${JSON.stringify(verdict)})`);
        return this.view(this.spaces.get(space)!.get(id)![0]);
    }

    private publishKeys(memberCerts: string[], keys: NetworkKey[]): void {
        const epoch = Math.max(...keys.map((k) => k.epoch));
        for (const [recipient, cert] of new Map(memberCerts.map((c) => [memberIdOf(c), c]))) {
            const header: RecordHeader = {
                space: KEYS_SPACE,
                id: keysRecordId(recipient, this.self),
                ...this.tick(),
                author: this.self,
                deleted: false,
                epoch,
                key: "",
            };
            const record = signRecord(header, wrapKeys(header, cert, keys), this.privateKey);
            const verdict = this.consider(record, recordDigest(record), "local");
            if (verdict !== "accepted") throw new Error(`This computer's keys for ${recipient} were not accepted (${JSON.stringify(verdict)})`);
        }
    }

    /** The key new records are written with: the newest epoch's, the lowest key id if two computers started it apart. */
    private writeKey(): NetworkKey | null {
        let best: NetworkKey | null = null;
        for (const k of this.keyring.values()) {
            if (!best || k.epoch > best.epoch || (k.epoch === best.epoch && k.id < best.id)) best = k;
        }
        return best;
    }

    private tick(): { wall: number; counter: number } {
        const now = this.now();
        if (now > this.clock.wall) this.clock = { wall: now, counter: 0 };
        else if (this.clock.counter < MAX_COUNTER) this.clock = { wall: this.clock.wall, counter: this.clock.counter + 1 };
        else this.clock = { wall: this.clock.wall + 1, counter: 0 };
        return { ...this.clock };
    }

    private see(record: WireRecord): void {
        if (record.wall > this.clock.wall || (record.wall === this.clock.wall && record.counter > this.clock.counter)) {
            this.clock = { wall: record.wall, counter: record.counter };
        }
    }

    /** The one decision about a record. `local` ones were just signed here; `held` ones come out of held. */
    private consider(record: WireRecord, digest: string, origin: "local" | "remote" | "held"): Verdict {
        const versions = this.spaces.get(record.space)?.get(record.id) ?? [];
        const candidate = { record, digest };
        if (origin === "remote" && (this.held.has(digest) || versions.some((v) => v.digest === digest))) return "known";
        const sameAuthor = versions.find((v) => v.record.author === record.author);
        if (sameAuthor && compareRecords(sameAuthor, candidate) >= 0) return "known";
        if (!sameAuthor && versions.length >= MAX_VERSIONS && compareRecords(versions[versions.length - 1], candidate) > 0) return "known";

        if (origin !== "local") {
            const cert = this.membership.certFor(record.author);
            if (cert === null) return this.hold(record, digest, origin);
            // the roster's own mistake, not the record's: fail the whole call
            if (memberIdOf(cert) !== record.author) throw new Error(`The roster's certificate for ${record.author} is another computer's`);
            if (!verifyRecord(record, cert)) {
                return { reason: "bad-signature", message: `${record.space}/${record.id} isn't signed by ${record.author}` };
            }
            if (record.wall > this.now() + FUTURE_TOLERANCE_MS) return this.hold(record, digest, origin);
        }
        if (!this.membership.admits(headerOf(record))) {
            if (origin === "local") throw new Error(`This computer can't write ${record.space}/${record.id}: the network doesn't admit it`);
            return this.hold(record, digest, origin);
        }

        const next = versions.filter((v) => v !== sameAuthor);
        next.push({ record, digest, seq: this.nextSeq++ });
        next.sort((a, b) => compareRecords(b, a));
        if (next.length > MAX_VERSIONS) next.length = MAX_VERSIONS;
        let ids = this.spaces.get(record.space);
        if (!ids) this.spaces.set(record.space, (ids = new Map()));
        ids.set(record.id, next);
        this.see(record);
        this.touch(record.space, record.id);
        return "accepted";
    }

    private hold(record: WireRecord, digest: string, origin: "remote" | "held"): Verdict {
        if (origin === "remote") {
            if (this.held.size >= MAX_HELD) {
                return { reason: "held-full", message: `${MAX_HELD} records already wait to be admitted; ${record.space}/${record.id} was not kept` };
            }
            this.held.set(digest, record);
            this.heldDirty = true;
        }
        return "held";
    }

    private touch(space: string, id: string): void {
        let dirty = this.dirty.get(space);
        if (!dirty) this.dirty.set(space, (dirty = new Set()));
        dirty.add(id);
        let ids = this.changed.get(space);
        if (!ids) this.changed.set(space, (ids = new Set()));
        ids.add(id);
    }

    private rebuildKeyring(before: Set<string>): void {
        this.keyring = new Map();
        this.keyErrors = new Map();
        const mine = `${this.self}/`;
        for (const [id, versions] of this.spaces.get(KEYS_SPACE) ?? []) {
            if (!id.startsWith(mine)) continue;
            try {
                const record = versions[0].record;
                const keys = unwrapKeys(record, this.privateKey);
                // the header's epoch is what Membership judged: no key past it counts
                const past = keys.find((k) => k.epoch > record.epoch);
                if (past) throw new Error(`it carries a key for epoch ${past.epoch} under a header for epoch ${record.epoch}`);
                for (const key of keys) this.keyring.set(key.id, key);
            } catch (err) {
                const problem = `The network keys in ${KEYS_SPACE}/${id} can't be opened: ${errorMessage(err)}`;
                this.keyErrors.set(id, problem);
                logger.error(`[network] ${problem}`);
            }
        }
        // records under a key that just arrived can be read now
        const arrived = new Set([...this.keyring.keys()].filter((k) => !before.has(k)));
        if (!arrived.size) return;
        for (const [space, ids] of this.spaces) {
            if (space === KEYS_SPACE) continue;
            for (const [id, versions] of ids) if (arrived.has(versions[0].record.key)) this.touch(space, id);
        }
    }

    private view(v: Version): StoredRecord {
        const r = v.record;
        const meta: RecordMeta = { space: r.space, id: r.id, version: v.digest, wall: r.wall, counter: r.counter, author: r.author, epoch: r.epoch };
        if (r.deleted) return { ...meta, state: "deleted" };
        const key = this.keyring.get(r.key);
        if (!key) return { ...meta, state: "unreadable", error: `This computer doesn't hold network key ${r.key} (epoch ${r.epoch}) yet` };
        try {
            return { ...meta, state: "value", value: openBody(r, key) };
        } catch (err) {
            return { ...meta, state: "unreadable", error: `${r.space}/${r.id} can't be decrypted: ${errorMessage(err)}` };
        }
    }

    private async flush(): Promise<void> {
        // forgotten cursors first: a crash after this re-pulls for nothing,
        // one before it can't keep a cursor past what was thrown away
        if (this.cursorsDirty) await writeFileAtomic(path.join(this.dir, "cursors.json"), JSON.stringify(this.cursors));
        if (this.nextSeq > this.reservedSeq) {
            this.reservedSeq = this.nextSeq + SEQ_BLOCK;
            await writeFileAtomic(path.join(this.dir, "meta.json"), JSON.stringify({ log: this.log, reservedSeq: this.reservedSeq, owner: this.self }));
        }
        // A record moving between held and a space is written where it
        // lands before it leaves where it was: held is first saved with
        // what is moving out of it still in, then the spaces, then held as
        // it is. A crash in between leaves a copy in both, and load() drops
        // the held one.
        if (this.heldDirty) await this.writeHeld([...this.held.values(), ...this.leavingHeld.values()]);
        for (const [space, touched] of this.dirty) await this.writeBuckets(space, touched);
        if (this.leavingHeld.size) await this.writeHeld([...this.held.values()]);
        this.dirty.clear();
        this.heldDirty = false;
        this.cursorsDirty = false;
        this.leavingHeld.clear();
    }

    /** Saves the buckets that hold the touched ids, each as it is now; one left empty is removed. */
    private async writeBuckets(space: string, touched: Set<string>): Promise<void> {
        const ids = this.spaces.get(space);
        let index = this.buckets.get(space);
        if (!index) this.buckets.set(space, (index = new Map()));
        const write = new Set<string>();
        for (const id of touched) {
            const bucket = bucketOf(id);
            write.add(bucket);
            let held = index.get(bucket);
            if (!held) index.set(bucket, (held = new Set()));
            if (ids?.has(id)) held.add(id);
            else held.delete(id);
        }
        const folder = path.join(this.spacesDir, spaceFolder(space));
        ensurePrivateDir(folder);
        for (const bucket of [...write].sort()) {
            const file = path.join(folder, `${bucket}.json`);
            const inBucket = index.get(bucket)!;
            if (!inBucket.size) {
                index.delete(bucket);
                await fs.promises.rm(file, { force: true });
                continue;
            }
            const records = [...inBucket].flatMap((id) => ids!.get(id)!.map((v) => ({ seq: v.seq, record: v.record })));
            await writeFileAtomic(file, JSON.stringify({ records }));
        }
    }

    private writeHeld(records: WireRecord[]): Promise<void> {
        return writeFileAtomic(path.join(this.dir, "held.json"), JSON.stringify({ records }));
    }

    private announce(): void {
        const changed = this.changed;
        this.changed = new Map();
        for (const [space, ids] of changed) {
            for (const onChange of this.watchers.get(space) ?? []) {
                try {
                    onChange([...ids]);
                } catch (err) {
                    logger.error(`[network] a watcher of ${space} failed:`, err); // quiet: the change is saved; one watcher's failure must not reach the writer or the other watchers
                }
            }
        }
    }

    private announceAccepted(): void {
        for (const listener of this.acceptedListeners) {
            try {
                listener();
            } catch (err) {
                logger.error("[network] a listener for accepted records failed:", err); // quiet: the change is saved; one listener's failure must not reach the writer or the others
            }
        }
    }

    // In the store's line, so two peers' cursors never overwrite each other.
    // A pull cursor read before readmit() forgot the cursors is not saved:
    // false.
    private saveCursor(key: string, cursor: ChangeCursor | PushCursor, generation?: number): Promise<boolean> {
        return this.queue.run(async () => {
            if (generation !== undefined && generation !== this.pullGeneration) return false;
            const cursors = { ...this.cursors, [key]: cursor };
            await writeFileAtomic(path.join(this.dir, "cursors.json"), JSON.stringify(cursors));
            this.cursors = cursors;
            return true;
        });
    }

    private forgetPullCursors(): void {
        this.cursors = Object.fromEntries(Object.entries(this.cursors).filter(([key]) => !key.startsWith("pull:")));
        this.pullGeneration++;
        this.cursorsDirty = true;
    }

    private load(): void {
        ensurePrivateDir(this.dir);
        ensurePrivateDir(this.spacesDir);
        sweepTemps(this.dir);
        sweepTemps(this.spacesDir);

        const metaFile = path.join(this.dir, "meta.json");
        const meta = readJson(metaFile);
        if (meta === null) {
            this.log = crypto.randomBytes(16).toString("hex");
            this.reservedSeq = 0;
            writeJsonAtomicSync(metaFile, { log: this.log, reservedSeq: 0, owner: this.self });
        } else {
            const m = meta as { log?: unknown; reservedSeq?: unknown; owner?: unknown };
            if (typeof m.log !== "string" || !/^[0-9a-f]{32}$/.test(m.log) || !Number.isSafeInteger(m.reservedSeq) || (m.reservedSeq as number) < 0 || !isMemberId(m.owner)) {
                throw new RecordStoreCorruptError(metaFile, "its log id, sequence or owner is missing");
            }
            if (m.owner !== this.self) throw new RecordStoreOwnerError(this.dir, m.owner, this.self);
            this.log = m.log;
            this.reservedSeq = m.reservedSeq as number;
        }

        this.spaces = new Map();
        this.buckets = new Map();
        this.clock = { wall: 0, counter: 0 };
        let maxSeq = 0;
        for (const name of fs.readdirSync(this.spacesDir)) {
            const folder = path.join(this.spacesDir, name);
            const match = /^((?:[0-9a-f]{2})+)$/.exec(name);
            if (!match || !fs.statSync(folder).isDirectory()) throw new RecordStoreCorruptError(folder, "it isn't a space folder");
            const space = Buffer.from(match[1], "hex").toString("utf8");
            sweepTemps(folder);
            const ids = new Map<string, Version[]>();
            const index = new Map<string, Set<string>>();
            for (const fileName of fs.readdirSync(folder)) {
                const file = path.join(folder, fileName);
                const bucket = BUCKET_FILE_RE.exec(fileName)?.[1];
                if (!bucket) throw new RecordStoreCorruptError(file, "it isn't a bucket file");
                const inBucket = new Set<string>();
                for (const entry of recordsOf(file, readJson(file))) {
                    const { seq, record: raw } = (entry ?? {}) as { seq?: unknown; record?: unknown };
                    if (!Number.isSafeInteger(seq) || (seq as number) < 1) throw new RecordStoreCorruptError(file, "a record has no sequence number");
                    const record = parseStored(file, raw);
                    if (record.space !== space) throw new RecordStoreCorruptError(file, `it holds a record of ${record.space}`);
                    if (bucketOf(record.id) !== bucket) throw new RecordStoreCorruptError(file, `it holds ${record.id}, which belongs in bucket ${bucketOf(record.id)}`);
                    let versions = ids.get(record.id);
                    if (!versions) ids.set(record.id, (versions = []));
                    versions.push({ record, digest: recordDigest(record), seq: seq as number });
                    inBucket.add(record.id);
                    maxSeq = Math.max(maxSeq, seq as number);
                    this.see(record);
                }
                if (inBucket.size) index.set(bucket, inBucket);
            }
            for (const versions of ids.values()) versions.sort((a, b) => compareRecords(b, a));
            if (ids.size) this.spaces.set(space, ids);
            this.buckets.set(space, index);
        }
        this.nextSeq = Math.max(this.reservedSeq, maxSeq + 1);

        const kept = new Set<string>();
        for (const ids of this.spaces.values()) for (const versions of ids.values()) for (const v of versions) kept.add(v.digest);
        this.held = new Map();
        const heldFile = path.join(this.dir, "held.json");
        const held = readJson(heldFile);
        if (held !== null) {
            for (const raw of recordsOf(heldFile, held)) {
                const record = parseStored(heldFile, raw);
                const digest = recordDigest(record);
                if (!kept.has(digest)) this.held.set(digest, record);
            }
        }

        const cursorsFile = path.join(this.dir, "cursors.json");
        const cursors = readJson(cursorsFile) ?? {};
        if (typeof cursors !== "object" || Array.isArray(cursors)) throw new RecordStoreCorruptError(cursorsFile, "it isn't an object");
        for (const [key, value] of Object.entries(cursors)) {
            const c = value as Partial<PushCursor>;
            const sinkOk = key.startsWith("push:") ? typeof c?.sink === "string" : key.startsWith("pull:") && c?.sink === undefined;
            if (!sinkOk || !isCursor(c)) {
                throw new RecordStoreCorruptError(cursorsFile, `the cursor ${key} is malformed`);
            }
        }
        this.cursors = cursors as Record<string, ChangeCursor | PushCursor>;

        this.dirty = new Map();
        this.heldDirty = false;
        this.cursorsDirty = false;
        this.leavingHeld = new Map();
        this.rebuildKeyring(new Set());
        this.changed = new Map();
    }
}

function isCursor(c: unknown): c is ChangeCursor {
    const { log, after } = (c ?? {}) as Partial<ChangeCursor>;
    return typeof log === "string" && log.length > 0 && Number.isSafeInteger(after) && (after as number) >= 0;
}

// "@keys" is the store's own (createEpoch, shareKeys); "@roster" is read and
// written here like any space, by the roster alone (record.ts)
function checkOwnSpace(space: string): void {
    checkSpace(space);
    if (space.startsWith("@") && space !== ROSTER_SPACE) throw new Error(`${space} belongs to the record store itself`);
}

function count(result: ApplyResult, verdict: Verdict): void {
    if (verdict === "accepted") result.accepted++;
    else if (verdict === "known") result.known++;
    else if (verdict === "held") result.held++;
    else result.refused.push(verdict);
}

/** The parsed file, or null when it doesn't exist. Unparseable throws: damaged is not empty. */
function readJson(file: string): unknown {
    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (err) {
        if (errorCode(err) === "ENOENT") return null;
        throw err;
    }
    try {
        return JSON.parse(text);
    } catch (err) {
        throw new RecordStoreCorruptError(file, errorMessage(err));
    }
}

function recordsOf(file: string, parsed: unknown): unknown[] {
    const records = (parsed as { records?: unknown } | null)?.records;
    if (!Array.isArray(records)) throw new RecordStoreCorruptError(file, "it has no record list");
    return records;
}

function parseStored(file: string, raw: unknown): WireRecord {
    try {
        return parseWireRecord(raw);
    } catch (err) {
        throw new RecordStoreCorruptError(file, errorMessage(err));
    }
}

// a write a crash cut short leaves its temp file; nothing writes yet
function sweepTemps(dir: string): void {
    for (const name of fs.readdirSync(dir)) if (isWriteFileAtomicTemp(name)) fs.rmSync(path.join(dir, name), { force: true });
}
