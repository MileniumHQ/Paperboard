// The server's player lists: whitelist.json, ops.json and banned-players.json.
// A running server owns them, so flags change through its console (it
// rewrites the files itself); a stopped server reads them when it starts, so
// the panel edits the files directly. Everything is keyed by uuid, which is
// what the server matches on: a renamed player keeps their entries, and the
// roster shows the name they have now.
//
// With crossplay, Bedrock players (named with Floodgate's prefix) are Xbox
// accounts Mojang does not know: the vanilla `whitelist` cannot find them,
// so a running server whitelists them through Floodgate's `fwhitelist`, and
// a stopped one gets the uuid Floodgate derives from their XUID written in.
import { createHash } from "node:crypto";
import { files as fileApi, type ServiceContext } from "./api";
import { serverLocal } from "./scope";
import { resolvePlayerIdentities } from "./playerStats";
import { profileForName, profileForUuid } from "./mojang";
import { gamertagForXuid, xuidForGamertag } from "./xbox";
import { parseProperties } from "../core/properties";
import { assertPlayerName, JAVA_NAME_PATTERN } from "../core/players";
import {
    bedrockPlayerName,
    floodgateUuid,
    gamertagOf,
    isFloodgateUuid,
    xuidOfFloodgateUuid,
    type BedrockNaming,
} from "../core/bedrock";
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
 * The names these players have now: Java players' from Mojang, Bedrock
 * players' from their gamertag on GeyserMC; a player looked up in the last
 * hour is answered from memory. An offline-mode server's Java uuids come
 * from the name itself, so there is nothing to look up for those.
 */
