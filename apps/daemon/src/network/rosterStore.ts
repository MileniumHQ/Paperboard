// Where the roster's members are kept: in the record store (store.ts), so
// they travel to every computer of the network like any other record. The
// roster (roster.ts) reads and writes them only through RosterStore. What
// one computer keeps for itself (its order, its pairing tokens, where it
// reached each member) is in rosterPrivate.ts and never in a record.
//
// ─── A roster record: a computer's certificate, and what people call it ──────
//
//   space  "@roster" (record.ts: the network's own spaces, which nothing a
//          panel or the app writes can reach)
//   id     the member id of the computer it is about
//   value  {"cert": PEM, "name"?: text}. The cert's key must be P-256 and
//          hash to the id; a record that breaks that, or whose name is
//          damaged, is left out of the roster and kept in the store as it
//          is. Any member writes it: a person renames a computer from any
//          computer.
//
// ─── A self record: what a computer says of itself ───────────────────────────
//
//   space  "@self"; its id is the member id of its author (record.ts refuses
//          any other), so no computer can say where another is or what it
//          runs
//   value  {"dial"?: {"host", "port"}, "facts": {...}}: where it listens
//          (the name it answers to and its port; no dial while nobody can
//          dial it) and its OS. A damaged one is left out like a roster
//          record.
//
// Where a member is reached from here (an IP it answered at, the address it
// was paired at) and what this computer was told of a member that hasn't
// written its own self record (a computer paired by an older Paperboard)
// are this computer's observations (rosterPrivate.ts).
//
// One record per member in each space, so computers that change different
// members never conflict; two that rename one member apart keep both
// versions, the later one winning (store.ts).
//
// ─── Listed, and a member ────────────────────────────────────────────────────
//
// A "@roster" record lists a computer: the app shows it, and this computer
// may hold a pairing for it. Listing alone lets it into nothing. A listed
// computer is a member, one whose records are accepted and that links are
// made with, only once a member has shared the network's keys with it: there
// is an accepted "@keys" record addressed to it, written by this computer or
// by another member (store.ts keyShares). Sharing keys is the act of letting
// a computer in, which only joining does, and nothing joins yet; a pairing an
// older Paperboard made, or one typed in today, lists a computer and shares
// nothing, so the two neither link nor take each other's records.
//
// This computer is listed, and a member, by its own key, without any record
// (a roster record about it only names it). A record
// whose author isn't a member is held by the store, and every change to who
// is one asks the store to readmit() what it holds, so a member and the
// records that need it arrive in any order.
//
// A record's winner this computer can't read (its key hasn't come yet), or
// that is damaged, takes no computer off the list: the newest version that
// reads is what is listed, and the list says so loudly. Only a delete does.
//
// ─── A new computer ──────────────────────────────────────────────────────────
//
// Its first start makes the network's first key epoch, with itself as its
// only member, and then the roster writes this computer's own record. A
// crash between the two finds the key on the next start and only writes the
// record; the key is made only while this computer holds none.
import * as crypto from "crypto";
import * as fs from "fs";
import { logger } from "../core/logger";
import { errorMessage } from "@mileniumhq/paperapi/errors";
import type { RosterDial, RosterFacts } from "@mileniumhq/paperapi/protocol";
import type { IdentityPart } from "@mileniumhq/paperapi";
import type { TlsIdentity } from "../security/tlsIdentity";
import { KEYS_SPACE, ROSTER_SPACE, SELF_SPACE } from "./record";
import { RecordStore, RecordStoreOwnerError } from "./store";
import { memberIdOf } from "./memberId";

/** the record store's folder in local/ */
export const NETWORK_DIR = "network";

/** Where a computer says it listens: the name it answers to and its port, nothing observed from one place. */
export type SharedDial = Omit<RosterDial, "address">;

/** What a computer says of itself (its "@self" record). */
export interface SelfAbout {
    dial?: SharedDial;
    facts: RosterFacts;
}

/** A member as every computer may know it: its roster record, and what it said of itself once it has. */
export interface SharedMember {
    id: string;
    cert: string;
    name?: string;
    about?: SelfAbout;
}

