// Where the roster's members are kept: in the record store (store.ts), one
// "@roster" record per member, so they can travel to every computer of the
// network like any other record. The roster (roster.ts) reads and writes
// them only through RosterStore. What one computer keeps for itself (its
// order, its pairing tokens) is in rosterPrivate.ts and never in a record.
//
// ─── A roster record ─────────────────────────────────────────────────────────
//
//   space  "@roster" (record.ts: the network's own spaces, which nothing a
//          panel or the app writes can reach)
//   id     the member id of the computer it is about
//   value  {"cert": PEM, "name"?: text, "dial"?: {"host", "address"?, "port"},
//           "facts": {...}}: what every computer may know of it. The cert's
//          key must hash to the id; a record that breaks that, or any field
//          of it, is left out of the roster and kept in the store as it is.
//
// One record per member, so computers that change different members never
// conflict; two that change one member apart keep both versions, the later
// one winning (store.ts).
//
// ─── Who is a member ─────────────────────────────────────────────────────────
//
// The store asks the roster (Membership) who may write; the roster is itself
// records the store admitted. That is no circle: this computer is a member by
// its own key, without any record, and every other member is one because a
// "@roster" record about it was admitted from a computer that already was. A
// record whose author isn't a member yet is held by the store, and every
// change to who is a member asks the store to readmit() what it holds, so a
// member and the records that need it arrive in any order.
//
// ─── A new computer ──────────────────────────────────────────────────────────
//
// Its first start makes the network's first key epoch, with itself as its
// only member, and then the roster writes this computer's own record. A
// crash between the two finds the key on the next start and only writes the
// record; the key is made only while this computer holds none.
import * as fs from "fs";
import { logger } from "../core/logger";
import { errorMessage } from "@mileniumhq/paperapi/errors";
import type { RosterDial, RosterFacts, RosterMember } from "@mileniumhq/paperapi/protocol";
import type { IdentityPart } from "@mileniumhq/paperapi";
import type { TlsIdentity } from "../security/tlsIdentity";
import { ROSTER_SPACE } from "./record";
import { RecordStore, RecordStoreOwnerError, type StoredRecord } from "./store";
import { memberIdOf } from "./memberId";

/** the record store's folder in local/ */
export const NETWORK_DIR = "network";

export interface RosterStore {
    /** every member it holds now */
    members(): RosterMember[];
    /** adds the member, or replaces the one with its id; the same member again saves nothing */
    write(member: RosterMember): Promise<void>;
    remove(id: string): Promise<void>;
    /** hears every member written or removed, by anyone; returns the unsubscribe */
    watch(listener: (id: string, member: RosterMember | null) => void): () => void;
    close(): void;
}

const TEXT_MAX = 255;
const CERT_MAX = 16_384;

const isText = (value: unknown, max = TEXT_MAX): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const isPort = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0 && (value as number) <= 65535;

function readPart(value: unknown): IdentityPart | null {
    if (!value || typeof value !== "object") return null;
    const { id, name, version } = value as Record<string, unknown>;
    if (!isText(id) || !isText(name) || (version !== undefined && !isText(version))) return null;
    return version === undefined ? { id, name } : { id, name, version };
}

/** A daemon's account of its computer, keeping only what each field may hold; null when a field holds something else. */
export function readFacts(value: unknown): RosterFacts | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const given = value as Record<string, unknown>;
    const facts: RosterFacts = {};
    for (const key of ["os", "osVersion", "distroId", "distroName", "board", "arch"] as const) {
        const field = given[key];
        if (field === undefined) continue;
        if (!isText(field)) return null;
        facts[key] = field;
    }
    for (const key of ["flavor", "machine", "operator"] as const) {
        if (given[key] === undefined) continue;
        const part = readPart(given[key]);
        if (!part) return null;
        facts[key] = part;
    }
    return facts;
}

/** Where a computer is dialed, or null when it is no such thing. */
export function readDial(value: unknown): RosterDial | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const { host, address, port } = value as Record<string, unknown>;
    if (!isText(host) || !isPort(port) || (address !== undefined && !isText(address))) return null;
    return address === undefined || address === host ? { host, port } : { host, address, port };
}

function holdsKeyOf(id: string, cert: string): boolean {
    try {
        return memberIdOf(cert) === id;
    } catch {
        return false; // quiet: a certificate that doesn't parse holds no key, and the record is reported as damaged
    }
}

/** A roster record's value as the member it describes, or why it isn't one. */
function readMember(id: string, value: unknown): RosterMember | string {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "it isn't an object";
    const given = value as Record<string, unknown>;
    if (!isText(given.cert, CERT_MAX) || !holdsKeyOf(id, given.cert)) return "its certificate isn't the key its id names";
    if (given.name !== undefined && !isText(given.name)) return "its name is damaged";
    const facts = readFacts(given.facts);
    if (!facts) return "its OS details are damaged";
    const dial = given.dial === undefined ? undefined : readDial(given.dial);
    if (dial === null) return "its address is damaged";
    return {
        id,
        ...(given.name !== undefined ? { name: given.name as string } : {}),
        ...(dial ? { dial } : {}),
        cert: given.cert,
        facts,
    };
}

