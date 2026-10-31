import fs from "node:fs/promises";
import path from "node:path";

/** A player Paperboard has seen on the server, keyed by Steam id. */
export interface SourceSeen {
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
            byId.set(steamId, { steamId, name: name || byId.get(steamId)?.name || steamId, lastSeen: now });
            await fs.writeFile(this.seenFile, JSON.stringify([...byId.values()], null, 2));
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