export interface RosterStore {
    /** every computer a roster record lists */
    members(): SharedMember[];
    /** adds the member, or replaces the one with its id; the same member again saves nothing. `about` is never written: only updateSelf() writes this computer's */
    write(member: SharedMember): Promise<void>;
    /**
     * Changes what this computer says of itself, for every member to read:
     * `change` is given what it says now (null before it has said anything)
     * and answers the whole of it, decided in the record store's line, so
     * two changes at once never drop each other's fields. The same again
     * saves nothing.
     */
    updateSelf(change: (current: SelfAbout | null) => SelfAbout): Promise<void>;
    remove(id: string): Promise<void>;
    /** hears every computer whose listing, what it says of itself, or whose being a member changed; returns the unsubscribe */
    watch(listener: (id: string, member: SharedMember | null) => void): () => void;
    /** whether the computer is a member: listed, and let in by a member (the top of rosterStore.ts); this computer always is */
    isMember(id: string): boolean;
    /** resolves once what was written before it is saved */
    close(): Promise<void>;
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

/** whether the certificate holds the key `id` names, and it is a daemon's kind of key (ECDSA P-256), the only kind records are verified with */
function holdsKeyOf(id: string, cert: string): boolean {
    try {
        const key = new crypto.X509Certificate(cert).publicKey;
        return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1" && memberIdOf(cert) === id;
    } catch {
        return false; // quiet: a certificate that doesn't parse holds no key, and the record is reported as damaged
    }
}

type RosterValue = { cert: string; name?: string };

/** A roster record's value, or why it isn't one. */
function readMember(id: string, value: unknown): RosterValue | string {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "it isn't an object";
    const given = value as Record<string, unknown>;
    if (!isText(given.cert, CERT_MAX) || !holdsKeyOf(id, given.cert)) return "its certificate isn't the P-256 key its id names";
    if (given.name !== undefined && !isText(given.name)) return "its name is damaged";
    return { cert: given.cert, ...(given.name !== undefined ? { name: given.name as string } : {}) };
}

/** A self record's value, or why it isn't one. */
function readAbout(value: unknown): SelfAbout | string {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "it isn't an object";
    const given = value as Record<string, unknown>;
    const facts = readFacts(given.facts);
    if (!facts) return "its OS details are damaged";
    const dial = given.dial === undefined ? undefined : readDial(given.dial);
    if (dial === null) return "its address is damaged";
    if (dial?.address !== undefined) return "its address holds an IP, which is where another computer reached it";
    return { ...(dial ? { dial } : {}), facts };
}

/** The roster's members as "@roster" and "@self" records in this computer's record store (local/network/). */
export class RosterRecords implements RosterStore {
    /** member id → its roster record, as read */
    private readonly byId = new Map<string, RosterValue>();
    /** member id → its self record, as read; kept for a computer not (or not yet) listed, unused until it is */
    private readonly abouts = new Map<string, SelfAbout>();
    private readonly listeners = new Set<(id: string, member: SharedMember | null) => void>();
    /** id → each computer listed, as its listeners last heard it */
    private told = new Map<string, string>();
    private readonly self: string;
    /** the listed computers that are members, this one among them; null until worked out, and after anything it depends on changes */
    private memberIds: Set<string> | null = null;
    private readonly unwatch: (() => void)[] = [];
    /** the store the members are records in: its own rules for who may write are this roster's */
    readonly records: RecordStore;

