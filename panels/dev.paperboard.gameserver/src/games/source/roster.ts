import fs from "node:fs/promises";
import path from "node:path";

/** What a player has done on the server, read from its game log. */
export interface SourceStats {
    kills: number;
    deaths: number;
    assists: number;
    dominations: number;
    /** milliseconds on the server */
    playtime: number;
}
export const STAT_KEYS = ["kills", "deaths", "assists", "dominations", "playtime"] as const satisfies readonly (keyof SourceStats)[];
export const noStats = (): SourceStats => ({ kills: 0, deaths: 0, assists: 0, dominations: 0, playtime: 0 });

/** A player Paperboard has seen on the server, keyed by Steam id, with their totals across visits. */
export interface SourceSeen extends Partial<SourceStats> {
    steamId: string;
    name: string;
    lastSeen: number;
}

export interface SourceBan {
    steamId: string;
    /** the name they had when banned, when Paperboard had seen them */
    name: string;
    at: number;
}

/**
 * The players and bans Paperboard keeps in the server folder, so backups
 * carry them. The server reads bans from the banned_user.cfg written from
 * this list at each start; a running server is told of each change itself.
 */
export class SourceRoster {
    private queue: Promise<unknown> = Promise.resolve();
    constructor(private readonly root: string) {}

    private get seenFile() { return path.join(this.root, "players.json"); }
    private get banFile() { return path.join(this.root, "bans.json"); }

    private serial<T>(work: () => Promise<T>): Promise<T> {
        const run = this.queue.then(work, work);
        this.queue = Promise.allSettled([run]);
        return run;
    }

    private async read<T>(file: string): Promise<T[]> {
        let text: string;
        try { text = await fs.readFile(file, "utf8"); }
        catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return []; throw err; }
        const parsed = JSON.parse(text) as unknown;
        if (!Array.isArray(parsed)) throw new Error(`${path.basename(file)} is not a list`);
        return parsed as T[];
    }

    seen(): Promise<SourceSeen[]> { return this.read<SourceSeen>(this.seenFile); }
    bans(): Promise<SourceBan[]> { return this.read<SourceBan>(this.banFile); }

    /** Records a player as seen now; bots have no Steam id and are not kept. */
    remember(steamId: string, name: string, now = Date.now()): Promise<void> {
        return this.serial(async () => {
            const byId = new Map((await this.seen()).map((p) => [p.steamId, p]));
            const known = byId.get(steamId);
            byId.set(steamId, { ...known, steamId, name: name || known?.name || steamId, lastSeen: now });
            await fs.writeFile(this.seenFile, JSON.stringify([...byId.values()], null, 2));
        });
    }

    /** Adds to the totals of players already seen; a Steam id it has not seen is refused. */
    addStats(added: ReadonlyMap<string, Partial<SourceStats>>): Promise<void> {
        return this.serial(async () => {
            if (added.size === 0) return;
            const seen = await this.seen();
            const byId = new Map(seen.map((p) => [p.steamId, p]));
            for (const [steamId, stats] of added) {
                const player = byId.get(steamId);
                if (!player) throw new Error(`${steamId} has not been seen on this server`);
                for (const key of STAT_KEYS) if (stats[key]) player[key] = (player[key] ?? 0) + stats[key]!;
            }
            await fs.writeFile(this.seenFile, JSON.stringify(seen, null, 2));
        });
    }

    ban(steamId: string, now = Date.now()): Promise<void> {
        return this.serial(async () => {
            const bans = await this.bans();
            if (bans.some((b) => b.steamId === steamId)) return;
            const name = (await this.seen()).find((p) => p.steamId === steamId)?.name ?? steamId;
            await fs.writeFile(this.banFile, JSON.stringify([...bans, { steamId, name, at: now }], null, 2));
        });
    }

    unban(steamId: string): Promise<void> {
        return this.serial(async () => {
            const bans = await this.bans();
            if (!bans.some((b) => b.steamId === steamId)) throw new Error(`${steamId} is not banned`);
            await fs.writeFile(this.banFile, JSON.stringify(bans.filter((b) => b.steamId !== steamId), null, 2));
        });
    }
}

/** banned_user.cfg as Source's writeid writes it: a permanent ban per line. */
export function bannedUserCfg(bans: readonly SourceBan[]): string {
    return bans.map((b) => `banid 0 ${b.steamId}\n`).join("");
}
