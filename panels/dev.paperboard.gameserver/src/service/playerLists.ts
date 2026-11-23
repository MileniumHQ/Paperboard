import { minecraftOf } from "../games/minecraft/state";
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
import type { Server } from "./server";
import { createHash } from "node:crypto";
import { errorMessage } from "./api";
import { report } from "../games/serviceKit";
import { cachedName, listPlayerStats, resolvePlayerIdentities } from "./playerStats";
import type { PlayerStatSummaryData } from "../core/playerStats";
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
import { PANEL_ID } from "./types";
import { waitForLine } from "../games/minecraft/saving";
import { sendServerCommand } from "./lifecycle";

export type PlayerFlag = "op" | "whitelist";

/** someone on the whitelist, the operator list or the ban list */
export interface ListedPlayer {
    uuid: string;
    name: string;
    whitelisted: boolean;
    op: boolean;
    banned: boolean;
    /** why, as banned-players.json gives it; null when not banned or it names no reason */
    banReason: string | null;
}

/** one row of the Players tab */
export interface RosterEntry extends Omit<ListedPlayer, "uuid"> {
    /** the row's identity: the uuid, else the lowercased name of a player the server has no uuid for yet */
    key: string;
    uuid: string | null;
    /** the world's stats file for them; null when it has none */
    stats: PlayerStatSummaryData | null;
}

/** the Players tab: every row, and why the world's stats couldn't be read (null when they could) */
export interface Roster {
    players: RosterEntry[];
    statsError: string | null;
}

type ListEntry = { uuid?: unknown; name?: unknown } & Record<string, unknown>;

const LIST_FILES = {
    whitelist: "whitelist.json",
    op: "ops.json",
    banned: "banned-players.json",
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_NAME_LOOKUPS = 4;

async function readList(ctx: Server, path: string): Promise<ListEntry[]> {
    const content = await ctx.files.read(path, PANEL_ID);
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

/**
 * Whether one of the server's lists has a player of this name, or null while
 * the server is writing it: it rewrites the file in place, so a read during
 * the write finds it empty or cut short.
 */
export async function isListed(ctx: Server, list: keyof typeof LIST_FILES, name: string): Promise<boolean | null> {
    const file = LIST_FILES[list];
    const content = await ctx.files.read(file, PANEL_ID);
    // none written yet: nobody is on it
    if (content === null) return false;
    let parsed: unknown;
    let whole = true;
    try {
        parsed = JSON.parse(content);
    } catch {
        // quiet: a list cut short by the server's write says nothing yet; the caller reads it again
        whole = false;
    }
    if (!whole) return null;
    if (!Array.isArray(parsed)) throw new Error(`${file} is not a list of players`);
    const wanted = name.toLowerCase();
    return parsed.some((entry) => !!entry && typeof entry === "object" && typeof entry.name === "string" && entry.name.toLowerCase() === wanted);
}

// A running server writes its list as it takes a change (op, whitelist, ban),
// then says so: "Made Steve a server operator", "Banned Steve: reason". A
// refusal is a line of its own, which the call fails with. A plugin may say
// it in words of its own, so the list it wrote is the record: watched while
// the line is awaited, and read once more when none came. A kick or a kill
// has no list: only its line says it happened.
const ANSWER_MS = 15_000;
const LIST_POLL_MS = 250;
const REFUSED = /Nothing changed|That player does not exist|Unknown player|No player was found|No entity was found|That player cannot be found|Could not |Player is (already|not) whitelisted/i;

/** a list `command` changes: `name` is to be on it, or off it */
export interface ListChange { list: keyof typeof LIST_FILES; name: string; on: boolean }
const LIST_NAMES: Record<keyof typeof LIST_FILES, string> = { whitelist: "the whitelist", op: "the operator list", banned: "the ban list" };

/** Sends a console command and resolves once the server has taken it; fails with its refusal, or with no answer and no change to the list. */
export async function answeredCommand(ctx: Server, command: string, done: RegExp, what: string, change?: ListChange): Promise<void> {
    const recorded = async () => !!change && (await isListed(ctx, change.list, change.name)) === change.on;
    // a list that already shows it can only be refused, and the refusal says why
    const watchList = !!change && !(await recorded());
    const answer = waitForLine(ctx, (line) => done.test(line) || REFUSED.test(line), ANSWER_MS, what);
    // however the call ends, nothing waits on the line after it
    try {
        await sendServerCommand(ctx, command);
        let answered = false;
        const said = answer.done.finally(() => (answered = true));
        while (watchList && !answered) {
            if (await recorded()) return;
            // quiet: said's failure is read below, where it is awaited
            await Promise.race([said.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, LIST_POLL_MS))]);
        }
        let line: string;
        try {
            line = await said;
        } catch (err) {
            if (!change) throw err;
            if (await recorded()) return;
            throw new Error(`${errorMessage(err)}, and ${LIST_NAMES[change.list]} ${change.on ? "does not have" : "still has"} ${change.name}`);
        }
        if (!done.test(line)) throw new Error(`The server refused: ${line.replace(/^(?:\[[^\]]*\]\s*)+:?\s*(?:System chat:\s*)?/, "")}`);
    } finally {
        answer.cancel();
    }
}