    private constructor(dir: string, private readonly identity: TlsIdentity) {
        this.self = memberIdOf(identity.cert);
        this.records = RecordStore.open({
            dir,
            identity,
            membership: {
                certFor: (author) => this.certFor(author),
                admits: (header) => this.isMember(header.author),
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
        for (const record of this.records.list(ROSTER_SPACE)) this.take(ROSTER_SPACE, record.id);
        for (const record of this.records.list(SELF_SPACE)) this.take(SELF_SPACE, record.id);
        this.told = this.listing();
        this.unwatch.push(this.records.watch(ROSTER_SPACE, (ids) => this.changed(ROSTER_SPACE, ids)));
        this.unwatch.push(this.records.watch(SELF_SPACE, (ids) => this.changed(SELF_SPACE, ids)));
        // a key shared with anyone: who is a member may have changed
        this.unwatch.push(this.records.watch(KEYS_SPACE, () => this.changed(KEYS_SPACE, [])));
        // a change to who is a member that a crash cut off before its readmit
        await this.records.readmit();
    }

    /** the certificate of a member; the store verifies no one else's records */
    private certFor(author: string): string | null {
        if (author === this.self) return this.identity.cert;
        return this.isMember(author) ? (this.byId.get(author)?.cert ?? null) : null;
    }

    isMember(id: string): boolean {
        return (this.memberIds ??= this.workOutMembers()).has(id);
    }

    /** this computer, and every listed computer a member shared keys with: found from this computer outward */
    private workOutMembers(): Set<string> {
        const members = new Set([this.self]);
        const shares = this.records.keyShares().filter((share) => this.byId.has(share.recipient));
        for (let grew = true; grew; ) {
            grew = false;
            for (const { recipient, creator } of shares) {
                if (members.has(recipient) || !members.has(creator)) continue;
                members.add(recipient);
                grew = true;
            }
        }
        return members;
    }

    private shared(id: string): SharedMember | null {
        // this computer is listed by its own key; a record about it only names it
        const member = this.byId.get(id) ?? (id === this.self ? { cert: this.identity.cert } : null);
        if (!member) return null;
        const about = this.abouts.get(id);
        return { id, ...member, ...(about ? { about } : {}) };
    }

    /** every computer listed now, as its listeners hear it, with whether it is a member: links follow that */
    private listing(): Map<string, string> {
        const out = new Map<string, string>();
        for (const id of this.ids()) out.set(id, JSON.stringify([this.shared(id), this.isMember(id)]));
        return out;
    }

    /**
     * Reads the newest version of a computer's roster or self record that
     * reads. A winner that doesn't read is said loudly (unless only its key
     * hasn't come yet: it reads when it does) and takes nothing away; a
     * deleted winner, or no record, does.
     */
    private take(space: typeof ROSTER_SPACE | typeof SELF_SPACE, id: string): void {
        const into: Map<string, unknown> = space === ROSTER_SPACE ? this.byId : this.abouts;
        const read = (value: unknown): unknown => (space === ROSTER_SPACE ? readMember(id, value) : readAbout(value));
        const [winner, ...earlier] = this.records.versions(space, id);
        if (!winner || winner.state === "deleted") {
            into.delete(id);
            return;
        }
        for (const version of [winner, ...earlier]) {
            const value = version.state === "value" ? read(version.value) : version.state === "unreadable" ? version.error : "it is deleted";
            if (typeof value !== "string") {
                into.set(id, value);
                return;
            }
            const waiting = version.state === "unreadable" && version.awaitingKey;
            if (version === winner && !waiting) {
                logger.error(`[roster] the computer record ${space}/${id} (version ${winner.version}, written by ${winner.author}) can't be read: ${value}. The newest version that reads is used instead.`);
            }
        }
        // none of its versions reads: what was read before, if anything, stays
    }

    /** records of a space changed (their ids, for "@roster" and "@self"): every computer whose listing or membership changed is told */
    private changed(space: string, ids: string[]): void {
        if (space === ROSTER_SPACE || space === SELF_SPACE) for (const id of ids) this.take(space, id);
        const wasMember = this.memberIds ?? this.workOutMembers();
        this.memberIds = null;
        const before = this.told;
        this.told = this.listing();
        let membership = false;
        for (const id of new Set([...before.keys(), ...this.told.keys()])) {
            if (wasMember.has(id) !== this.isMember(id)) membership = true;
            if (before.get(id) === this.told.get(id)) continue;
            const member = this.shared(id);
            for (const listener of this.listeners) listener(id, member);
        }
        // records waiting on a member that just came, and records of one that just went
        if (membership) {
            this.records.readmit().catch((err) => {
                logger.error(`[roster] the records waiting on the computer list couldn't be asked about again (the next start asks): ${errorMessage(err)}`); // quiet: nothing waits on this; the next roster change and the next start readmit again
            });
        }
    }

    /** this computer, then every computer a roster record lists */
    private ids(): string[] {
        return [this.self, ...[...this.byId.keys()].filter((id) => id !== this.self)];
    }

    members(): SharedMember[] {
        return this.ids().map((id) => this.shared(id)!);
    }

    async write(member: SharedMember): Promise<void> {
        // written as it is read back, so what one computer writes every other lists
        const value: RosterValue = { cert: member.cert, ...(member.name !== undefined ? { name: member.name } : {}) };
        const next = readMember(member.id, value);
        if (typeof next === "string") throw new Error(`The computer ${member.id} can't be saved: ${next}`);
        if (JSON.stringify(this.byId.get(member.id)) === JSON.stringify(next)) return;
        await this.records.put(ROSTER_SPACE, member.id, next);
    }

    async updateSelf(change: (current: SelfAbout | null) => SelfAbout): Promise<void> {
        await this.records.write(SELF_SPACE, this.self, (winner) => {
            const read = winner?.state === "value" ? readAbout(winner.value) : null;
            // what doesn't read (damaged, or deleted) is said again whole
            const current = typeof read === "string" ? null : read;
            const next = readAbout(change(current));
            if (typeof next === "string") throw new Error(`What this computer says of itself can't be saved: ${next}`);
            return JSON.stringify(current) === JSON.stringify(next) ? null : { value: next };
        });
    }

    async remove(id: string): Promise<void> {
        if (!this.byId.has(id)) return;
        await this.records.delete(ROSTER_SPACE, id);
    }

    watch(listener: (id: string, member: SharedMember | null) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Stops listing; the store saves what was queued (RecordStore.close). */
    close(): Promise<void> {
        for (const unwatch of this.unwatch.splice(0)) unwatch();
        this.listeners.clear();
        return this.records.close();
    }
}