/** What a member's record holds: the member without its id, which is the record's. */
function valueOf(member: RosterMember): Omit<RosterMember, "id"> {
    const { id: _id, ...value } = member;
    return value;
}


/** The roster's members as "@roster" records in this computer's record store (local/network/). */
export class RosterRecords implements RosterStore {
    private readonly byId = new Map<string, RosterMember>();
    private readonly listeners = new Set<(id: string, member: RosterMember | null) => void>();
    private readonly self: string;
    private unwatch: (() => void) | null = null;
    /** the store the members are records in: its own rules for who may write are this roster's */
    readonly records: RecordStore;

    private constructor(dir: string, private readonly identity: TlsIdentity) {
        this.self = memberIdOf(identity.cert);
        this.records = RecordStore.open({
            dir,
            identity,
            membership: {
                certFor: (author) => this.certFor(author),
                admits: (header) => this.certFor(header.author) !== null,
            },
        });
    }

    /**
     * The roster in `dir`, made with this computer's first network key when
     * it is new. A store left by another key (this daemon's identity was
     * replaced, so it is a new computer to every other) is moved aside whole
     * and a new one started; nothing in it can be read without that key.
     */
    static async open(dir: string, identity: TlsIdentity): Promise<RosterRecords> {
        let roster: RosterRecords;
        try {
            roster = new RosterRecords(dir, identity);
        } catch (err) {
            if (!(err instanceof RecordStoreOwnerError)) throw err;
            const aside = `${dir}.replaced-${Date.now()}`;
            fs.renameSync(dir, aside);
            logger.error(
                `[roster] ${err.message} This daemon's key was replaced, so it is a new computer: its computer list starts over, and the old one is kept in ${aside} (it opens again only with the old local/tls_identity.json).`,
            );
            roster = new RosterRecords(dir, identity);
        }
        await roster.start();
        return roster;
    }

    private async start(): Promise<void> {
        const keys = this.records.networkKeys();
        if (!keys.current) {
            // a key record addressed here that can't be opened is damage: a second first epoch would hide it
            if (keys.problems.length) throw new Error(`This computer's network keys can't be opened: ${keys.problems.join("; ")}`);
            await this.records.createEpoch([this.identity.cert]);
        }
        for (const record of this.records.list(ROSTER_SPACE)) this.take(record.id, record);
        this.unwatch = this.records.watch(ROSTER_SPACE, (ids) => this.changed(ids));
        // a change to who is a member that a crash cut off before its readmit
        await this.records.readmit();
    }

    private certFor(author: string): string | null {
        if (author === this.self) return this.identity.cert;
        return this.byId.get(author)?.cert ?? null;
    }

    /** reads the record into the roster; one that isn't a member is left out, loudly, and stays in the store */
    private take(id: string, record: StoredRecord | null): RosterMember | null {
        if (!record) {
            this.byId.delete(id);
            return null;
        }
        // get() and list() give no deleted record
        const member = record.state === "value" ? readMember(id, record.value) : record.state === "unreadable" ? record.error : "it is deleted";
        if (typeof member === "string") {
            this.byId.delete(id);
            logger.error(`[roster] the computer record ${ROSTER_SPACE}/${id} (version ${record.version}, written by ${record.author}) is left out of the list: ${member}`);
            return null;
        }
        this.byId.set(id, member);
        return member;
    }

    private changed(ids: string[]): void {
        let membership = false;
        for (const id of ids) {
            const before = this.byId.get(id);
            const after = this.take(id, this.records.get(ROSTER_SPACE, id));
            if (before?.cert !== after?.cert) membership = true;
            if (!after && !before) continue;
            for (const listener of this.listeners) listener(id, after);
        }
        // records waiting on a member that just came, and records of one that just went
        if (membership) {
            this.records.readmit().catch((err) => {
                logger.error(`[roster] the records waiting on the computer list couldn't be asked about again (the next start asks): ${errorMessage(err)}`); // quiet: nothing waits on this; the next roster change and the next start readmit again
            });
        }
    }

    members(): RosterMember[] {
        return [...this.byId.values()];
    }

    async write(member: RosterMember): Promise<void> {
        // written as it is read back, so what one computer writes every other lists
        const next = readMember(member.id, valueOf(member));
        if (typeof next === "string") throw new Error(`The computer ${member.id} can't be saved: ${next}`);
        if (JSON.stringify(this.byId.get(member.id)) === JSON.stringify(next)) return;
        await this.records.put(ROSTER_SPACE, member.id, valueOf(next));
    }

    async remove(id: string): Promise<void> {
        if (!this.byId.has(id)) return;
        await this.records.delete(ROSTER_SPACE, id);
    }

    watch(listener: (id: string, member: RosterMember | null) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    close(): void {
        this.unwatch?.();
        this.listeners.clear();
    }
}
