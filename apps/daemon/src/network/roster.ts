// The computers of the network, owned by this computer's daemon. A computer
// is its daemon's TLS key: its member id is derived from the key its
// certificate holds, so it is the same computer at any address, under any
// name, after any restart. This computer is the member whose key is the
// daemon's own; "local" is how the app and panels name it.
//
// What every computer may know of a member is kept in a RosterStore
// (rosterStore.ts: records in the network's record store). The pairing token
// this computer holds for a member, the ids an older Paperboard gave members
// and the order this computer lists them in are this computer's alone
// (rosterPrivate.ts).
import * as os from "os";
import * as path from "path";
import { getDetailedOsInfo } from "../system/osInfo";
import { errorMessage } from "@mileniumhq/paperapi/errors";
import type { RosterDial, RosterFacts, RosterMember, RosterView } from "@mileniumhq/paperapi/protocol";
import type { TlsIdentity } from "../security/tlsIdentity";
import { NETWORK_DIR, readDial, readFacts, RosterRecords, type RosterStore, type SharedDial, type SharedMember } from "./rosterStore";
import { RosterPrivate, ROSTER_PRIVATE_FILE, type Observed } from "./rosterPrivate";
import { memberIdOf } from "./memberId";

/** how the app and panels name this computer; never stored as an id */
export const LOCAL_COMPUTER_ID = "local";
const COMPUTER_NAME_MAX = 64;

/** every address a computer is dialed at, its .local name first */
export function dialHosts(dial: RosterDial): string[] {
    return dial.address && dial.address !== dial.host ? [dial.host, dial.address] : [dial.host];
}

/** A name the rail and every header can show: blank or huge is refused. */
export function checkComputerName(name: unknown): string {
    if (typeof name !== "string") throw new Error("A computer name must be text.");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A computer needs a name.");
    if (trimmed.length > COMPUTER_NAME_MAX) {
        throw new Error(`A computer name can be at most ${COMPUTER_NAME_MAX} characters.`);
    }
    return trimmed;
}

function checkDial(value: unknown): RosterDial {
    const dial = readDial(value);
    if (!dial) throw new Error("A computer's address needs a host and a port from 1 to 65535.");
    return dial;
}

function checkFacts(value: unknown): RosterFacts {
    const facts = readFacts(value);
    if (!facts) throw new Error("A computer's OS details are damaged.");
    return facts;
}

const sameFacts = (a: RosterFacts, b: RosterFacts) => JSON.stringify(checkFacts(a)) === JSON.stringify(checkFacts(b));

/** A dial split into what is true from everywhere (the name it answers to, its port) and the IP it answered at from here. */
function splitDial(dial: RosterDial): { shared: SharedDial; address: string | undefined } {
    return { shared: { host: dial.host, port: dial.port }, address: dial.address };
}

/** this computer's observed address beside what the record holds; one change to a member's observations */
function withAddress(observed: Record<string, Observed>, id: string, address: string | undefined): Record<string, Observed> {
    const { address: _old, ...rest } = observed[id] ?? {};
    const next = address === undefined ? rest : { ...rest, address };
    const out = { ...observed };
    if (Object.keys(next).length) out[id] = next;
    else delete out[id];
    return out;
}

export interface PairedMember {
    cert: string;
    token: string;
    /** the name the person typed; a computer paired again keeps its own without one */
    name?: string;
    dial: RosterDial;
    facts: RosterFacts;
}

export interface MemberChange {
    name?: string;
    dial?: RosterDial;
    facts?: RosterFacts;
}

export class Roster {
    private members = new Map<string, SharedMember>();
    // every change counts once, so an answer can say how new it is
    private revision = 0;
    private readonly listeners = new Set<() => void>();
    private readonly unwatch: () => void;

    private constructor(
        readonly self: string,
        private readonly store: RosterStore,
        private readonly secrets: RosterPrivate,
    ) {
        for (const member of store.members()) this.members.set(member.id, member);
        this.unwatch = store.watch((id, member) => {
            if (member) this.members.set(id, member);
            else this.members.delete(id);
            this.changed();
        });
    }

    /**
     * The roster in `dir` (the daemon's local/ folder), with this computer
     * in it as the member `identity`'s key names. `store` is for tests; the
     * daemon's is the record store in local/network/.
     */
    static async open(dir: string, identity: TlsIdentity, store?: RosterStore): Promise<Roster> {
        const secrets = new RosterPrivate(path.join(dir, ROSTER_PRIVATE_FILE));
        const members = store ?? (await RosterRecords.open(path.join(dir, NETWORK_DIR), identity));
        const roster = new Roster(memberIdOf(identity.cert), members, secrets);
        try {
            await roster.adoptSelf(identity.cert);
        } catch (err) {
            roster.close();
            throw err;
        }
        return roster;
    }