/** a player's name in a pattern of the server's answer */
export const nameInAnswer = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function entryUuid(entry: ListEntry): string | null {
    return typeof entry.uuid === "string" && UUID_RE.test(entry.uuid.toLowerCase())
        ? entry.uuid.toLowerCase()
        : null;
}

async function readServerProperties(ctx: Server): Promise<Record<string, string>> {
    const content = await ctx.files.read("server.properties", PANEL_ID);
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
export async function listListed(ctx: Server, known?: Map<string, string>): Promise<ListedPlayer[]> {
    const [whitelist, ops, banned, identities] = await Promise.all([
        readList(ctx, LIST_FILES.whitelist),
        readList(ctx, LIST_FILES.op),
        readList(ctx, LIST_FILES.banned),
        known ?? resolvePlayerIdentities(ctx),
    ]);
    const roster = new Map<string, ListedPlayer>();
    const add = (entries: ListEntry[], flag: "whitelisted" | "op" | "banned") => {
        for (const entry of entries) {
            const uuid = entryUuid(entry);
            if (!uuid) continue;
            const banReason = flag === "banned" && typeof entry.reason === "string" && entry.reason.trim() ? entry.reason.trim() : null;
            const existing = roster.get(uuid);
            if (existing) {
                existing[flag] = true;
                if (flag === "banned") existing.banReason = banReason;
                continue;
            }
            const listed = typeof entry.name === "string" ? entry.name : uuid;
            roster.set(uuid, {
                uuid,
                name: identities.get(uuid) ?? listed,
                whitelisted: flag === "whitelisted",
                op: flag === "op",
                banned: flag === "banned",
                banReason,
            });
        }
    };
    add(whitelist, "whitelisted");
    add(ops, "op");
    add(banned, "banned");
    for (const entry of roster.values()) entry.name = cachedName(ctx, entry.uuid) ?? entry.name;
    return [...roster.values()];
}

/**
 * Everyone this world knows, one row each: the server's lists, everyone with
 * a stats file, and players online or seen this session whose first session
 * isn't saved yet. usercache.json is only a name book (the server keeps
 * writing it back), so a player whose data was deleted and who is on no list
 * is gone for good.
 */
export async function listRoster(ctx: Server): Promise<Roster> {
    const identities = await resolvePlayerIdentities(ctx);
    const [listed, stats] = await Promise.all([
        listListed(ctx, identities),
        // a stats file the server left half-written takes the stats away, not the lists
        listPlayerStats(ctx, identities).then(
            (read) => ({ read, error: null }),
            (err) => ({ read: [], error: errorMessage(err) }),
        ),
    ]);
    const rows = new Map<string, RosterEntry>(listed.map((player) => [player.uuid, { ...player, key: player.uuid, stats: null }]));
    for (const { uuid, name, ...numbers } of stats.read) {
        const row = rows.get(uuid);
        if (row) row.stats = numbers;
        else rows.set(uuid, { key: uuid, uuid, name, whitelisted: false, op: false, banned: false, banReason: null, stats: numbers });
    }
    // usercache.json has a player from their first join, so their row keeps
    // its uuid key when their first session is saved or they're listed
    const uuidOf = new Map([...identities].map(([uuid, name]) => [name.toLowerCase(), uuid]));
    const named = new Set([...rows.values()].map((row) => row.name.toLowerCase()));
    for (const name of [...ctx.state.onlinePlayers, ...ctx.state.seenPlayers]) {
        const lower = name.toLowerCase();
        if (named.has(lower)) continue;
        named.add(lower);
        const uuid = uuidOf.get(lower) ?? null;
        if (uuid && rows.has(uuid)) continue;
        rows.set(uuid ?? lower, { key: uuid ?? lower, uuid, name, whitelisted: false, op: false, banned: false, banReason: null, stats: null });
    }
    return { players: [...rows.values()], statsError: stats.error };
}

/**
 * The names these players have now: Java players' from Mojang, Bedrock
 * players' from their gamertag on GeyserMC; a player looked up in the last
 * hour is answered from memory. An offline-mode server's Java uuids come
 * from the name itself, so there is nothing to look up for those.
 */
export async function currentPlayerNames(ctx: Server, rawUuids: unknown, naming: BedrockNaming | null): Promise<Record<string, string>> {
    if (!Array.isArray(rawUuids)) throw new Error("uuids must be a list");
    const valid = [...new Set(rawUuids.map((u) => String(u ?? "").trim().toLowerCase()))]
        .filter((u) => UUID_RE.test(u));
    const result: Record<string, string> = {};
    if (valid.length === 0) return result;
    const onlineMode = isOnlineMode(await readServerProperties(ctx));
    // a Floodgate uuid is no Mojang account; without Floodgate it has no name to look up
    const uuids = valid.filter((u) => (isFloodgateUuid(u) ? naming !== null : onlineMode));

    const stale: string[] = [];
    for (const uuid of uuids) {
        const known = cachedName(ctx, uuid);
        if (known) result[uuid] = known;
        else stale.push(uuid);
    }
    const failures: string[] = [];
    const worker = async () => {
        for (let uuid = stale.shift(); uuid !== undefined; uuid = stale.shift()) {
            try {
                const name = await currentName(uuid, naming);
                if (!name) continue;
                minecraftOf(ctx).lists.names.set(uuid, { name, at: Date.now() });
                result[uuid] = name;
            } catch (err) {
                failures.push(errorMessage(err));
            }
        }
    };
    await Promise.all(Array.from({ length: MAX_NAME_LOOKUPS }, worker));
    // the roster keeps the names on file; the reason a refresh failed is
    // said in the console, once per batch
    if (failures.length > 0) report(ctx, `${failures.length} player name lookup(s) failed`, failures[0]);
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

async function knownAccount(ctx: Server, name: string): Promise<{ uuid: string; name: string } | null> {
    const wanted = name.toLowerCase();
    for (const [uuid, known] of await resolvePlayerIdentities(ctx)) {
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
    ctx: Server,
    name: string,
    gamertag: string | null,
    naming: BedrockNaming | null,
    props: Record<string, string>,
): Promise<{ uuid: string; name: string }> {
    const known = await knownAccount(ctx, name);
    if (known) return known;
    if (gamertag && naming) return bedrockAccount(gamertag, naming);
    if (!isOnlineMode(props)) return { uuid: offlinePlayerUuid(name), name };
    const profile = await profileForName(name);
    if (!profile) throw new Error(`No Minecraft account is named "${name}"`);
    return profile;
}

async function editListFile(
    ctx: Server,
    flag: PlayerFlag,
    name: string,
    on: boolean,
    uuid: string | null,
    gamertag: string | null,
    naming: BedrockNaming | null,
): Promise<void> {
    const path = LIST_FILES[flag];
    const list = await readList(ctx, path);
    const props = await readServerProperties(ctx);
    const wanted = name.toLowerCase();
    const matches = (entry: ListEntry) =>
        typeof entry.name === "string" && entry.name.toLowerCase() === wanted;

    if (!on) {
        // a renamed player is still listed under their old name: match by
        // the uuid given, or the one the server knows the current name by
        const identities = await resolvePlayerIdentities(ctx);
        const kept = list.filter((entry) => {
            if (matches(entry)) return false;
            const listed = entryUuid(entry);
            if (!listed) return true;
            return listed !== uuid && identities.get(listed)?.toLowerCase() !== wanted;
        });
        if (kept.length === list.length) {
            throw new Error(flag === "op" ? `${name} is not an operator` : `${name} is not on the whitelist`);
        }
        await ctx.files.write(path, `${JSON.stringify(kept, null, 2)}\n`, PANEL_ID);
        return;
    }

    if (list.some(matches)) return;
    const account = uuid ? { uuid, name } : await accountForName(ctx, name, gamertag, naming, props);
    if (list.some((entry) => entryUuid(entry) === account.uuid)) return;
    const entry: Record<string, unknown> = { uuid: account.uuid, name: account.name };
    if (flag === "op") {
        // the level `op` itself grants: op-permission-level, default 4
        const level = Number.parseInt(props["op-permission-level"] ?? "4", 10);
        entry.level = Number.isInteger(level) && level >= 1 && level <= 4 ? level : 4;
        entry.bypassesPlayerLimit = false;
    }
    await ctx.files.write(path, `${JSON.stringify([...list, entry], null, 2)}\n`, PANEL_ID);
}

/** the console command a running server takes the change as */
export function playerFlagCommand(flag: PlayerFlag, name: string, on: boolean): string {
    return flag === "op"
        ? `${on ? "op" : "deop"} ${name}`
        : `whitelist ${on ? "add" : "remove"} ${name}`;
}

/** Ops or whitelists a Java player on a running server, or takes it back; resolves once the server has, fails with its refusal. */
async function flagThroughConsole(ctx: Server, flag: PlayerFlag, name: string, on: boolean): Promise<void> {
    const who = nameInAnswer(name);
    // "Made Steve a server operator", "Added Steve to the whitelist"; 1.12 says "Opped Steve" and "De-opped Steve"
    const done = flag === "op"
        ? new RegExp(on ? `\\b(Made ${who} a server operator|Opped ${who})\\b` : `\\b(Made ${who} no longer a server operator|De-opped ${who})\\b`, "i")
        : new RegExp(`\\b${on ? `Added ${who} to` : `Removed ${who} from`} the whitelist\\b`, "i");
    const what = flag === "op" ? `that ${name} ${on ? "is" : "is no longer"} an operator` : `that ${name} is ${on ? "on" : "off"} the whitelist`;
    await answeredCommand(ctx, playerFlagCommand(flag, name, on), done, what, { list: flag, name, on });
}

// Floodgate reads its argument as one quoted-or-bare word
function floodgateArgument(gamertag: string): string {
    return gamertag.includes(" ") ? `"${gamertag}"` : gamertag;
}

async function inUsercache(ctx: Server, name: string): Promise<boolean> {
    const list = await readList(ctx, "usercache.json");
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
    ctx: Server,
    flag: PlayerFlag,
    name: string,
    gamertag: string,
    naming: BedrockNaming,
    on: boolean,
    uuid: string | null,
): Promise<string> {
    if (flag === "whitelist") {
        if (!on) {
            const known = uuid ?? (await knownAccount(ctx, name))?.uuid ?? null;
            return `fwhitelist remove ${known && isFloodgateUuid(known) ? known : floodgateArgument(gamertag)}`;
        }
        await bedrockAccount(gamertag, naming);
        return `fwhitelist add ${floodgateArgument(gamertag)}`;
    }
    if (!(await inUsercache(ctx, name))) {
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
 * the server runs, done once the server has; in the file while it is stopped.
 * Between the two (stopping, restarting) the server may rewrite the file
 * over the edit, so it waits. `naming` is Floodgate's, null without it: a
 * name with its prefix is a Bedrock player then.
 */
export async function setPlayerFlag(
    ctx: Server,
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
        if (gamertag && naming) await sendServerCommand(ctx, await bedrockFlagCommand(ctx, flag, name, gamertag, naming, on, uuid));
        else await flagThroughConsole(ctx, flag, name, on);
        return;
    }
    if (status !== "offline") {
        throw new Error("Wait until the server has finished stopping");
    }
    await minecraftOf(ctx).lists.editing(() => editListFile(ctx, flag, name, on, uuid, gamertag, naming));
}
