// Where the roster's members are kept. The roster (roster.ts) reads and
// writes them only through RosterStore, so a store that carries them to every
// computer can take the file's place. Nothing here is private: what one pair
// of computers shares alone (a pairing token) is in rosterPrivate.ts.
import * as fs from "fs";
import { logger } from "../core/logger";
import { readStateFileSync, writeJsonAtomic } from "../core/storage";
import { SerialQueue } from "@mileniumhq/paperapi/serialQueue";
import { errorMessage } from "@mileniumhq/paperapi/errors";
import type { RosterDial, RosterFacts, RosterMember } from "@mileniumhq/paperapi/protocol";
import type { IdentityPart } from "@mileniumhq/paperapi";

export const ROSTER_FILE = "network_roster.json";

export interface RosterStore {
    readAll(): Promise<RosterMember[]>;
    /** adds the member, or replaces the one with its id */
    write(member: RosterMember): Promise<void>;
    remove(id: string): Promise<void>;
    /** hears every member written or removed, by anyone; returns the unsubscribe */
    watch(listener: (id: string, member: RosterMember | null) => void): () => void;
}

interface RosterDoc {
    version: 1;
    members: Record<string, RosterMember>;
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

/** A stored member as it was written, or null when any part of it is damaged. */
function readMember(id: string, value: unknown): RosterMember | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const given = value as Record<string, unknown>;
    if (given.id !== id || !isText(given.cert, CERT_MAX) || !Number.isFinite(given.order)) return null;
    if (given.name !== undefined && !isText(given.name)) return null;
    const facts = readFacts(given.facts);
    const dial = given.dial === undefined ? undefined : readDial(given.dial);
    if (!facts || dial === null) return null;
    return {
        id,
        ...(given.name !== undefined ? { name: given.name as string } : {}),
        ...(dial ? { dial } : {}),
        cert: given.cert as string,
        facts,
        order: given.order as number,
    };
}

/**
 * The roster in one file (local/network_roster.json), written whole and
 * atomically. A file that doesn't parse is set aside by readStateFileSync and
 * the roster starts over from what the old file import and pairing give it;
 * a damaged member is left out, and the file's bytes are copied aside first,
 * so neither is ever lost without a copy.
 */
export class RosterFile implements RosterStore {
    private members: Map<string, RosterMember> | null = null;
    private readonly writes = new SerialQueue();
    private readonly listeners = new Set<(id: string, member: RosterMember | null) => void>();

    constructor(private readonly file: string) {}

    private load(): Map<string, RosterMember> {
        if (this.members) return this.members;
        const raw = readStateFileSync<unknown>(this.file, { version: 1, members: {} }, ROSTER_FILE);
        const doc = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
        if (!doc || doc.version !== 1 || !doc.members || typeof doc.members !== "object" || Array.isArray(doc.members)) {
            throw new Error(`${this.file} isn't a computer list this Paperboard reads. Move it aside to start the list over.`);
        }
        const members = new Map<string, RosterMember>();
        const damaged: string[] = [];
        for (const [id, value] of Object.entries(doc.members)) {
            const member = readMember(id, value);
            if (member) members.set(id, member);
            else damaged.push(id);
        }
        if (damaged.length) {
            const copy = `${this.file}.corrupt-${Date.now()}`;
            fs.copyFileSync(this.file, copy);
            logger.error(`[roster] ${damaged.length} damaged computer record(s) were left out (${damaged.join(", ")}); the file's bytes are kept in ${copy}`);
        }
        return (this.members = members);
    }

    async readAll(): Promise<RosterMember[]> {
        return [...this.load().values()];
    }

    write(member: RosterMember): Promise<void> {
        return this.change(member.id, member);
    }

    remove(id: string): Promise<void> {
        return this.change(id, null);
    }

    // memory changes only once the file holds the change: a save that failed
    // leaves both as they were, and the caller hears why
    private change(id: string, member: RosterMember | null): Promise<void> {
        return this.writes.run(async () => {
            const next = new Map(this.load());
            if (member) next.set(id, member);
            else if (!next.delete(id)) return;
            const doc: RosterDoc = { version: 1, members: Object.fromEntries(next) };
            await writeJsonAtomic(this.file, doc, { mode: 0o600 });
            this.members = next;
            for (const listener of this.listeners) {
                try { listener(id, member); }
                catch (err) { logger.error(`[roster] a listener failed on ${id}: ${errorMessage(err)}`); } // quiet: the change is saved; a listener's own failure is its to say, logged here so it isn't lost
            }
        });
    }

    watch(listener: (id: string, member: RosterMember | null) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}