export async function currentPlayerNames(rawUuids: unknown, naming: BedrockNaming | null): Promise<Record<string, string>> {
    if (!Array.isArray(rawUuids)) throw new Error("uuids must be a list");
    const valid = [...new Set(rawUuids.map((u) => String(u ?? "").trim().toLowerCase()))]
        .filter((u) => UUID_RE.test(u))
        .slice(0, MAX_NAMES_PER_CALL);
    const result: Record<string, string> = {};
    if (valid.length === 0) return result;
    const onlineMode = isOnlineMode(await readServerProperties());
    // a Floodgate uuid is no Mojang account; without Floodgate it has no name to look up
    const uuids = valid.filter((u) => (isFloodgateUuid(u) ? naming !== null : onlineMode));

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
                const name = await currentName(uuid, naming);
                if (!name) continue;
                rememberName(uuid, name);
                result[uuid] = name;
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

async function currentName(uuid: string, naming: BedrockNaming | null): Promise<string | null> {
    const xuid = xuidOfFloodgateUuid(uuid);
    if (xuid && naming) {
        const gamertag = await gamertagForXuid(xuid);
        return gamertag ? bedrockPlayerName(gamertag, naming) : null;
    }
    return (await profileForUuid(uuid))?.name ?? null;
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

async function knownAccount(name: string): Promise<{ uuid: string; name: string } | null> {
    const wanted = name.toLowerCase();
    for (const [uuid, known] of await resolvePlayerIdentities()) {
        if (known.toLowerCase() === wanted) return { uuid, name: known };
    }
    return null;
}

// a Bedrock player's account: the uuid Floodgate derives from their XUID,
// which GeyserMC looks up the way `fwhitelist` does
async function bedrockAccount(gamertag: string, naming: BedrockNaming): Promise<{ uuid: string; name: string }> {
    const xuid = await xuidForGamertag(gamertag);
    if (!xuid) {
        throw new Error(
            `GeyserMC has no Xbox account named "${gamertag}" on record. It learns a gamertag when that player first joins any Geyser server, so ask them to join once and try again.`,
        );
    }
    return { uuid: floodgateUuid(xuid), name: bedrockPlayerName(gamertag, naming) };
}

// the account a name stands for on this server: one the server has already
// seen first (so an offline-mode server's own uuids are kept), then
// GeyserMC for a Bedrock name, Mojang for a Java name on an online-mode
// server, else the uuid offline mode derives
async function accountForName(
    name: string,
    gamertag: string | null,
    naming: BedrockNaming | null,
    props: Record<string, string>,
): Promise<{ uuid: string; name: string }> {
    const known = await knownAccount(name);
    if (known) return known;
    if (gamertag && naming) return bedrockAccount(gamertag, naming);
    if (!isOnlineMode(props)) return { uuid: offlinePlayerUuid(name), name };
    const profile = await profileForName(name);
    if (!profile) throw new Error(`No Minecraft account is named "${name}"`);
    return profile;
}

async function editListFile(
    flag: PlayerFlag,
    name: string,
    on: boolean,
    uuid: string | null,
    gamertag: string | null,
    naming: BedrockNaming | null,
): Promise<void> {
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
    const account = uuid ? { uuid, name } : await accountForName(name, gamertag, naming, props);
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

// Floodgate reads its argument as one quoted-or-bare word
function floodgateArgument(gamertag: string): string {
    return gamertag.includes(" ") ? `"${gamertag}"` : gamertag;
}

async function inUsercache(name: string): Promise<boolean> {
    const list = await readList("usercache.json");
    const wanted = name.toLowerCase();
    return list.some((entry) => typeof entry.name === "string" && entry.name.toLowerCase() === wanted);
}

/**
 * A running server's command for a Bedrock player. The whitelist goes
 * through Floodgate, which finds the Xbox account itself; it is looked up
 * here first so a gamertag GeyserMC does not know fails in the panel, not
 * only in the console. `op` finds a name only in the server's own profile
 * cache, so a Bedrock player must have joined once before a running server
 * can op them; a stopped server's file takes them any time.
 */
async function bedrockFlagCommand(
    flag: PlayerFlag,
    name: string,
    gamertag: string,
    naming: BedrockNaming,
    on: boolean,
    uuid: string | null,
): Promise<string> {
    if (flag === "whitelist") {
        if (!on) {
            const known = uuid ?? (await knownAccount(name))?.uuid ?? null;
            return `fwhitelist remove ${known && isFloodgateUuid(known) ? known : floodgateArgument(gamertag)}`;
        }
        await bedrockAccount(gamertag, naming);
        return `fwhitelist add ${floodgateArgument(gamertag)}`;
    }
    if (!(await inUsercache(name))) {
        throw new Error(
            on
                ? `${name} has not joined this server yet, and a running server can only make Bedrock players it has seen operators. Stop the server to make them an operator now.`
                : `${name} has not joined this server yet, so the running server cannot find them. Stop the server to take operator away now.`,
        );
    }
    return playerFlagCommand(flag, name, on);
}

/**
 * Ops or whitelists a player, or takes it away. Through the console while
 * the server runs (`send` is the console); in the file while it is stopped.
 * Between the two (stopping, restarting) the server may rewrite the file
 * over the edit, so it waits. `naming` is Floodgate's, null without it: a
 * name with its prefix is a Bedrock player then.
 */
export async function setPlayerFlag(
    ctx: ServiceContext<GameServerState>,
    send: (command: string) => Promise<void>,
    naming: BedrockNaming | null,
    flag: PlayerFlag,
    rawName: unknown,
    on: boolean,
    rawUuid?: unknown,
): Promise<void> {
    const name = assertPlayerName(rawName);
    // the panel's own roster knows the uuid; flows only name a player
    const given = String(rawUuid ?? "").trim().toLowerCase();
    const uuid = UUID_RE.test(given) ? given : null;
    const gamertag = gamertagOf(name, naming);
    if (!gamertag && !JAVA_NAME_PATTERN.test(name)) {
        throw new Error(
            naming
                ? `"${name}" is not a player name. Java names are letters, numbers and underscores, and Bedrock names start with "${naming.prefix}".`
                : `"${name}" is not a Java player name: those are letters, numbers and underscores. Turn crossplay on to add Bedrock players.`,
        );
    }
    const status = ctx.state.serverStatus;
    if (status === "online" || status === "starting") {
        await send(gamertag && naming ? await bedrockFlagCommand(flag, name, gamertag, naming, on, uuid) : playerFlagCommand(flag, name, on));
        return;
    }
    if (status !== "offline") {
        throw new Error("Wait until the server has finished stopping");
    }
    const edit = local().editing.then(() => editListFile(flag, name, on, uuid, gamertag, naming));
    local().editing = edit.catch(() => undefined);
    await edit;
}
