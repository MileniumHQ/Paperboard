// The computers of the network, owned by this computer's daemon. A computer
// is its daemon's TLS key: its member id is derived from the key its
// certificate holds, so it is the same computer at any address, under any
// name, after any restart. This computer is the member whose key is the
// daemon's own; "local" is how the app and panels name it.
//
// What every computer may know of a member is kept in a RosterStore
// (rosterStore.ts). The pairing token this computer holds for a member and
// the ids an older Paperboard gave members are this computer's alone
// (rosterPrivate.ts).
import * as os from "os";
import * as path from "path";
import { logger } from "../core/logger";
import { getDetailedOsInfo } from "../system/osInfo";
import { errorMessage } from "@mileniumhq/paperapi/errors";
import type { RosterDial, RosterFacts, RosterMember, RosterView } from "@mileniumhq/paperapi/protocol";
import { readDial, readFacts, RosterFile, ROSTER_FILE, type RosterStore } from "./rosterStore";
import { RosterPrivate, ROSTER_PRIVATE_FILE } from "./rosterPrivate";
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
    private members = new Map<string, RosterMember>();
    // every change counts once, so an answer can say how new it is
    private revision = 0;
    private readonly listeners = new Set<() => void>();
    private readonly unwatch: () => void;

    private constructor(
        readonly self: string,
        private readonly store: RosterStore,
        private readonly secrets: RosterPrivate,
        members: RosterMember[],
    ) {
        for (const member of members) this.members.set(member.id, member);
        this.unwatch = store.watch((id, member) => {
            if (member) this.members.set(id, member);
            else this.members.delete(id);
            this.revision++;
            for (const listener of this.listeners) listener();
        });
    }

    /**
     * The roster in `dir` (the daemon's local/ folder), with this computer
     * in it as the member `cert` names. A computer whose daemon got a new key
     * (its identity file was replaced) carries its name and place over to it.
     */
    static async open(dir: string, cert: string, store: RosterStore = new RosterFile(path.join(dir, ROSTER_FILE))): Promise<Roster> {
        const secrets = new RosterPrivate(path.join(dir, ROSTER_PRIVATE_FILE));
        const self = memberIdOf(cert);
        const roster = new Roster(self, store, secrets, await store.readAll());
        await roster.adoptSelf(cert);
        return roster;
    }

    private async adoptSelf(cert: string): Promise<void> {
        const before = this.secrets.get().self;
        const former = before && before !== this.self ? this.members.get(before) : undefined;
        const mine = this.members.get(this.self);
        if (!mine || mine.cert !== cert || former) {
            const lowest = Math.min(0, ...[...this.members.values()].map((m) => m.order));
            const name = mine?.name ?? former?.name;
            await this.store.write({
                id: this.self,
                ...(name ? { name } : {}),
                cert,
                facts: mine?.facts ?? { arch: os.arch() },
                order: mine?.order ?? former?.order ?? lowest - 1,
            });
            if (former) {
                logger.warn(`[roster] this computer's daemon has a new key; it keeps the name and place it had as ${former.id}`);
                await this.store.remove(former.id);
            }
        }
        if (before !== this.self) await this.secrets.update((state) => ({ ...state, self: this.self }));
    }

    /** records what this computer is now: an OS upgrade shows without anyone asking */
    async refreshSelfFacts(): Promise<void> {
        const facts: RosterFacts = { ...(await getDetailedOsInfo()), arch: os.arch() };
        const mine = this.members.get(this.self)!;
        if (sameFacts(mine.facts, facts)) return;
        await this.store.write({ ...mine, facts: checkFacts(facts) });
    }

    /** the members in the person's order */
    list(): RosterMember[] {
        return [...this.members.values()].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
    }

    member(id: string): RosterMember | undefined {
        return this.members.get(id);
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

    /** everything this computer's own app needs: never handed to anyone else */
    view(): RosterView {
        const { tokens, aliases } = this.secrets.get();
        return { revision: this.revision, self: this.self, members: this.list(), aliases: { ...aliases }, tokens: { ...tokens } };
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * A computer was paired: it is added, or, paired before (the same key),
     * given the new token and address and kept where it was, under its own
     * name unless a new one was typed. Resolves with its member id.
     */
    async pair(paired: PairedMember): Promise<string> {
        const id = memberIdOf(paired.cert);
        if (id === this.self) throw new Error("That's this computer's own Paperboard server, not another computer");
        const name = paired.name === undefined ? undefined : checkComputerName(paired.name);
        const dial = checkDial(paired.dial);
        const facts = checkFacts(paired.facts);
        if (typeof paired.token !== "string" || !paired.token) throw new Error("A pairing needs the token the computer gave.");
        const before = this.members.get(id);
        const kept = name ?? before?.name;
        // the token first: a computer listed is never one this computer can't sign in to
        await this.secrets.update((state) => ({ ...state, tokens: { ...state.tokens, [id]: paired.token } }));
        await this.store.write({
            id,
            ...(kept ? { name: kept } : {}),
            dial,
            cert: paired.cert,
            facts,
            order: before?.order ?? Math.max(0, ...[...this.members.values()].map((m) => m.order)) + 1,
        });
        return id;
    }

    /** a new name, address or OS details for a member; a change that changes nothing saves nothing */
    async update(id: string, change: MemberChange): Promise<void> {
        const member = this.requireMember(id);
        const next: RosterMember = {
            ...member,
            ...(change.name !== undefined ? { name: checkComputerName(change.name) } : {}),
            ...(change.dial !== undefined ? { dial: checkDial(change.dial) } : {}),
            ...(change.facts !== undefined ? { facts: checkFacts(change.facts) } : {}),
        };
        if (JSON.stringify(next) === JSON.stringify(member)) return;
        await this.store.write(next);
    }

    /**
     * The person's order. The ids must be exactly the members: a list that
     * drops or invents one is refused, so a stale window can never lose a
     * computer.
     */
    async reorder(ids: string[]): Promise<void> {
        const unique = new Set(ids);
        if (unique.size !== ids.length || ids.length !== this.members.size || ids.some((id) => !this.members.has(id))) {
            throw new Error("The computer list changed while you were reordering it. Try again.");
        }
        for (const [order, id] of ids.entries()) {
            const member = this.members.get(id)!;
            if (member.order !== order) await this.store.write({ ...member, order });
        }
    }

    /** forgets a member and the token this computer held for it */
    async remove(id: string): Promise<void> {
        if (id === this.self) throw new Error("This computer can't be forgotten.");
        this.requireMember(id);
        await this.store.remove(id);
        try {
            await this.secrets.update((state) => {
                const { [id]: _gone, ...tokens } = state.tokens;
                return { ...state, tokens };
            });
        } catch (err) {
            throw new Error(`The computer was forgotten, but its pairing token couldn't be deleted from ${ROSTER_PRIVATE_FILE}: ${errorMessage(err)}`, { cause: err });
        }
    }

    // TODO(remove after v0.6): only importPairedComputers.ts adds members this way
    /** members an older Paperboard paired, with their tokens and the ids it gave them, saved before they are listed */
    async adoptImported(members: RosterMember[], tokens: Record<string, string>, aliases: Record<string, string>): Promise<void> {
        await this.secrets.update((state) => ({ ...state, tokens: { ...state.tokens, ...tokens }, aliases: { ...state.aliases, ...aliases } }));
        for (const member of members) await this.store.write(member);
    }

    private requireMember(id: string): RosterMember {
        const member = this.members.get(id);
        if (!member) throw new Error("Paperboard doesn't know this computer anymore.");
        return member;
    }

    close(): void {
        this.unwatch();
        this.listeners.clear();
    }
}
