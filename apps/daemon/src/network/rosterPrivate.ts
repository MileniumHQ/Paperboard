// What this computer alone keeps about the roster, never carried to another
// computer: the pairing token it holds for each member (until daemons sign in
// to each other with their own keys), the ids an older Paperboard on this
// computer gave its members, and which member was this computer last time.
import { readStateFileSync, writeJsonAtomic } from "../core/storage";
import { SerialQueue } from "@mileniumhq/paperapi/serialQueue";
import { isSafeId } from "@mileniumhq/paperapi/protocol";

export const ROSTER_PRIVATE_FILE = "network_roster_private.json";

export interface RosterPrivateState {
    /** member id → the bearer token this computer signs in to it with */
    tokens: Record<string, string>;
    /** an id an older Paperboard gave a computer → its member id; kept for good */
    aliases: Record<string, string>;
    /** the member id this computer had the last time the roster opened */
    self: string | null;
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

    constructor(private readonly file: string) {
        const raw = readStateFileSync<Record<string, unknown>>(file, {}, ROSTER_PRIVATE_FILE);
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${file} isn't this computer's pairing record`);
        const self = raw.self;
        if (self !== undefined && self !== null && typeof self !== "string") throw new Error(`${file} has a damaged "self"`);
        this.state = {
            tokens: textRecord(raw.tokens, isSafeId, file, "tokens"),
            aliases: textRecord(raw.aliases, isSafeId, file, "aliases"),
            self: self ?? null,
        };
    }

    get(): Readonly<RosterPrivateState> {
        return this.state;
    }

    /** saves what `change` makes of the state; memory follows only once the file does */
    update(change: (state: RosterPrivateState) => RosterPrivateState): Promise<void> {
        return this.writes.run(async () => {
            const next = change({ tokens: { ...this.state.tokens }, aliases: { ...this.state.aliases }, self: this.state.self });
            await writeJsonAtomic(this.file, next, { mode: 0o600 });
            this.state = next;
        });
    }
}
