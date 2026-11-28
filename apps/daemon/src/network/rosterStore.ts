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
//   value  {"cert": PEM, "name"?: text, "dial"?: {"host", "port"},
//           "facts": {...}}: what is true of it from every computer. The
//          cert's key must hash to the id; a record that breaks that, or any
//          field of it, is left out of the roster and kept in the store as
//          it is. "host" is the name it answers to (its .local name, or what
//          it was paired at); the IP it last answered at is what one
//          computer observed from where it is, so it is kept in that
//          computer's own file (rosterPrivate.ts), never here.
//
// One record per member, so computers that change different members never
// conflict; two that change one member apart keep both versions, the later
// one winning (store.ts).
//
// ─── Listed, and a member ────────────────────────────────────────────────────
//
// A "@roster" record lists a computer: the app shows it, and this computer
// may hold a pairing for it. Listing alone lets it into nothing. A listed
// computer is a member, one whose records are accepted and that links are
// made with, only once a member has shared the network's keys with it: there
// is an accepted "@keys" record addressed to it, written by this computer or
// by another member (store.ts keyShares). Sharing keys is the act of letting
// a computer in, which only joining does; a pairing an older Paperboard made,
// or one typed in today, lists a computer and shares nothing, so the two
// neither link nor take each other's records.
//
// This computer is a member by its own key, without any record. A record
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
import type { RosterDial, RosterFacts, RosterMember } from "@mileniumhq/paperapi/protocol";
import type { IdentityPart } from "@mileniumhq/paperapi";
import type { TlsIdentity } from "../security/tlsIdentity";
import { KEYS_SPACE, ROSTER_SPACE } from "./record";
import { RecordStore, RecordStoreOwnerError } from "./store";
import { memberIdOf } from "./memberId";

/** the record store's folder in local/ */
export const NETWORK_DIR = "network";

/** A member as every computer may know it: its dial holds the name it answers to and its port, nothing observed from one place. */
export type SharedMember = Omit<RosterMember, "dial"> & { dial?: SharedDial };
export type SharedDial = Omit<RosterDial, "address">;

export interface RosterStore {
    /** every member it holds now */
    members(): SharedMember[];
    /** adds the member, or replaces the one with its id; the same member again saves nothing */
    write(member: SharedMember): Promise<void>;
    remove(id: string): Promise<void>;
    /** hears every member written or removed, by anyone, and every listed computer that became or stopped being a member; returns the unsubscribe */
    watch(listener: (id: string, member: SharedMember | null) => void): () => void;
    /** whether the computer is a member: listed, and let in by a member (the top of rosterStore.ts); this computer always is */
    isMember(id: string): boolean;
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

/** whether the certificate holds the key `id` names, and it is a daemon's kind of key (ECDSA P-256), the only kind records are verified with */
function holdsKeyOf(id: string, cert: string): boolean {
    try {
        const key = new crypto.X509Certificate(cert).publicKey;
        return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1" && memberIdOf(cert) === id;
    } catch {
        return false; // quiet: a certificate that doesn't parse holds no key, and the record is reported as damaged
    }
}

/** A roster record's value as the member it describes, or why it isn't one. */
function readMember(id: string, value: unknown): SharedMember | string {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "it isn't an object";
    const given = value as Record<string, unknown>;
    if (!isText(given.cert, CERT_MAX) || !holdsKeyOf(id, given.cert)) return "its certificate isn't the P-256 key its id names";
    if (given.name !== undefined && !isText(given.name)) return "its name is damaged";
    const facts = readFacts(given.facts);
    if (!facts) return "its OS details are damaged";
    const dial = given.dial === undefined ? undefined : readDial(given.dial);
    if (dial === null) return "its address is damaged";
    if (dial?.address !== undefined) return "its address holds an IP one computer observed, which is that computer's own";
    return {
        id,
        ...(given.name !== undefined ? { name: given.name as string } : {}),
        ...(dial ? { dial } : {}),
        cert: given.cert,
        facts,
    };
}

/** What a member's record holds: the member without its id, which is the record's. */
function valueOf(member: SharedMember): Omit<SharedMember, "id"> {
    const { id: _id, ...value } = member;
    return value;
}


/** The roster's members as "@roster" records in this computer's record store (local/network/). */
export class RosterRecords implements RosterStore {
    private readonly byId = new Map<string, SharedMember>();
    private readonly listeners = new Set<(id: string, member: SharedMember | null) => void>();
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
        for (const record of this.records.list(ROSTER_SPACE)) this.take(record.id);
        this.unwatch.push(this.records.watch(ROSTER_SPACE, (ids) => this.changed(ids)));
        this.unwatch.push(this.records.watch(KEYS_SPACE, () => this.changed([])));
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

    /**
     * Reads the newest version of a computer's record that reads into the
     * list. A winner that doesn't read is said loudly and removes no one;
     * a deleted winner, or no record, takes the computer off the list.
     */
    private take(id: string): SharedMember | null {
        const [winner, ...earlier] = this.records.versions(ROSTER_SPACE, id);
        if (!winner || winner.state === "deleted") {
            this.byId.delete(id);
            return null;
        }
        for (const version of [winner, ...earlier]) {
            const member = version.state === "value" ? readMember(id, version.value) : version.state === "unreadable" ? version.error : "it is deleted";
            if (typeof member !== "string") {
                this.byId.set(id, member);
                return member;
            }
            if (version === winner) {
                logger.error(`[roster] the computer record ${ROSTER_SPACE}/${id} (version ${winner.version}, written by ${winner.author}) can't be listed: ${member}. The newest version that reads is listed instead.`);
            }
        }
        // none of its versions reads: what was listed before, if anything, stays
        return this.byId.get(id) ?? null;
    }

    /** records of "@roster" (their ids) or of "@keys" changed: the list is read again, and who is a member worked out again */
    private changed(ids: string[]): void {
        const wasMember = this.memberIds ?? this.workOutMembers();
        const listedBefore = new Map(this.byId);
        for (const id of ids) this.take(id);
        this.memberIds = null;
        // told of: every computer whose listing changed, and every one that became or stopped being a member
        const tell = new Set(ids.filter((id) => listedBefore.has(id) || this.byId.has(id)));
        let membership = false;
        for (const id of new Set([...listedBefore.keys(), ...this.byId.keys()])) {
            if (wasMember.has(id) === this.isMember(id) && listedBefore.get(id)?.cert === this.byId.get(id)?.cert) continue;
            membership = true;
            tell.add(id);
        }
        for (const id of tell) for (const listener of this.listeners) listener(id, this.byId.get(id) ?? null);
        // records waiting on a member that just came, and records of one that just went
        if (membership) {
            this.records.readmit().catch((err) => {
                logger.error(`[roster] the records waiting on the computer list couldn't be asked about again (the next start asks): ${errorMessage(err)}`); // quiet: nothing waits on this; the next roster change and the next start readmit again
            });
        }
    }

    members(): SharedMember[] {
        return [...this.byId.values()];
    }

    async write(member: SharedMember): Promise<void> {
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

    watch(listener: (id: string, member: SharedMember | null) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    close(): void {
        for (const unwatch of this.unwatch.splice(0)) unwatch();
        this.listeners.clear();
    }
}
