import fs from "node:fs/promises";
import path from "node:path";
import { SerialQueue } from "@mileniumhq/paperapi";
import { writeFileAtomic } from "@mileniumhq/paperapi/fs";
import { unlessMissing } from "../../service/failures";
import type { PalworldPlayer } from "./rest";

/** A player Paperboard has seen on the server, keyed by Palworld's user id. */
export interface PalworldSeen {
    userId: string;
    name: string;
    accountName: string;
    level: number;
    lastSeen: number;
}

/** Palworld user ids, as the REST API lists them: "steam_<digits>" and the like. */
export function userId(value: unknown): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error("Choose a player by their Palworld user id");
    return value;
}

/**
 * The players file Paperboard keeps beside the world, and Palworld's own
 * banlist.txt, read only: Palworld derives part of each line itself, so bans
 * go through the running server.
 */
export class PalworldRoster {
    // read-modify-writes of its files, one at a time
    private readonly serial = new SerialQueue().run;
    constructor(private readonly root: string, private readonly saved: string) {}

    private get file() { return path.join(this.root, "palworld-players.json"); }
    private get banFile() { return path.join(this.saved, "SaveGames", "banlist.txt"); }

    async seen(): Promise<PalworldSeen[]> {
        const text = await unlessMissing(fs.readFile(this.file, "utf8"), null);
        if (text === null) return [];
        const parsed = JSON.parse(text) as unknown;
        if (!Array.isArray(parsed)) throw new Error("palworld-players.json is not a list");
        return parsed as PalworldSeen[];
    }

    /** Records who is online now. */
    remember(players: readonly PalworldPlayer[], now = Date.now()): Promise<void> {
        if (players.length === 0) return Promise.resolve();
        return this.serial(async () => {
            const byId = new Map((await this.seen()).map((p) => [p.userId, p]));
            for (const p of players) byId.set(p.userId, { userId: p.userId, name: p.name, accountName: p.accountName, level: p.level, lastSeen: now });
            await writeFileAtomic(this.file, JSON.stringify([...byId.values()], null, 2));
        });
    }

    /** The banned user ids. Palworld writes each ban as "<user id>,<its own player uid>". */
    async bans(): Promise<string[]> {
        const text = await unlessMissing(fs.readFile(this.banFile, "utf8"), "");
        return text.split(/\r?\n/).map((line) => line.split(",")[0]!.trim()).filter(Boolean);
    }
}
