import fs from "node:fs/promises";
import path from "node:path";
import type { RustPlayer } from "./webrcon";

/** A player Paperboard has seen on the server, keyed by Steam id. */
export interface RustSeen {
    steamId: string;
    name: string;
    lastSeen: number;
}

export interface RustBan {
    steamId: string;
    /** the name the ban was made with */
    name: string;
    reason: string;
}

/** Steam ids as Rust takes them: the 17-digit number. */
export function steamId(value: unknown): string {
    if (typeof value !== "string" || !/^7656119\d{10}$/.test(value)) throw new Error("Choose a player by their Steam id");
    return value;
}

/** `banlistex`, one ban a line: `1 76561198000000001 "Name" "reason" -1`. */
export function parseBanList(reply: string): RustBan[] {
    const bans: RustBan[] = [];
    for (const line of reply.split(/\r?\n/)) {
        const match = /^\d+ (7656119\d{10}) "(.*?)" "(.*)" -?\d+$/.exec(line.trim());
        if (match) bans.push({ steamId: match[1]!, name: match[2]!, reason: match[3]! });
    }
    return bans;
}

/** The server's own bans.cfg, which it writes as `banid 76561198000000001 "Name" "reason" -1` a line. */
export function parseBansCfg(text: string): RustBan[] {
    const bans: RustBan[] = [];
    for (const line of text.split(/\r?\n/)) {
        const match = /^banid (7656119\d{10}) "(.*?)" "(.*)"(?: -?\d+)?$/.exec(line.trim());
        if (match) bans.push({ steamId: match[1]!, name: match[2]!, reason: match[3]! });
    }
    return bans;
}

/** The players file Paperboard keeps in the server folder, so backups carry it. */
export class RustRoster {
    private queue: Promise<unknown> = Promise.resolve();
    constructor(private readonly root: string) {}

    private get file() { return path.join(this.root, "rust-players.json"); }

    async seen(): Promise<RustSeen[]> {
        let text: string;
        try { text = await fs.readFile(this.file, "utf8"); }
        catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return []; throw err; }
        const parsed = JSON.parse(text) as unknown;
        if (!Array.isArray(parsed)) throw new Error("rust-players.json is not a list");
        return parsed as RustSeen[];
    }

    /** Records who is online now. */
    remember(players: readonly RustPlayer[], now = Date.now()): Promise<void> {
        if (players.length === 0) return Promise.resolve();
        const run = this.queue.then(async () => {
            const byId = new Map((await this.seen()).map((p) => [p.steamId, p]));
            for (const p of players) byId.set(p.steamId, { steamId: p.steamId, name: p.name, lastSeen: now });
            await fs.writeFile(this.file, JSON.stringify([...byId.values()], null, 2));
        });
        this.queue = Promise.allSettled([run]);
        return run;
    }
}
