// Who is on a Source server and what they do there: the players its log
// lines and `status` name, the stats they gather on the way to the roster,
// and the calls and blocks that kick and ban them.
import type { ServerCalls } from "../../service/calls";
import type { Server } from "../../service/server";
import { TRIGGER_IDS } from "../../service/contract";
import { appendCapped } from "../../service/types";
import { pushChat, report } from "../serviceKit";
import { SOURCE_CALLS as ids } from "./index";
import { parseStatus, type SourceLogEvent } from "./log";
import { mergeStats, noStats, type SourceGathered, type SourceRoster, type SourceStats } from "./roster";
import { rewriteConfigs } from "./files";
import { mods, modsOn } from "./modLinks";
import type { SourceGame } from "./instance";

/** A player on the running server, by the server's user id for their connection. */
export interface SourceOnline {
    userId: number;
    name: string;
    /** "[U:1:…]" ("STEAM_0:…" where the game writes that form), or "BOT" */
    steamId: string;
    team: string;
    /** "medic", once they have picked a class */
    role?: string;
    since: number;
    /** what they have done since they joined */
    stats: SourceStats;
}

/** A player a server's own listing (`status`) names. */
export interface SourceListed {
    userId: number;
    name: string;
    /** "" when the listing names no Steam id; the game log names it as they join */
    steamId: string;
    since: number;
}

/** What SourcePlayers keeps track for: one server of a Source game. */
export interface SourcePlayersHost {
    readonly server: Server;
    /** Paperboard's players and bans of the server */
    roster(): SourceRoster;
    /** whether a log or status id is a person's, in the form the game writes */
    isPlayer(id: string): boolean;
    /**
     * A game's own step as a person connects, after they are counted, announced
     * and recorded: a check of its own on who came in, such as a ban list the
     * game's server keeps no record of. A failure is shown in the console.
     */
    joined?(player: SourceOnline): Promise<void>;
}

/** how long stats gather before they are written to the roster */
const STATS_FLUSH_MS = 15_000;

/** A `status` row's connected time ("01:02", "1:02:03") in milliseconds. */
function connectedMs(text: string): number {
    const parts = text.split(":").map(Number);
    if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) return 0;
    return parts.reduce((total, n) => total * 60 + n, 0) * 1000;
}