    /**
     * This computer is listed, first in a new list, under the certificate
     * its daemon serves now. A token or place kept for a computer that isn't
     * listed (a pairing a crash cut short, a record this computer can't read
     * yet) is left as it is: it is never handed out, and it counts again if
     * the computer comes back.
     */
    private async adoptSelf(cert: string): Promise<void> {
        if (!this.secrets.get().order.includes(this.self)) {
            await this.secrets.update((state) => ({ ...state, order: [this.self, ...state.order] }));
        }
        const mine = this.members.get(this.self);
        if (!mine || mine.cert !== cert) {
            await this.store.write({ ...mine, id: this.self, cert, facts: mine?.facts ?? { arch: os.arch() } });
        }
    }

    /** records what this computer is now: an OS upgrade shows without anyone asking */
    async refreshSelfFacts(): Promise<void> {
        const facts: RosterFacts = { ...(await getDetailedOsInfo()), arch: os.arch() };
        const mine = this.members.get(this.self)!;
        if (sameFacts(mine.facts, facts)) return;
        await this.store.write({ ...mine, facts: checkFacts(facts) });
    }

    /** the members in this computer's order; one it has no place for yet comes after, by id */
    list(): RosterMember[] {
        const place = new Map(this.secrets.get().order.map((id, at) => [id, at]));
        const rank = (id: string) => place.get(id) ?? Number.MAX_SAFE_INTEGER;
        return [...this.members.values()].sort((a, b) => rank(a.id) - rank(b.id) || (a.id < b.id ? -1 : 1)).map((m) => this.asSeenHere(m));
    }

    member(id: string): RosterMember | undefined {
        const member = this.members.get(id);
        return member && this.asSeenHere(member);
    }

    /** Whether a listed computer is a member: one a member let in by sharing the network's keys (rosterStore.ts). Only members link and sync. */
    isMember(id: string): boolean {
        return this.members.has(id) && this.store.isMember(id);
    }

    /** the member with the address this computer last reached it at beside the name it answers to */
    private asSeenHere(member: SharedMember): RosterMember {
        const address = this.secrets.get().observed[member.id]?.address;
        if (!member.dial || !address || address === member.dial.host) return member;
        return { ...member, dial: { host: member.dial.host, address, port: member.dial.port } };
    }

    /** what this computer observed of a member: its address from here, when it was last linked and synced */
    observed(id: string): Readonly<Observed> {
        return this.secrets.get().observed[id] ?? {};
    }

    /** saves when a member was last linked or synced; nothing the app lists changes */
    async observe(id: string, seen: Pick<Observed, "lastSeen" | "lastSync">): Promise<void> {
        if (!this.members.has(id)) return;
        await this.secrets.update((state) => ({ ...state, observed: { ...state.observed, [id]: { ...state.observed[id], ...seen } } }));
    }

    /** The member an id names: its own id, "local" for this computer, or an id an older Paperboard gave it; null for none. */
    resolve(id: string): string | null {
        if (id === LOCAL_COMPUTER_ID) return this.self;
        if (this.members.has(id)) return id;
        const aliased = Object.hasOwn(this.secrets.get().aliases, id) ? this.secrets.get().aliases[id]! : null;
        return aliased && this.members.has(aliased) ? aliased : null;
    }

    token(id: string): string | undefined {
        const tokens = this.secrets.get().tokens;
        return Object.hasOwn(tokens, id) ? tokens[id] : undefined;
    }

