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
// So what a computer holds depends only on the records it has seen and the
// rule's answers, never on the order they came in. A forged or malformed
// record is refused for good.
//
// ─── Disk ────────────────────────────────────────────────────────────────────
//
//   <dir>/meta.json            {"log", "reservedSeq"}: sequence numbers below
//                              reservedSeq may have been handed out
//   <dir>/spaces/<hex>.json    {"records": [{"seq", "record"}]} per space,
//                              its name as hex of UTF-8 (case-proof filenames)
//   <dir>/held.json            {"records": [record]}
//   <dir>/cursors.json         {"pull:<peer>": {"log", "after"},
//                               "push:<peer>": {"log", "after", "sink"}}
//
// Each file is replaced whole (writeFileAtomic), so a crash leaves it old or
// new. A change that spans files writes where a record goes before where it
// leaves, and loading drops a held copy of a record already kept. A file
// that doesn't parse stops the store from opening: it is never read as
// empty, because starting over would hand out sequence numbers peers have
// already passed and lose records only this computer had.
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
    type NetworkKey,
    type RecordHeader,
    type WireRecord,
    checkId,
    checkSpace,
    compareRecords,
    fingerprintOf,
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
const SEQ_BLOCK = 1024;
const MAX_COUNTER = 0xffff_ffff;

/** Who may write, injected by the roster. */
export interface Membership {
    /** The certificate (PEM) of the computer with this fingerprint, or null when it isn't known. */
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

const spaceFile = (space: string) => `${Buffer.from(space, "utf8").toString("hex")}.json`;

export class RecordStore {
    readonly fingerprint: string;
    private readonly dir: string;
    private readonly spacesDir: string;
    private readonly privateKey: crypto.KeyObject;
    private readonly membership: Membership;
    private readonly now: () => number;
    private readonly queue = new SerialQueue();
    private readonly peerLines = new KeyedQueue();
    private readonly watchers = new Map<string, Set<(ids: string[]) => void>>();

    // loaded state: load() replaces all of it
    private log = "";
    private reservedSeq = 0;
    private nextSeq = 1;
    private clock = { wall: 0, counter: 0 };
    /** space → id → versions, the winner first */
    private spaces = new Map<string, Map<string, Version[]>>();
    private held = new Map<string, WireRecord>();
    private cursors: Record<string, ChangeCursor | PushCursor> = {};
    private keyring = new Map<string, NetworkKey>();
    private keyErrors = new Map<string, string>();

    // what the running change touched, saved and announced by flush()
    private dirtySpaces = new Set<string>();
    private heldDirty = false;
    /** held records accepted by the running change, until flush() has saved them in their space */
    private leavingHeld = new Map<string, WireRecord>();
    private changed = new Map<string, Set<string>>();