export class SourcePlayers {
    readonly #game: SourcePlayersHost;
    /** who is on, by the server's user id for their connection */
    readonly online = new Map<number, SourceOnline>();
    /** stats not yet in the roster, by Steam id */
    #unsaved = new Map<string, SourceGathered>();
    /** when each online player's time was last added to their playtime, by user id */
    readonly #counted = new Map<number, number>();
    #statsTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(game: SourcePlayersHost) {
        this.#game = game;
    }

    /** the people on, without bots */
    people(): SourceOnline[] {
        return [...this.online.values()].filter((p) => p.steamId !== "BOT");
    }

    #setOnline() {
        const humans = this.people().filter((p) => p.name);
        this.#game.server.setState((prev) => ({
            onlinePlayers: humans.map((p) => p.name),
            seenPlayers: humans.reduce((seen, p) => (seen.includes(p.name) ? seen : appendCapped(seen, p.name)), prev.seenPlayers),
        }));
    }

    /** What a log line said happened: a map loading, a player joining, leaving or scoring, a chat line. */
    observe(event: SourceLogEvent): void {
        const game = this.#game;
        const server = game.server;
        const online = this.online;
        switch (event.kind) {
            case "map": server.setState({ serverLevel: event.map }); return;
            case "connected": {
                const p = event.player;
                const now = Date.now();
                const player: SourceOnline = { userId: p.userId, name: p.name, steamId: p.steamId, team: p.team, since: now, stats: noStats() };
                online.set(p.userId, player);
                this.#counted.set(p.userId, now);
                this.#setOnline();
                if (game.isPlayer(p.steamId)) {
                    pushChat(server, { event: "join", sender: p.name, text: `${p.name} joined the game` });
                    server.trigger(TRIGGER_IDS.playerJoined, p.name);
                    game.roster().remember(p.steamId, p.name).catch((err) => report(server, `Could not record ${p.name}`, err));
                    game.joined?.(player).catch((err) => report(server, `Could not check ${p.name} as they joined`, err));
                }
                return;
            }
            case "disconnected": {
                const p = event.player;
                const known = online.get(p.userId);
                if (known) this.#countPlaytime(known);
                online.delete(p.userId);
                this.#counted.delete(p.userId);
                this.#setOnline();
                const name = p.name || known?.name || "";
                if (game.isPlayer(p.steamId) && name) {
                    pushChat(server, { event: "leave", sender: name, text: `${name} left the game` });
                    server.trigger(TRIGGER_IDS.playerLeft, name);
                    game.roster().remember(p.steamId, name).catch((err) => report(server, `Could not record ${name} leaving`, err));
                    this.saveStats().catch((err) => report(server, `Could not save ${name}'s stats`, err));
                }
                return;
            }
            case "renamed": {
                const known = online.get(event.player.userId);
                if (known) { known.name = event.name; this.#setOnline(); }
                if (game.isPlayer(event.player.steamId)) game.roster().remember(event.player.steamId, event.name).catch((err) => report(server, `Could not record ${event.name}`, err));
                return;
            }
            case "entered": return;
            case "team": {
                const known = online.get(event.player.userId);
                if (known) known.team = event.team;
                return;
            }
            case "role": {
                const known = online.get(event.player.userId);
                if (known) known.role = event.role;
                return;
            }
            // a kill by the world or a sentry's owner names the victim as both
            case "kill":
                if (event.player.userId !== event.victim.userId) this.#bump(event.player.userId, "kills");
                this.#bump(event.victim.userId, "deaths");
                return;
            case "suicide": this.#bump(event.player.userId, "deaths"); return;
            case "assist": this.#bump(event.player.userId, "assists"); return;
            case "domination": this.#bump(event.player.userId, "dominations"); return;
            case "say": {
                const p = event.player;
                if (p.steamId === "Console") { pushChat(server, { event: "server", content: event.text, text: `<Server> ${event.text}` }); return; }
                if (p.steamId === "BOT") return;
                const text = event.team ? `(Team) ${event.text}` : event.text;
                server.trigger(TRIGGER_IDS.chatMessage, pushChat(server, { sender: p.name, content: text, text: `<${p.name}> ${text}` }));
                return;
            }
        }
    }

    /** Counts one stat for an online player; a person's goes to the roster soon after. */
    #bump(userId: number, key: Exclude<keyof SourceStats, "playtime">) {
        const player = this.online.get(userId);
        if (!player) return;
        player.stats[key] += 1;
        if (!this.#game.isPlayer(player.steamId)) return;
        const unsaved = this.#unsavedOf(player);
        unsaved[key] = (unsaved[key] ?? 0) + 1;
        if (!this.#statsTimer) this.#statsTimer = setTimeout(() => {
            this.#statsTimer = null;
            this.saveStats().catch((err) => report(this.#game.server, "Could not save players' stats", err));
        }, STATS_FLUSH_MS);
    }
    #unsavedOf(player: SourceOnline): SourceGathered {
        const stats = this.#unsaved.get(player.steamId) ?? { name: player.name };
        // a rename since is the name they are recorded by
        stats.name = player.name || stats.name;
        this.#unsaved.set(player.steamId, stats);
        return stats;
    }
    /** Adds the time since it was last counted to a person's playtime. */
    #countPlaytime(player: SourceOnline, now = Date.now()) {
        const from = this.#counted.get(player.userId) ?? now;
        this.#counted.set(player.userId, now);
        if (!this.#game.isPlayer(player.steamId) || now <= from) return;
        player.stats.playtime += now - from;
        const unsaved = this.#unsavedOf(player);
        unsaved.playtime = (unsaved.playtime ?? 0) + now - from;
    }
    /** Writes what has gathered, with everyone's time on so far, to the roster. */
    async saveStats(): Promise<void> {
        if (this.#statsTimer) clearTimeout(this.#statsTimer);
        this.#statsTimer = null;
        const now = Date.now();
        for (const player of this.online.values()) this.#countPlaytime(player, now);
        const stats = this.#unsaved;
        this.#unsaved = new Map();
        try { await this.#game.roster().addStats(stats); }
        catch (err) { mergeStats(this.#unsaved, stats); throw err; }
    }

    /**
     * Who is on by the server's own listing: on start and when reattaching.
     * Those it no longer lists are gone, and one it lists without a Steam id
     * keeps the id the game log named.
     */
    async present(listed: readonly SourceListed[]): Promise<void> {
        const game = this.#game;
        const online = this.online;
        const now = Date.now();
        const before = new Map(online);
        online.clear();
        for (const p of listed) {
            const known = before.get(p.userId);
            const same = known && (!p.steamId || known.steamId === p.steamId) ? known : undefined;
            online.set(p.userId, same ?? { userId: p.userId, name: p.name, steamId: p.steamId, team: "", since: p.since, stats: noStats() });
            // a user id the server has given someone else counts their time from now
            if (!same || !this.#counted.has(p.userId)) this.#counted.set(p.userId, now);
            if (!same && game.isPlayer(p.steamId)) await game.roster().remember(p.steamId, p.name);
        }
        for (const id of [...this.#counted.keys()]) if (!online.has(id)) this.#counted.delete(id);
        this.#setOnline();
    }

    /** Forgets the run's players and the stats not yet saved; the server is going away. */
    dispose(): void {
        if (this.#statsTimer) clearTimeout(this.#statsTimer);
        this.#statsTimer = null;
        this.#unsaved.clear();
        this.#counted.clear();
        this.online.clear();
    }
}

/** Learns who is on, which map and the player cap from RCON's `status`: on start and when reattaching. */
export async function readStatus(game: SourceGame): Promise<void> {
    const status = parseStatus(await game.rcon().exec("status"));
    const now = Date.now();
    await game.players.present(status.players.map((p) => ({ userId: p.userId, name: p.name, steamId: p.steamId, since: now - connectedMs(p.connected) })));
    game.server.setState({ maxPlayers: status.maxPlayers, serverLevel: status.map });
    if (status.version && game.server.settings.version !== status.version) await game.server.updateSettings({ version: status.version });
}

/** The calls of the Players tab. */
export function playerCalls(game: SourceGame): ServerCalls {
    const { spec } = game;
    return {
        [ids.metrics]: async () => ({ bots: [...game.players.online.values()].filter((p) => p.steamId === "BOT").length }),
        [ids.players]: async () => {
            await game.players.saveStats();
            const roster = game.roster();
            return { seen: await roster.seen(), bans: await roster.bans(), online: [...game.players.online.values()], admins: (await modsOn(game)) ? await (await mods(game)).admins() : null };
        },
        [ids.kick]: async (_ctx, { userId }) => {
            if (!game.online()) throw new Error(`${spec.name} is not running`);
            const player = game.players.online.get(userId);
            if (!player) throw new Error("That player is not online");
            const reply = await game.rcon().exec(`kickid ${player.userId} Kicked by the server admin`);
            if (/not found/.test(reply)) throw new Error(`${spec.name} did not find that player: ${reply.trim()}`);
            return true;
        },
        [ids.ban]: async (_ctx, { steamId: raw }) => {
            const id = game.steamId(raw);
            await game.roster().ban(id);
            if (game.online()) await game.rcon().exec(`banid 0 ${id} kick`);
            await rewriteConfigs(game);
            return true;
        },
        [ids.unban]: async (_ctx, { steamId: raw }) => {
            const id = game.steamId(raw);
            await game.roster().unban(id);
            if (game.online()) await game.rcon().exec(`removeid ${id}`);
            await rewriteConfigs(game);
            return true;
        },
    };
}

/** The game's player blocks: the server kicks by its own user id and bans by Steam id, so a block's player name is looked up among the players online, then the ones it has seen. */
export async function playerBlocks(game: Pick<SourcePlayersHost, "server" | "roster"> & { readonly players: SourcePlayers }) {
    const { mergeBlocks, onlyIdNamed, playerEvents, rosterBlocks, runGameCall } = await import("../../service/blocks");
    const nameOf = (p: { name: string }) => p.name;
    const steamOf = (p: { steamId: string }) => p.steamId;
    const server = game.server;
    return mergeBlocks({ events: playerEvents() }, rosterBlocks({
        kick: (name) => runGameCall(server, ids.kick, { userId: Number(onlyIdNamed(name, [...game.players.online.values()], nameOf, (p) => String(p.userId), "online")) }),
        ban: async (name) => runGameCall(server, ids.ban, { steamId: onlyIdNamed(name, [...game.players.people(), ...await game.roster().seen()], nameOf, steamOf, "on this server") }),
        unban: async (name) => {
            const bans = await game.roster().bans();
            // listed by their Steam id when Paperboard never saw them
            const byId = bans.find((ban) => ban.steamId === name);
            return runGameCall(server, ids.unban, { steamId: byId ? byId.steamId : onlyIdNamed(name, bans, nameOf, steamOf, "banned") });
        },
        banned: async () => (await game.roster().bans()).map((ban) => ban.name || ban.steamId),
    }));
}
