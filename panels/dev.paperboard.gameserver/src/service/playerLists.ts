// The server's player lists: whitelist.json, ops.json and banned-players.json.
// A running server owns them, so flags change through its console (it
// rewrites the files itself); a stopped server reads them when it starts, so
// the panel edits the files directly. Everything is keyed by uuid, which is
// what the server matches on: a renamed player keeps their entries, and the
// roster shows the name they have now.
import { createHash } from "node:crypto";
import { files as fileApi, type ServiceContext } from "./api";
import { serverLocal } from "./scope";
import { resolvePlayerIdentities } from "./playerStats";
import { profileForName, profileForUuid } from "./mojang";
import { parseProperties } from "../core/properties";
import { assertPlayerName } from "../core/players";
import { type GameServerState, PANEL_ID } from "./types";

export type PlayerFlag = "op" | "whitelist";

export interface RosterEntry {
    uuid: string;
    name: string;
    whitelisted: boolean;
    op: boolean;
    banned: boolean;
}

type ListEntry = { uuid?: unknown; name?: unknown } & Record<string, unknown>;

const LIST_FILES = {
    whitelist: "whitelist.json",
    op: "ops.json",
    banned: "banned-players.json",
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// a name looked up from Mojang is trusted for an hour; renames are rare and
// a roster of a thousand players must not ask again on every visit
const NAME_TTL_MS = 60 * 60 * 1000;
const MAX_NAME_CACHE = 2048;
const MAX_NAME_LOOKUPS = 4;
const MAX_NAMES_PER_CALL = 200;

const local = serverLocal(() => ({
    names: new Map<string, { name: string; at: number }>(),
    // one list edit at a time: two quick toggles must not read the same file
    // and each write back a copy missing the other's change
    editing: Promise.resolve() as Promise<unknown>,
}));

async function readList(path: string): Promise<ListEntry[]> {
    const content = await fileApi.read(path, PANEL_ID);
    // the server writes these files on first start; none yet is an empty list
    if (content === null || content.trim() === "") return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch (err) {
        throw new Error(`${path} is not valid JSON: ${String(err)}`);
    }
    if (!Array.isArray(parsed)) throw new Error(`${path} is not a list of players`);
    return parsed.filter((entry): entry is ListEntry => !!entry && typeof entry === "object");
}

function entryUuid(entry: ListEntry): string | null {
    return typeof entry.uuid === "string" && UUID_RE.test(entry.uuid.toLowerCase())
        ? entry.uuid.toLowerCase()
        : null;
}

async function readServerProperties(): Promise<Record<string, string>> {
    const content = await fileApi.read("server.properties", PANEL_ID);
    return content ? parseProperties(content) : {};
}

// a missing key is the server's default: online mode, operator level 4
function isOnlineMode(props: Record<string, string>): boolean {
    return (props["online-mode"] ?? "true").trim() !== "false";
}

/** the uuid an offline-mode server gives a name (Java's UUID.nameUUIDFromBytes) */
export function offlinePlayerUuid(name: string): string {
    const bytes = createHash("md5").update(`OfflinePlayer:${name}`, "utf8").digest();
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Everyone on the whitelist, the operator list or the ban list, with the
 * newest name the server knows (usercache.json is rewritten on every join;
 * the lists keep the name a player had when they were added) and the name
 * Mojang last reported, when one was looked up this hour.
 */
export async function listRoster(): Promise<RosterEntry[]> {
    const [whitelist, ops, banned, identities] = await Promise.all([
        readList(LIST_FILES.whitelist),
        readList(LIST_FILES.op),
        readList(LIST_FILES.banned),
        resolvePlayerIdentities(),
    ]);
    const roster = new Map<string, RosterEntry>();
    const add = (entries: ListEntry[], flag: "whitelisted" | "op" | "banned") => {
        for (const entry of entries) {
            const uuid = entryUuid(entry);
            if (!uuid) continue;
            const existing = roster.get(uuid);
            if (existing) {
                existing[flag] = true;
                continue;
            }
            const listed = typeof entry.name === "string" ? entry.name : uuid;
            roster.set(uuid, {
                uuid,
                name: identities.get(uuid) ?? listed,
                whitelisted: flag === "whitelisted",
                op: flag === "op",
                banned: flag === "banned",
            });
        }
    };
    add(whitelist, "whitelisted");
    add(ops, "op");
    add(banned, "banned");
    const now = Date.now();
    for (const entry of roster.values()) {
        const known = local().names.get(entry.uuid);
        if (known && now - known.at < NAME_TTL_MS) entry.name = known.name;
    }
    return [...roster.values()];
}

/**
 * The names these players have now, from Mojang; a player looked up in the
 * last hour is answered from memory. An offline-mode server's
 * uuids come from the name itself, so there is nothing to look up.
 */
export async function currentPlayerNames(rawUuids: unknown): Promise<Record<string, string>> {
    if (!Array.isArray(rawUuids)) throw new Error("uuids must be a list");
    const uuids = [...new Set(rawUuids.map((u) => String(u ?? "").trim().toLowerCase()))]
        .filter((u) => UUID_RE.test(u))
        .slice(0, MAX_NAMES_PER_CALL);
    const result: Record<string, string> = {};
    if (uuids.length === 0 || !isOnlineMode(await readServerProperties())) return result;

    const now = Date.now();
    const stale: string[] = [];
    for (const uuid of uuids) {
        const known = local().names.get(uuid);
        if (known && now - known.at < NAME_TTL_MS) result[uuid] = known.name;
        else stale.push(uuid);
    }
    const failures: string[] = [];
    const worker = async () => {
        for (let uuid = stale.shift(); uuid !== undefined; uuid = stale.shift()) {
            try {
                const profile = await profileForUuid(uuid);
                if (!profile) continue;
                rememberName(uuid, profile.name);
                result[uuid] = profile.name;
            } catch (err) {
                failures.push(err instanceof Error ? err.message : String(err));
            }
        }
    };
    await Promise.all(Array.from({ length: MAX_NAME_LOOKUPS }, worker));
    // the roster keeps the names on file; the reason a refresh failed is
    // still reported, once per batch
    if (failures.length > 0) {
        console.warn(`[Service:PlayerLists] ${failures.length} name lookup(s) failed: ${failures[0]}`);
    }
    return result;
}

function rememberName(uuid: string, name: string): void {
    local().names.delete(uuid);
    local().names.set(uuid, { name, at: Date.now() });
    while (local().names.size > MAX_NAME_CACHE) {
        const oldest = local().names.keys().next();
        if (oldest.done) break;
        local().names.delete(oldest.value);
    }
}

// the account a name stands for on this server: one the server has already
// seen first (so an offline-mode server's own uuids are kept), then Mojang
// for an online-mode server, else the uuid offline mode derives
async function accountForName(name: string, props: Record<string, string>): Promise<{ uuid: string; name: string }> {
    const wanted = name.toLowerCase();
    for (const [uuid, known] of await resolvePlayerIdentities()) {
        if (known.toLowerCase() === wanted) return { uuid, name: known };
    }
    if (!isOnlineMode(props)) return { uuid: offlinePlayerUuid(name), name };
    const profile = await profileForName(name);
    if (!profile) throw new Error(`No Minecraft account is named "${name}"`);
    return profile;
}

async function editListFile(flag: PlayerFlag, name: string, on: boolean, uuid: string | null): Promise<void> {
    const path = LIST_FILES[flag];
    const list = await readList(path);
    const props = await readServerProperties();
    const wanted = name.toLowerCase();
    const matches = (entry: ListEntry) =>
        typeof entry.name === "string" && entry.name.toLowerCase() === wanted;

    if (!on) {
        // a renamed player is still listed under their old name: match by
        // the uuid given, or the one the server knows the current name by
        const identities = await resolvePlayerIdentities();
        const kept = list.filter((entry) => {
            if (matches(entry)) return false;
            const listed = entryUuid(entry);
            if (!listed) return true;
            return listed !== uuid && identities.get(listed)?.toLowerCase() !== wanted;
        });
        if (kept.length === list.length) {
            throw new Error(flag === "op" ? `${name} is not an operator` : `${name} is not on the whitelist`);
        }
        await fileApi.write(path, `${JSON.stringify(kept, null, 2)}\n`, PANEL_ID);
        return;
    }

    if (list.some(matches)) return;
    const account = uuid ? { uuid, name } : await accountForName(name, props);
    if (list.some((entry) => entryUuid(entry) === account.uuid)) return;
    const entry: Record<string, unknown> = { uuid: account.uuid, name: account.name };
    if (flag === "op") {
        // the level `op` itself grants: op-permission-level, default 4
        const level = Number.parseInt(props["op-permission-level"] ?? "4", 10);
        entry.level = Number.isInteger(level) && level >= 1 && level <= 4 ? level : 4;
        entry.bypassesPlayerLimit = false;
    }
    await fileApi.write(path, `${JSON.stringify([...list, entry], null, 2)}\n`, PANEL_ID);
}

/** the console command a running server takes the change as */
export function playerFlagCommand(flag: PlayerFlag, name: string, on: boolean): string {
    return flag === "op"
        ? `${on ? "op" : "deop"} ${name}`
        : `whitelist ${on ? "add" : "remove"} ${name}`;
}

/**
 * Ops or whitelists a player, or takes it away. Through the console while
 * the server runs (`send` is the console); in the file while it is stopped.
 * Between the two (stopping, restarting) the server may rewrite the file
 * over the edit, so it waits.
 */
export async function setPlayerFlag(
    ctx: ServiceContext<GameServerState>,
    send: (command: string) => Promise<void>,
    flag: PlayerFlag,
    rawName: unknown,
    on: boolean,
    rawUuid?: unknown,
): Promise<void> {
    const name = assertPlayerName(rawName);
    // the panel's own roster knows the uuid; flows only name a player
    const given = String(rawUuid ?? "").trim().toLowerCase();
    const uuid = UUID_RE.test(given) ? given : null;
    const status = ctx.state.serverStatus;
    if (status === "online" || status === "starting") {
        await send(playerFlagCommand(flag, name, on));
        return;
    }
    if (status !== "offline") {
        throw new Error("Wait until the server has finished stopping");
    }
    const edit = local().editing.then(() => editListFile(flag, name, on, uuid));
    local().editing = edit.catch(() => undefined);
    await edit;
}
