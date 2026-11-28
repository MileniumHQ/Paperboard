// What this computer alone keeps about the roster, never carried to another
// computer: the pairing token it holds for each member (until daemons sign in
// to each other with their own keys), the ids an older Paperboard on this
// computer gave its members, the order its rail lists them in (each computer
// puts itself first, so the order is a view, not shared truth), and what it
// observed of each member from here: where it reached it (the address it was
// paired at, an IP it last answered at), what it was told of the member's OS
// before the member said so itself, when it was last linked, and when this
// computer last synced with it. Another computer on another network sees
// other addresses and other times.
import { readStateFileSync, writeJsonAtomic } from "../core/storage";
import { SerialQueue } from "@mileniumhq/paperapi/serialQueue";
import { isSafeId } from "@mileniumhq/paperapi/protocol";
import type { RosterDial, RosterFacts } from "@mileniumhq/paperapi/protocol";
import { isMemberId } from "./memberId";
import { readDial, readFacts } from "./rosterStore";

export const ROSTER_PRIVATE_FILE = "network_roster_private.json";

export interface RosterPrivateState {
    /** member id → the bearer token this computer signs in to it with */
    tokens: Record<string, string>;
    /** an id an older Paperboard gave a computer → its member id; kept for good */
    aliases: Record<string, string>;
    /** member ids in the person's order on this computer; a member missing from it comes after */
    order: string[];
    /** member id → what this computer observed of it */
    observed: Record<string, Observed>;
}

/** What this computer saw of a member from where it is. */
export interface Observed {
    /** where this computer reached it: what it was paired at, then where its certificate last answered from here */
    dial?: RosterDial;
    /** its OS as this computer was told it (pairing, the app), for a member that hasn't said so itself */
    facts?: RosterFacts;
    /** ms since the epoch: the last time a link to it was up */
    lastSeen?: number;
    /** ms since the epoch: the last time this computer pulled everything it had */
    lastSync?: number;
}

const isTime = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function readObserved(value: unknown, file: string): Record<string, Observed> {
    if (value === undefined) return {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file} has an "observed" that isn't a list of computers`);
    const out: Record<string, Observed> = {};
    for (const [id, entry] of Object.entries(value)) {
        const given = (entry ?? {}) as Record<string, unknown>;
        const damaged = () => new Error(`${file} has a damaged "observed" entry: ${JSON.stringify(id)}`);
        if (!isMemberId(id) || typeof entry !== "object" || Array.isArray(entry)) throw damaged();
        const seen: Observed = {};
        if (given.dial !== undefined) {
            const dial = readDial(given.dial);
            if (!dial) throw damaged();
            seen.dial = dial;
        }
        if (given.facts !== undefined) {
            const facts = readFacts(given.facts);
            if (!facts) throw damaged();
            seen.facts = facts;
        }
        for (const key of ["lastSeen", "lastSync"] as const) {
            if (given[key] === undefined) continue;
            if (!isTime(given[key])) throw damaged();
            seen[key] = given[key];
        }
        out[id] = seen;
    }
    return out;
}

function textRecord(value: unknown, keyOk: (key: string) => boolean, file: string, field: string): Record<string, string> {
    if (value === undefined) return {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file} has a "${field}" that isn't a list of names`);
    const out: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (!keyOk(key) || typeof entry !== "string" || !entry) throw new Error(`${file} has a damaged "${field}" entry: ${JSON.stringify(key)}`);
        out[key] = entry;
    }
    return out;
}

/**
 * local/network_roster_private.json, owner-only. A file that doesn't parse is
 * set aside like every state file; one that parses but holds damaged entries
 * throws, because a token or alias read as missing would quietly unpair a
 * computer or break what an old id names.
 */
export class RosterPrivate {
    private state: RosterPrivateState;
    private readonly writes = new SerialQueue();
    private closed = false;

    constructor(private readonly file: string) {
        const raw = readStateFileSync<Record<string, unknown>>(file, {}, ROSTER_PRIVATE_FILE);
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${file} isn't this computer's pairing record`);
        const order = raw.order ?? [];
        if (!Array.isArray(order) || order.some((id) => !isMemberId(id)) || new Set(order).size !== order.length) throw new Error(`${file} has a damaged "order"`);
        this.state = {
            tokens: textRecord(raw.tokens, isSafeId, file, "tokens"),
            aliases: textRecord(raw.aliases, isSafeId, file, "aliases"),
            order,
            observed: readObserved(raw.observed, file),
        };
    }

    get(): Readonly<RosterPrivateState> {
        return this.state;
    }

    /** saves what `change` makes of the state; memory follows only once the file does */
    update(change: (state: RosterPrivateState) => RosterPrivateState): Promise<void> {
        if (this.closed) return Promise.reject(new Error(`${ROSTER_PRIVATE_FILE} is closed: this computer's list stopped`));
        return this.writes.run(async () => {
            const next = change({
                tokens: { ...this.state.tokens },
                aliases: { ...this.state.aliases },
                order: [...this.state.order],
                observed: Object.fromEntries(Object.entries(this.state.observed).map(([id, seen]) => [id, { ...seen }])),
            });
            await writeJsonAtomic(this.file, next, { mode: 0o600 });
            this.state = next;
        });
    }

    /** Takes no write from here on; resolves once the writes already queued are saved (a failed one was the caller's to hear). */
    close(): Promise<void> {
        this.closed = true;
        return this.writes.settled();
    }
}