    /** everything this computer's own app needs: never handed to anyone else; a token only for a listed computer */
    view(): RosterView {
        const { tokens, aliases } = this.secrets.get();
        const listed = (id: string) => this.members.has(id);
        return {
            revision: this.revision,
            self: this.self,
            members: this.list(),
            aliases: { ...aliases },
            tokens: Object.fromEntries(Object.entries(tokens).filter(([id]) => listed(id))),
        };
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private changed(): void {
        this.revision++;
        for (const listener of this.listeners) listener();
    }

    /**
     * A computer was paired: it is added at the end, or, paired before (the
     * same key), given the new token and address and kept where it was,
     * under its own name unless a new one was typed. Resolves with its
     * member id.
     */
    async pair(paired: PairedMember): Promise<string> {
        const id = memberIdOf(paired.cert);
        if (id === this.self) throw new Error("That's this computer's own Paperboard server, not another computer");
        const name = paired.name === undefined ? undefined : checkComputerName(paired.name);
        const { shared, address } = splitDial(checkDial(paired.dial));
        const facts = checkFacts(paired.facts);
        if (typeof paired.token !== "string" || !paired.token) throw new Error("A pairing needs the token the computer gave.");
        const before = this.members.get(id);
        const kept = name ?? before?.name;
        // the token first: a computer listed is never one this computer can't sign in to
        await this.secrets.update((state) => ({
            ...state,
            tokens: { ...state.tokens, [id]: paired.token },
            order: state.order.includes(id) ? state.order : [...state.order, id],
            observed: withAddress(state.observed, id, address),
        }));
        await this.store.write({ id, ...(kept ? { name: kept } : {}), dial: shared, cert: paired.cert, facts });
        // a record that didn't change still lists the new address
        this.changed();
        return id;
    }

    /** a new name, address or OS details for a member; a change that changes nothing saves nothing */
    async update(id: string, change: MemberChange): Promise<void> {
        const member = this.requireMember(id);
        const dial = change.dial === undefined ? undefined : splitDial(checkDial(change.dial));
        const next: SharedMember = {
            ...member,
            ...(change.name !== undefined ? { name: checkComputerName(change.name) } : {}),
            ...(dial ? { dial: dial.shared } : {}),
            ...(change.facts !== undefined ? { facts: checkFacts(change.facts) } : {}),
        };
        await this.store.write(next);
        if (dial && dial.address !== this.secrets.get().observed[id]?.address) {
            await this.secrets.update((state) => ({ ...state, observed: withAddress(state.observed, id, dial.address) }));
            this.changed();
        }
    }

    /**
     * The person's order on this computer. The ids must be exactly the
     * members: a list that drops or invents one is refused, so a stale
     * window can never lose a computer.
     */
    async reorder(ids: string[]): Promise<void> {
        const unique = new Set(ids);
        if (unique.size !== ids.length || ids.length !== this.members.size || ids.some((id) => !this.members.has(id))) {
            throw new Error("The computer list changed while you were reordering it. Try again.");
        }
        if (this.list().every((member, at) => member.id === ids[at])) return;
        await this.secrets.update((state) => ({ ...state, order: [...ids] }));
        this.changed();
    }

    /** forgets a member, the token this computer held for it and its place */
    async remove(id: string): Promise<void> {
        if (id === this.self) throw new Error("This computer can't be forgotten.");
        this.requireMember(id);
        await this.store.remove(id);
        try {
            await this.secrets.update((state) => {
                const { [id]: _gone, ...tokens } = state.tokens;
                const { [id]: _seen, ...observed } = state.observed;
                return { ...state, tokens, observed, order: state.order.filter((other) => other !== id) };
            });
        } catch (err) {
            throw new Error(`The computer was forgotten, but its pairing token couldn't be deleted from ${ROSTER_PRIVATE_FILE}: ${errorMessage(err)}`, { cause: err });
        }
    }

    // TODO(remove after v0.6): only importPairedComputers.ts adds members this way
    /**
     * Members an older Paperboard paired, in `order` (this computer among
     * them), with their tokens and the ids it gave them, saved before they
     * are listed. Saving the same again changes nothing.
     */
    async adoptImported(members: RosterMember[], order: string[], tokens: Record<string, string>, aliases: Record<string, string>): Promise<void> {
        await this.secrets.update((state) => {
            let observed = state.observed;
            for (const member of members) if (member.dial?.address) observed = withAddress(observed, member.id, member.dial.address);
            return {
                ...state,
                tokens: { ...state.tokens, ...tokens },
                aliases: { ...state.aliases, ...aliases },
                order: [...order, ...state.order.filter((id) => !order.includes(id))],
                observed,
            };
        });
        this.changed();
        for (const member of members) await this.store.write({ ...member, ...(member.dial ? { dial: splitDial(member.dial).shared } : {}) });
    }

    private requireMember(id: string): SharedMember {
        const member = this.members.get(id);
        if (!member) throw new Error("Paperboard doesn't know this computer anymore.");
        return member;
    }

    close(): void {
        this.unwatch();
        this.store.close();
        this.listeners.clear();
    }
}
