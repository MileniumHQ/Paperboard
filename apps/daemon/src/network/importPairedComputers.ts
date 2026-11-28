// TODO(remove after v0.6): the one-time move of the desktop app's
// local/paired_computers.json (Paperboard 0.4 and before) into the roster.
// The aliases it records stay for good (roster.ts resolve); this import goes
// once every install has started a release that has it.
//
// The old file is read and never changed until everything in it is saved
// in the roster: an import that fails halfway leaves it as it was, the
// daemon doesn't start, and the next start imports it again. Saving a member
// twice is harmless, so a retry after a partial import ends the same way.
import * as fs from "fs";
import * as path from "path";
import { logger } from "../core/logger";
import { readStateFileSync } from "../core/storage";
import { errorCode } from "@mileniumhq/paperapi/errors";
import { isSafeId, type RosterMember } from "@mileniumhq/paperapi/protocol";
import { readDial, readFacts } from "./rosterStore";
import { LOCAL_COMPUTER_ID, memberIdOf, type Roster } from "./roster";

const PAIRED_COMPUTERS_FILE = "paired_computers.json";
// what 0.4 named this computer until the person gave it a name
const OLD_DEFAULT_NAME = "This Computer";

interface OldComputer {
    id?: unknown;
    name?: unknown;
    host?: unknown;
    address?: unknown;
    port?: unknown;
    token?: unknown;
    cert?: unknown;
    isLocal?: unknown;
    [fact: string]: unknown;
}

// a host saved before hosts were kept bare may say "[::1]"
const bare = (host: unknown) => (typeof host === "string" && /^\[.*\]$/.test(host) ? host.slice(1, -1) : host);

function certIdOf(cert: unknown): string | null {
    if (typeof cert !== "string" || !cert) return null;
    try {
        return memberIdOf(cert);
    } catch (err) {
        logger.error("[roster] a paired computer's certificate doesn't parse:", err);
        return null;
    }
}

/** Moves local/paired_computers.json, when there is one, into the roster. */
export async function importPairedComputers(dir: string, roster: Roster): Promise<void> {
    const file = path.join(dir, PAIRED_COMPUTERS_FILE);
    if (!fs.existsSync(file)) return;
    // an unparseable file is set aside with its bytes (readStateFileSync), and there is nothing to import
    const raw = readStateFileSync<{ computers?: unknown }>(file, {}, PAIRED_COMPUTERS_FILE);
    if (!fs.existsSync(file)) return;
    const listed: unknown[] = Array.isArray(raw?.computers) ? raw.computers : [];
    const members = new Map<string, RosterMember>();
    const tokens: Record<string, string> = {};
    const aliases: Record<string, string> = {};
    const left: unknown[] = [];
    let selfOrder: number | null = null;
    let selfName: string | undefined;

    for (const [order, entry] of listed.entries()) {
        const old = (entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {}) as OldComputer;
        if (old.id === LOCAL_COMPUTER_ID || old.isLocal === true) {
            selfOrder ??= order;
            if (typeof old.name === "string" && old.name.trim() && old.name !== OLD_DEFAULT_NAME) selfName ??= old.name.trim();
            continue;
        }
        const id = certIdOf(old.cert);
        const dial = readDial({ host: bare(old.host), ...(old.address !== undefined ? { address: bare(old.address) } : {}), port: old.port });
        if (!id || !dial || !isSafeId(old.id)) {
            left.push(entry);
            continue;
        }
        aliases[old.id] = id;
        // two entries for one computer (one key) are one member: the first
        // keeps its place and name. This computer's own key is no entry.
        if (id === roster.self || members.has(id)) continue;
        const facts = readFacts(Object.fromEntries(
            ["os", "osVersion", "distroId", "distroName", "flavor", "machine", "board", "operator", "arch"].filter((key) => old[key] !== undefined).map((key) => [key, old[key]]),
        ));
        if (!facts) logger.warn(`[roster] ${String(old.name ?? old.id)}'s OS details were damaged; it reports them again when it next connects`);
        members.set(id, {
            id,
            ...(typeof old.name === "string" && old.name.trim() ? { name: old.name.trim() } : {}),
            dial,
            cert: old.cert as string,
            facts: facts ?? {},
            order,
        });
        if (typeof old.token === "string" && old.token) tokens[id] = old.token;
    }

    const self = roster.member(roster.self)!;
    const adopted = [...members.values()];
    adopted.push({ ...self, ...(selfName ? { name: selfName } : {}), order: selfOrder ?? listed.length });
    await roster.adoptImported(adopted, tokens, aliases);

    if (left.length) {
        // what couldn't be imported keeps its bytes, the way a damaged state file does
        const kept = `${file}.corrupt-${Date.now()}`;
        fs.renameSync(file, kept);
        logger.error(`[roster] ${left.length} paired computer(s) in ${PAIRED_COMPUTERS_FILE} had no usable certificate, address or id and weren't imported; the file is kept in ${kept}`);
    } else {
        try {
            fs.unlinkSync(file);
        } catch (err) {
            if (errorCode(err) !== "ENOENT") throw err;
        }
    }
    logger.info(`[roster] imported ${members.size} paired computer(s) from ${PAIRED_COMPUTERS_FILE}`);
}