    private constructor(options: RecordStoreOptions) {
        this.dir = options.dir;
        this.spacesDir = path.join(options.dir, "spaces");
        this.privateKey = crypto.createPrivateKey(options.identity.key);
        this.fingerprint = fingerprintOf(options.identity.cert);
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

    /** The network keys this computer holds (no key bytes), and why any "@keys" record addressed to it could not be opened. */
    networkKeys(): { keys: { epoch: number; id: string }[]; current: { epoch: number; id: string } | null; problems: string[] } {
        const current = this.writeKey();
        return {
            keys: [...this.keyring.values()].map((k) => ({ epoch: k.epoch, id: k.id })).sort((a, b) => a.epoch - b.epoch || (a.id < b.id ? -1 : 1)),
            current: current && { epoch: current.epoch, id: current.id },
            problems: [...this.keyErrors.values()],
        };
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
            if (!memberCerts.some((c) => fingerprintOf(c) === this.fingerprint)) {
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
     * and then for clocks.
     */
    readmit(): Promise<ApplyResult> {
        return this.change(() => {
            const result: ApplyResult = { accepted: 0, known: 0, held: 0, refused: [] };
            for (const [space, ids] of this.spaces) {
                for (const [id, versions] of ids) {
                    const kept = versions.filter((v) => this.membership.admits(headerOf(v.record)));
                    if (kept.length === versions.length) continue;
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

    /** Takes what `peer` has that this store hasn't seen from it yet, batch by batch, remembering where it got to. */
    pull(peer: string, source: RecordSource, limit = 500): Promise<ApplyResult> {
        const key = `pull:${peer}`;
        return this.peerLines.run(key, async () => {
            const total: ApplyResult = { accepted: 0, known: 0, held: 0, refused: [] };
            for (;;) {
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
                await this.saveCursor(key, { log: batch.log, after: batch.next });
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

    /** Runs `mutate` alone, saves what it touched, then tells watchers. Any failure puts the store back to what is on disk. */
    private change<T>(mutate: () => T): Promise<T> {
        return this.queue.run(async () => {
            const keysBefore = new Set(this.keyring.keys());
            try {
                const out = mutate();
                if (this.dirtySpaces.has(KEYS_SPACE)) this.rebuildKeyring(keysBefore);
                await this.flush();
                this.announce();
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
        const header: RecordHeader = { space, id, ...this.tick(), author: this.fingerprint, deleted, epoch: key.epoch, key: key.id };
        const body = deleted ? Buffer.alloc(0) : sealBody(header, key, value);
        const record = signRecord(header, body, this.privateKey);
        const digest = recordDigest(record);
        const verdict = this.consider(record, digest, "local");
        if (verdict !== "accepted") throw new Error(`This computer's write of ${space}/${id} was not accepted (${JSON.stringify(verdict)})`);
        return this.view(this.spaces.get(space)!.get(id)![0]);
    }

    private publishKeys(memberCerts: string[], keys: NetworkKey[]): void {
        const epoch = Math.max(...keys.map((k) => k.epoch));
        for (const cert of new Map(memberCerts.map((c) => [fingerprintOf(c), c])).values()) {
            const header: RecordHeader = {
                space: KEYS_SPACE,
                id: keysRecordId(fingerprintOf(cert), this.fingerprint),
                ...this.tick(),
                author: this.fingerprint,
                deleted: false,
                epoch,
                key: "",
            };
            const record = signRecord(header, wrapKeys(header, cert, keys), this.privateKey);
            const verdict = this.consider(record, recordDigest(record), "local");
            if (verdict !== "accepted") throw new Error(`This computer's keys for ${fingerprintOf(cert)} were not accepted (${JSON.stringify(verdict)})`);
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
            if (fingerprintOf(cert) !== record.author) throw new Error(`The roster's certificate for ${record.author} is another computer's`);
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
        this.dirtySpaces.add(space);
        let ids = this.changed.get(space);
        if (!ids) this.changed.set(space, (ids = new Set()));
        ids.add(id);
    }

    private rebuildKeyring(before: Set<string>): void {
        this.keyring = new Map();
        this.keyErrors = new Map();
        const mine = `${this.fingerprint}/`;
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
        if (this.nextSeq > this.reservedSeq) {
            this.reservedSeq = this.nextSeq + SEQ_BLOCK;
            await writeFileAtomic(path.join(this.dir, "meta.json"), JSON.stringify({ log: this.log, reservedSeq: this.reservedSeq }));
        }
        // A record moving between held and a space is written where it
        // lands before it leaves where it was: held is first saved with
        // what is moving out of it still in, then the spaces, then held as
        // it is. A crash in between leaves a copy in both, and load() drops
        // the held one.
        if (this.heldDirty) await this.writeHeld([...this.held.values(), ...this.leavingHeld.values()]);
        for (const space of this.dirtySpaces) {
            const ids = this.spaces.get(space);
            const records = ids ? [...ids.values()].flat().map((v) => ({ seq: v.seq, record: v.record })) : [];
            await writeFileAtomic(path.join(this.spacesDir, spaceFile(space)), JSON.stringify({ records }));
        }
        if (this.leavingHeld.size) await this.writeHeld([...this.held.values()]);
        this.dirtySpaces.clear();
        this.heldDirty = false;
        this.leavingHeld.clear();
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

    // in the store's line, so two peers' cursors never overwrite each other
    private saveCursor(key: string, cursor: ChangeCursor | PushCursor): Promise<void> {
        return this.queue.run(async () => {
            const cursors = { ...this.cursors, [key]: cursor };
            await writeFileAtomic(path.join(this.dir, "cursors.json"), JSON.stringify(cursors));
            this.cursors = cursors;
        });
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
            writeJsonAtomicSync(metaFile, { log: this.log, reservedSeq: 0 });
        } else {
            const m = meta as { log?: unknown; reservedSeq?: unknown };
            if (typeof m.log !== "string" || !/^[0-9a-f]{32}$/.test(m.log) || !Number.isSafeInteger(m.reservedSeq) || (m.reservedSeq as number) < 0) {
                throw new RecordStoreCorruptError(metaFile, "its log id or sequence is missing");
            }
            this.log = m.log;
            this.reservedSeq = m.reservedSeq as number;
        }

        this.spaces = new Map();
        this.clock = { wall: 0, counter: 0 };
        let maxSeq = 0;
        for (const name of fs.readdirSync(this.spacesDir)) {
            const file = path.join(this.spacesDir, name);
            const match = /^((?:[0-9a-f]{2})+)\.json$/.exec(name);
            if (!match) throw new RecordStoreCorruptError(file, "it isn't a space file");
            const space = Buffer.from(match[1], "hex").toString("utf8");
            const ids = new Map<string, Version[]>();
            for (const entry of recordsOf(file, readJson(file))) {
                const { seq, record: raw } = (entry ?? {}) as { seq?: unknown; record?: unknown };
                if (!Number.isSafeInteger(seq) || (seq as number) < 1) throw new RecordStoreCorruptError(file, "a record has no sequence number");
                const record = parseStored(file, raw);
                if (record.space !== space) throw new RecordStoreCorruptError(file, `it holds a record of ${record.space}`);
                let versions = ids.get(record.id);
                if (!versions) ids.set(record.id, (versions = []));
                versions.push({ record, digest: recordDigest(record), seq: seq as number });
                maxSeq = Math.max(maxSeq, seq as number);
                this.see(record);
            }
            for (const versions of ids.values()) versions.sort((a, b) => compareRecords(b, a));
            if (ids.size) this.spaces.set(space, ids);
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

        this.dirtySpaces = new Set();
        this.heldDirty = false;
        this.leavingHeld = new Map();
        this.rebuildKeyring(new Set());
        this.changed = new Map();
    }
}

function isCursor(c: unknown): c is ChangeCursor {
    const { log, after } = (c ?? {}) as Partial<ChangeCursor>;
    return typeof log === "string" && log.length > 0 && Number.isSafeInteger(after) && (after as number) >= 0;
}

function checkOwnSpace(space: string): void {
    checkSpace(space);
    if (space.startsWith("@")) throw new Error(`${space} belongs to the record store itself`);
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
